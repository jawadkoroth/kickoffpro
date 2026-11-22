import type { SupabaseClient } from '@supabase/supabase-js';

export type AudienceMode = 'all' | 'newsletter' | 'customers';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AudienceResolutionResult {
  emails: string[];
  count: number;
  mode: AudienceMode;
}

export interface AudienceCountsSummary {
  all: number;
  newsletter: number;
  customers: number;
}

/**
 * Normalizes email address to lower-case trimmed string.
 */
function normalizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const clean = email.trim().toLowerCase();
  if (!clean || clean.length > 320 || !EMAIL_RE.test(clean)) return null;
  return clean;
}

/**
 * Fetch all suppressed / unsubscribed emails across both suppression sources:
 * 1. `marketing_suppressions` table
 * 2. `newsletter_subscribers` where `unsubscribed_at IS NOT NULL`
 */
async function getSuppressedEmailsSet(supabase: SupabaseClient): Promise<Set<string>> {
  const suppressed = new Set<string>();

  // 1. Marketing suppressions table
  const { data: suppRows } = await supabase
    .from('marketing_suppressions')
    .select('email');

  if (suppRows) {
    for (const row of suppRows) {
      const email = normalizeEmail(row.email);
      if (email) suppressed.add(email);
    }
  }

  // 2. Unsubscribed newsletter subscribers
  const { data: unsubRows } = await supabase
    .from('newsletter_subscribers')
    .select('email')
    .not('unsubscribed_at', 'is', null);

  if (unsubRows) {
    for (const row of unsubRows) {
      const email = normalizeEmail(row.email);
      if (email) suppressed.add(email);
    }
  }

  return suppressed;
}

/**
 * Resolve active newsletter subscriber emails.
 */
async function getNewsletterEmails(supabase: SupabaseClient): Promise<string[]> {
  const { data: rows } = await supabase
    .from('newsletter_subscribers')
    .select('email')
    .is('unsubscribed_at', null);

  const emails: string[] = [];
  if (rows) {
    for (const r of rows) {
      const clean = normalizeEmail(r.email);
      if (clean) emails.push(clean);
    }
  }
  return emails;
}

/**
 * Resolve past customer emails from orders and user profiles.
 */
async function getCustomerEmails(supabase: SupabaseClient): Promise<string[]> {
  const emails: string[] = [];

  // From orders JSONB `customer`
  const { data: orderRows } = await supabase
    .from('orders')
    .select('customer');

  if (orderRows) {
    for (const r of orderRows) {
      const cust = r.customer as { email?: string } | null;
      const clean = normalizeEmail(cust?.email);
      if (clean) emails.push(clean);
    }
  }

  // From user profiles
  const { data: profileRows } = await supabase
    .from('profiles')
    .select('email');

  if (profileRows) {
    for (const r of profileRows) {
      const clean = normalizeEmail(r.email);
      if (clean) emails.push(clean);
    }
  }

  return emails;
}

/**
 * Resolve deduplicated, suppression-filtered recipient emails for a selected audience mode.
 */
export async function resolveAudience(
  supabase: SupabaseClient,
  mode: AudienceMode,
): Promise<AudienceResolutionResult> {
  const suppressedSet = await getSuppressedEmailsSet(supabase);
  const candidates: string[] = [];

  if (mode === 'newsletter' || mode === 'all') {
    const nl = await getNewsletterEmails(supabase);
    candidates.push(...nl);
  }

  if (mode === 'customers' || mode === 'all') {
    const cust = await getCustomerEmails(supabase);
    candidates.push(...cust);
  }

  // Deduplicate and filter out suppressions
  const uniqueEmails = new Set<string>();
  for (const email of candidates) {
    if (!suppressedSet.has(email)) {
      uniqueEmails.add(email);
    }
  }

  const finalEmails = Array.from(uniqueEmails);

  return {
    emails: finalEmails,
    count: finalEmails.length,
    mode,
  };
}

/**
 * Compute counts for all audience modes for live preview in the admin UI.
 */
export async function getAudienceCounts(
  supabase: SupabaseClient,
): Promise<AudienceCountsSummary> {
  const [nlResult, custResult, allResult] = await Promise.all([
    resolveAudience(supabase, 'newsletter'),
    resolveAudience(supabase, 'customers'),
    resolveAudience(supabase, 'all'),
  ]);

  return {
    newsletter: nlResult.count,
    customers: custResult.count,
    all: allResult.count,
  };
}
