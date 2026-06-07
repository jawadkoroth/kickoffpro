import webpush, { WebPushError } from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * KickoffPro — Web Push helper.
 *
 * Wraps the `web-push` lib with:
 *
 *   - Lazy VAPID configuration (env vars). The library mutates
 *     module-level state on `setVapidDetails`; we guard with a
 *     boolean so repeated calls are no-ops.
 *
 *   - `notifyAdmins()` fans out a single payload to every active
 *     admin subscription. Dead endpoints (HTTP 404 / 410) are
 *     pruned in-line so a stale row never poisons future sends.
 *
 *   - Returns counts so the caller can log fan-out outcomes
 *     without crashing on transient failures.
 *
 * Configuration:
 *   VAPID_PUBLIC_KEY    base64url public key (uncompressed P-256)
 *   VAPID_PRIVATE_KEY   base64url private key
 *   VAPID_SUBJECT       mailto: or https:// contact URI
 *
 * The public key is also returned to the browser via
 * /api/admin/push/vapid so AdminPushPrompt can subscribe.
 *
 * If any var is missing, push is treated as "not configured":
 * `isPushConfigured()` returns false and `notifyAdmins()` early-
 * returns. The realtime + Notification API path keeps working
 * regardless — push is purely additive.
 */

let vapidConfigured = false;

export function isPushConfigured(): boolean {
  return !!(
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
  );
}

export function getPublicVapidKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  if (!isPushConfigured()) return false;
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!,
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    vapidConfigured = true;
    return true;
  } catch (err) {
    console.error('[PUSH_VAPID_INIT]', err);
    return false;
  }
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface AdminPushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/**
 * Send `payload` to every admin push subscription.
 *
 * Supabase admin client must be passed in by the caller — this
 * helper lives in /lib so we can't import the admin client
 * directly without creating a circular dep with the Supabase
 * cookie middleware.
 *
 * Returns { sent, pruned, errored } counts. Never throws.
 */
export async function notifyAdmins(
  supabase: SupabaseClient,
  payload: AdminPushPayload,
): Promise<{ sent: number; pruned: number; errored: number }> {
  if (!ensureVapid()) {
    return { sent: 0, pruned: 0, errored: 0 };
  }

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth');

  if (error) {
    console.error('[PUSH_FETCH_SUBS]', error);
    return { sent: 0, pruned: 0, errored: 0 };
  }

  if (!subs || subs.length === 0) {
    return { sent: 0, pruned: 0, errored: 0 };
  }

  const message = JSON.stringify(payload);
  const deadIds: string[] = [];
  const okIds: string[] = [];
  let errored = 0;

  await Promise.all(
    (subs as SubscriptionRow[]).map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          message,
          { TTL: 60 },
        );
        okIds.push(s.id);
      } catch (err) {
        const status = (err as WebPushError)?.statusCode;
        if (status === 404 || status === 410) {
          // Subscription is dead (uninstalled, expired, replaced).
          // Prune to keep the table clean.
          deadIds.push(s.id);
        } else {
          errored += 1;
          console.error('[PUSH_SEND_ERROR]', status, (err as Error)?.message);
        }
      }
    }),
  );

  if (deadIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', deadIds);
  }

  if (okIds.length > 0) {
    // Best-effort touch so an admin tracking "last_used_at" sees
    // recent activity. Failure is non-fatal.
    await supabase
      .from('push_subscriptions')
      .update({ last_used_at: new Date().toISOString() })
      .in('id', okIds);
  }

  return { sent: okIds.length, pruned: deadIds.length, errored };
}

/**
 * Fire-and-forget admin push fan-out for *real-time* code paths
 * (order creation, webhook state changes, admin status updates).
 *
 * Why this exists:
 *   The job queue is the right tool for emails — they have an
 *   external dependency (Resend) that can briefly fail, and a
 *   30-second delay is invisible to the recipient. It is the WRONG
 *   tool for "wake the admin up about a new order": GitHub Actions
 *   schedule events skew 5\u201315 minutes under load, so a queued
 *   push can land long after the customer has already moved on.
 *
 *   Web push is fast (<2s typical), idempotent on `tag` (the SW
 *   collapses duplicates, so even an accidental double-fire is
 *   harmless), and our `notifyAdmins` helper already prunes dead
 *   subscriptions inline. There is no benefit to deferring it.
 *
 * Contract:
 *   * Returns within `timeoutMs` no matter what \u2014 the caller's
 *     happy path (e.g. POST /api/orders) is never blocked beyond
 *     this budget.
 *   * Never throws. Errors and timeouts land in `app_events`.
 *   * Logs the fan-out outcome (`push.admin_fanout`) on every call
 *     and a `push.admin_no_active_subs` warning when the table is
 *     empty so silent-no-delivery never goes unnoticed.
 */
export async function notifyAdminsBestEffort(
  supabase: SupabaseClient,
  payload: AdminPushPayload,
  timeoutMs = 3000,
): Promise<void> {
  // Lazy import avoids a static cycle: webPush is imported by job
  // handlers, which are imported by /api routes; logEvent already
  // pulls the supabase admin client and we don't want that dep at
  // module load time on edge-adjacent runtimes.
  const { logEvent } = await import('@/lib/log');

  const fanout = (async () => {
    try {
      const result = await notifyAdmins(supabase, payload);
      logEvent(
        'push.admin_fanout',
        {
          tag: payload.tag ?? null,
          sent: result.sent,
          pruned: result.pruned,
          errored: result.errored,
        },
        { source: 'system' },
      );
      if (result.sent === 0 && result.pruned === 0 && result.errored === 0) {
        // Table was empty \u2014 either no admin has subscribed yet, or
        // every subscription was pruned on a previous run. Surface
        // this so the operator notices BEFORE the next missed order.
        logEvent(
          'push.admin_no_active_subs',
          { tag: payload.tag ?? null },
          { source: 'system', severity: 'warn' },
        );
      }
    } catch (err) {
      logEvent(
        'push.admin_fanout_failed',
        { error: err instanceof Error ? err.message : String(err) },
        { source: 'system', severity: 'error' },
      );
    }
  })();

  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      // The fan-out continues in the background; we just stop
      // waiting on it so the caller can return to the user.
      resolve();
    }, timeoutMs);
  });

  await Promise.race([fanout, timeout]);
}
