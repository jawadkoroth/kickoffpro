import { createAdminClient } from '@/lib/supabase/admin';

export type AudienceMode = 'all' | 'newsletter' | 'customers' | 'opted_in_buyers';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned || !EMAIL_RE.test(cleaned)) return null;
  return cleaned;
}

/**
 * Fetch all suppressed email addresses (marketing_suppressions + unsubscribed newsletter rows).
 */
export async function getSuppressedEmailsSet(
  supabase = createAdminClient(),
): Promise<Set<string>> {
  const suppressed = new Set<string>();

  const [{ data: suppRows }, { data: unsubRows }] = await Promise.all([
    supabase.from('marketing_suppressions').select('email'),
    supabase
      .from('newsletter_subscribers')
      .select('email')
      .not('unsubscribed_at', 'is', null),
  ]);

  if (suppRows) {
    for (const row of suppRows) {
      const e = normalizeEmail(row.email);
      if (e) suppressed.add(e);
    }
  }

  if (unsubRows) {
    for (const row of unsubRows) {
      const e = normalizeEmail(row.email);
      if (e) suppressed.add(e);
    }
  }

  return suppressed;
}

/**
 * Active newsletter subscriber emails, already filtered against marketing suppressions.
 */
export async function getNewsletterEmails(
  supabase = createAdminClient(),
  suppressedSet?: Set<string>,
): Promise<string[]> {
  const suppressed = suppressedSet ?? (await getSuppressedEmailsSet(supabase));
  const { data } = await supabase
    .from('newsletter_subscribers')
    .select('email')
    .is('unsubscribed_at', null);

  const unique = new Set<string>();
  for (const row of data ?? []) {
    const email = normalizeEmail(row.email);
    if (email && !suppressed.has(email)) {
      unique.add(email);
    }
  }

  return Array.from(unique);
}

/**
 * Past buyer emails from non-cancelled / non-failed orders,
 * optionally restricted to checkout marketing opt-in (`accepts_marketing = true`).
 */
export async function getCustomerEmails(
  supabase = createAdminClient(),
  opts?: { optedInOnly?: boolean; suppressedSet?: Set<string> },
): Promise<string[]> {
  const suppressed = opts?.suppressedSet ?? (await getSuppressedEmailsSet(supabase));

  let query = supabase
    .from('orders')
    .select('customer, order_status, payment_status, accepts_marketing')
    .neq('order_status', 'cancelled')
    .neq('payment_status', 'failed');

  if (opts?.optedInOnly) {
    query = query.eq('accepts_marketing', true);
  }

  const { data } = await query;
  const unique = new Set<string>();

  for (const row of data ?? []) {
    const customer = row.customer as { email?: string } | null;
    const email = normalizeEmail(customer?.email);
    if (email && !suppressed.has(email)) {
      unique.add(email);
    }
  }

  return Array.from(unique);
}

/**
 * Resolve the deduplicated recipient list for a broadcast audience mode.
 */
export async function resolveAudience(mode: AudienceMode): Promise<string[]> {
  const supabase = createAdminClient();
  const suppressed = await getSuppressedEmailsSet(supabase);

  if (mode === 'newsletter') {
    return getNewsletterEmails(supabase, suppressed);
  }

  if (mode === 'customers') {
    return getCustomerEmails(supabase, { optedInOnly: false, suppressedSet: suppressed });
  }

  if (mode === 'opted_in_buyers') {
    return getCustomerEmails(supabase, { optedInOnly: true, suppressedSet: suppressed });
  }

  // 'all': Union of active newsletter subscribers and past buyers
  const [newsletter, customers] = await Promise.all([
    getNewsletterEmails(supabase, suppressed),
    getCustomerEmails(supabase, { optedInOnly: false, suppressedSet: suppressed }),
  ]);

  const combined = new Set<string>([...newsletter, ...customers]);
  return Array.from(combined).sort();
}

/**
 * Return exact deduplicated recipient counts per audience segment plus suppression count.
 */
export async function getAudienceCounts(): Promise<{
  all: number;
  newsletter: number;
  customers: number;
  opted_in_buyers: number;
  suppressed: number;
}> {
  const supabase = createAdminClient();
  const suppressed = await getSuppressedEmailsSet(supabase);

  const [newsletter, customers, optedInBuyers] = await Promise.all([
    getNewsletterEmails(supabase, suppressed),
    getCustomerEmails(supabase, { optedInOnly: false, suppressedSet: suppressed }),
    getCustomerEmails(supabase, { optedInOnly: true, suppressedSet: suppressed }),
  ]);

  const combined = new Set<string>([...newsletter, ...customers]);

  return {
    all: combined.size,
    newsletter: newsletter.length,
    customers: customers.length,
    opted_in_buyers: optedInBuyers.length,
    suppressed: suppressed.size,
  };
}
