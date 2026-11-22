import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/log';

function getSecretKey(): string {
  return (
    process.env.UNSUBSCRIBE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.CRON_SECRET ||
    'kickoffpro-unsubscribe-salt-secure'
  );
}

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://kickoffpro.in'
  );
}

/**
 * Generate a stateless, tamper-proof HMAC signature for an email address.
 * Allows users to unsubscribe with a single click without needing auth cookies.
 */
export function generateUnsubscribeToken(email: string): string {
  const normalized = email.trim().toLowerCase();
  return crypto
    .createHmac('sha256', getSecretKey())
    .update(normalized)
    .digest('hex');
}

/**
 * Verify if the provided token matches the email address.
 */
export function verifyUnsubscribeToken(email: string, token: string): boolean {
  if (!email || !token) return false;
  const expected = generateUnsubscribeToken(email);
  try {
    const a = Buffer.from(token, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Get the unsubscribe web page URL and one-click API endpoint URL for an email.
 */
export function getUnsubscribeUrls(email: string): { webUrl: string; apiUrl: string } {
  const token = generateUnsubscribeToken(email);
  const base = siteUrl();
  const params = new URLSearchParams({ email: email.trim().toLowerCase(), token });
  return {
    webUrl: `${base}/unsubscribe?${params.toString()}`,
    apiUrl: `${base}/api/unsubscribe?${params.toString()}`,
  };
}

/**
 * Record an email suppression:
 * 1. Upserts into `marketing_suppressions` table.
 * 2. Updates `newsletter_subscribers` setting `unsubscribed_at = now()`.
 */
export async function suppressEmail(
  email: string,
  reason = 'user_unsubscribe',
  source = 'unsubscribe_link',
): Promise<{ success: boolean; error?: string }> {
  const normalized = email.trim().toLowerCase();
  const supabase = createAdminClient();

  try {
    // 1. Insert into marketing_suppressions
    const { error: suppError } = await supabase
      .from('marketing_suppressions')
      .upsert(
        {
          email: normalized,
          reason,
          source,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'email' },
      );

    if (suppError) {
      logEvent('unsubscribe.suppression_error', {
        email: normalized,
        error: suppError.message,
      });
    }

    // 2. Mark newsletter_subscribers as unsubscribed
    const { error: subError } = await supabase
      .from('newsletter_subscribers')
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq('email', normalized)
      .is('unsubscribed_at', null);

    if (subError) {
      logEvent('unsubscribe.subscribers_update_error', {
        email: normalized,
        error: subError.message,
      });
    }

    logEvent('unsubscribe.successful', { email: normalized, reason, source });
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logEvent('unsubscribe.unhandled_error', { email: normalized, error: msg });
    return { success: false, error: msg };
  }
}
