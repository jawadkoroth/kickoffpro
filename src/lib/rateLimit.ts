import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/log';

/**
 * KickoffPro — request rate limiting.
 *
 * Thin wrapper around the `rate_limit_hit(key, max, window_seconds)`
 * Postgres function. One round trip per check. No external infra.
 *
 * Usage in a route handler:
 *
 *   const limited = await enforceRateLimit(req, {
 *     bucket: 'coupons.validate',
 *     max: 30,
 *     windowSeconds: 60,
 *   });
 *   if (limited) return limited; // 429 already prepared
 *
 * Failure mode is FAIL-OPEN: if the limiter itself errors (DB
 * unavailable etc.) we log and let the request through. Locking
 * users out because of an observability dependency is worse than
 * temporarily allowing extra calls.
 */

export interface RateLimitOptions {
  /** Logical bucket name, prefixed onto the key. e.g. 'coupons.validate'. */
  bucket: string;
  /** Max hits permitted within the window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /**
   * Override the default key (which is `${bucket}:${ip}`). Use this
   * when limiting by user id, by coupon code, etc.
   */
  key?: string;
}

/**
 * Best-effort client IP extraction. Vercel sets `x-forwarded-for`;
 * the first entry is the original client. Falls back to a literal
 * 'unknown' so the bucket still applies (just collapsed across
 * unknowns, which is fine for abuse prevention).
 */
function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

/**
 * Check a single bucket. Returns a NextResponse only when the limit
 * has been exceeded — caller should `if (res) return res`.
 */
export async function enforceRateLimit(
  req: NextRequest,
  opts: RateLimitOptions,
): Promise<NextResponse | null> {
  const key = opts.key ?? `${opts.bucket}:${clientIp(req)}`;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('rate_limit_hit', {
      p_key: key,
      p_max: opts.max,
      p_window_seconds: opts.windowSeconds,
    });
    if (error) {
      // Fail open + log for ops.
      logEvent('ratelimit.check_failed', {
        bucket: opts.bucket,
        error: error.message,
      });
      return null;
    }
    // RPC returns a single-row table.
    const row = (Array.isArray(data) ? data[0] : data) as
      | { allowed: boolean; remaining: number; reset_at: string }
      | undefined;
    if (!row) return null;

    if (!row.allowed) {
      logEvent(
        'ratelimit.exceeded',
        { bucket: opts.bucket, key, max: opts.max, window_seconds: opts.windowSeconds },
        { severity: 'warn' },
      );
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((new Date(row.reset_at).getTime() - Date.now()) / 1000),
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Too many requests. Please try again shortly.',
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfterSeconds),
            'X-RateLimit-Limit': String(opts.max),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': row.reset_at,
          },
        },
      );
    }
    return null;
  } catch (err) {
    logEvent('ratelimit.check_failed', {
      bucket: opts.bucket,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
