import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { enforceRateLimit } from '@/lib/rateLimit';
import { logEvent } from '@/lib/log';

/**
 * Newsletter / journal subscription endpoint.
 *
 * - Rate limited at the IP level (10 hits per 10 minutes) so we
 *   don't get hammered if the form ends up on a high-traffic page.
 * - Idempotent: re-subscribing the same email is a no-op (the
 *   unique index on `email where unsubscribed_at is null` enforces
 *   it; we swallow the conflict).
 * - Returns a deliberately bland response. We never disclose
 *   "already subscribed" — that's a tiny but real enumeration
 *   leak, and the brand stance is quiet.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  email?: unknown;
  source?: unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_SOURCES = new Set(['footer', 'about', 'journal', 'product', 'homepage']);

export async function POST(req: NextRequest) {
  const limited = await enforceRateLimit(req, {
    bucket: 'newsletter.subscribe',
    max: 10,
    windowSeconds: 600,
  });
  if (limited) return limited;

  let payload: Body;
  try {
    payload = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request.' },
      { status: 400 },
    );
  }

  const email =
    typeof payload.email === 'string' ? payload.email.trim() : '';
  if (!email || email.length > 320 || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { success: false, error: 'Please provide a valid email.' },
      { status: 400 },
    );
  }

  const source =
    typeof payload.source === 'string' && ALLOWED_SOURCES.has(payload.source)
      ? payload.source
      : 'footer';

  const userAgent = req.headers.get('user-agent')?.slice(0, 500) ?? null;

  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('newsletter_subscribers')
      .insert({ email, source, user_agent: userAgent });

    if (error) {
      // Unique-violation = already subscribed. Treat as success.
      // 23505 is Postgres unique_violation.
      const isDup =
        error.code === '23505' || /duplicate key/i.test(error.message);
      if (!isDup) {
        logEvent('newsletter.insert_failed', {
          error: error.message,
          source,
        });
        return NextResponse.json(
          { success: false, error: 'Could not subscribe right now.' },
          { status: 500 },
        );
      }
    } else {
      logEvent('newsletter.subscribed', { source });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    logEvent('newsletter.unhandled', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Could not subscribe right now.' },
      { status: 500 },
    );
  }
}
