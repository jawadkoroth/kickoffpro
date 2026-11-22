import { logEvent } from '@/lib/log';
import { getUnsubscribeUrls } from './unsubscribe';
import { renderBroadcastEmail, type BroadcastRenderOptions } from './templates/broadcastEmail';

export { renderBroadcastEmail, type BroadcastRenderOptions };

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://kickoffpro.in'
  );
}

/**
 * Dispatch a single broadcast/marketing email via Resend with proper List-Unsubscribe headers.
 */
export async function sendSingleBroadcastEmail(opts: {
  to: string;
  subject: string;
  previewText?: string | null;
  bodyHtml: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  isTest?: boolean;
}): Promise<{ id?: string }> {
  const { to, subject, previewText, bodyHtml, ctaLabel, ctaUrl, isTest } = opts;
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY is not configured in environment variables');
  }

  const { Resend } = await import('resend');
  const resend = new Resend(resendApiKey);
  const from = process.env.EMAIL_FROM || 'KickoffPro Offers <orders@kickoffpro.in>';

  const { webUrl, apiUrl } = getUnsubscribeUrls(to);

  const html = renderBroadcastEmail({
    subject,
    previewText,
    bodyHtml,
    ctaLabel,
    ctaUrl,
    unsubscribeUrl: webUrl,
    siteUrl: siteUrl(),
  });

  const finalSubject = isTest ? `[TEST] ${subject}` : subject;

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: finalSubject,
    html,
    headers: {
      'List-Unsubscribe': `<${apiUrl}>, <${webUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });

  if (error) {
    throw new Error(`Resend broadcast error: ${error.message} (${error.name || 'SEND_ERROR'})`);
  }

  return { id: data?.id };
}

/**
 * Paced chunk delivery for broadcast jobs.
 * Sends emails sequentially with small delays (~150ms) to ensure
 * Resend rate limits are strictly observed.
 */
export async function sendBroadcastChunk(opts: {
  emails: string[];
  subject: string;
  previewText?: string | null;
  bodyHtml: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
}): Promise<{ sent: number; failed: number; errors: string[] }> {
  const { emails, subject, previewText, bodyHtml, ctaLabel, ctaUrl } = opts;
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < emails.length; i++) {
    const to = emails[i];
    try {
      await sendSingleBroadcastEmail({
        to,
        subject,
        previewText,
        bodyHtml,
        ctaLabel,
        ctaUrl,
      });
      sent++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${to}: ${msg}`);
      logEvent('broadcast.item_failed', { to, error: msg });
    }

    // Pacing delay between requests (~150ms) to stay well within API rate limits
    if (i < emails.length - 1) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  return { sent, failed, errors };
}
