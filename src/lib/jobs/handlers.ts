import type { SupabaseClient } from '@supabase/supabase-js';
import {
  sendOrderCreatedEmail,
  sendPaymentSuccessEmail,
  sendPaymentFailedEmail,
  sendOrderStatusEmail,
  type OrderEmailData,
  type OrderStatusForEmail,
} from '@/lib/email';
import { notifyAdmins, type AdminPushPayload } from '@/lib/push/webPush';
import {
  dispatchServerPurchaseTracking,
  type ServerPurchaseEventData,
} from '@/lib/tracking/server';

/**
 * KickoffPro — job handler registry.
 *
 * Each entry is a pure async function that takes `(payload, supabase)`
 * and throws on failure so the runner can retry. Handlers must be:
 *
 *   * Idempotent on replay — the runner may invoke the same job
 *     twice if a previous invocation crashed AFTER doing some work
 *     but BEFORE the DB was updated to `succeeded`. Our handlers
 *     delegate to primitives that are already idempotent (Resend
 *     dedupes nothing, but duplicate transactional emails are
 *     extremely low-harm; push providers collapse on tag).
 *   * Fast (< 30s) — the default lease is 120s, so any work longer
 *     than that risks lease expiry and a concurrent re-run.
 *   * Free of request-scoped state — they run from cron, not from
 *     a user request. Do NOT call `getRequestContext()` etc.
 */

export type JobHandler = (
  payload: Record<string, unknown>,
  supabase: SupabaseClient,
) => Promise<void>;

function requireOrder(payload: Record<string, unknown>): OrderEmailData {
  const order = (payload as { order?: OrderEmailData }).order;
  if (!order || typeof order !== 'object' || !order.order_number) {
    throw new Error('email job payload missing `order`');
  }
  return order;
}

const handlers: Record<string, JobHandler> = {
  // ---- email.* ----------------------------------------------------
  'email.order_created': async (payload) => {
    await sendOrderCreatedEmail(requireOrder(payload));
  },
  'email.payment_success': async (payload) => {
    await sendPaymentSuccessEmail(requireOrder(payload));
  },
  'email.payment_failed': async (payload) => {
    await sendPaymentFailedEmail(requireOrder(payload));
  },
  'email.order_status': async (payload) => {
    const order = requireOrder(payload);
    const status = (payload as { status?: string }).status as
      | OrderStatusForEmail
      | undefined;
    if (!status) throw new Error('order_status job payload missing `status`');
    await sendOrderStatusEmail(order, status);
  },

  // ---- push.* -----------------------------------------------------
  'push.admin_notify': async (payload, supabase) => {
    const push = (payload as { push?: AdminPushPayload }).push;
    if (!push || !push.title) {
      throw new Error('push job payload missing `push`');
    }
    const result = await notifyAdmins(supabase, push);
    // If every delivery errored (and none were pruned) we want the
    // runner to retry — likely a transient VAPID / network issue.
    if (result.sent === 0 && result.errored > 0 && result.pruned === 0) {
      throw new Error(`push fan-out errored: ${result.errored} subs`);
    }
  },

  // ---- tracking.* -------------------------------------------------
  'tracking.capi_purchase': async (payload) => {
    const data = (payload as { trackingData?: ServerPurchaseEventData })?.trackingData ||
      (payload as unknown as ServerPurchaseEventData);
    if (!data || !data.orderId || !data.orderNumber) {
      throw new Error('tracking.capi_purchase payload missing order details');
    }
    await dispatchServerPurchaseTracking(data);
  },
};

export function getHandler(kind: string): JobHandler | undefined {
  return handlers[kind];
}

export function listHandlerKinds(): string[] {
  return Object.keys(handlers);
}
