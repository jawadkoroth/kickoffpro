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
import { getSuppressedEmailsSet } from '@/lib/broadcast/audience';
import { sendSingleBroadcastEmail } from '@/lib/email/sendBroadcastEmail';

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

  // ---- email.broadcast_chunk -------------------------------------
  'email.broadcast_chunk': async (payload, supabase) => {
    const campaignId = (payload as { campaignId?: string }).campaignId;
    const rawEmails = (payload as { emails?: string[] }).emails;
    const subject = (payload as { subject?: string }).subject || '';
    const previewText = (payload as { previewText?: string | null }).previewText || null;
    const bodyHtml = (payload as { bodyHtml?: string }).bodyHtml || '';
    const ctaLabel = (payload as { ctaLabel?: string | null }).ctaLabel || null;
    const ctaUrl = (payload as { ctaUrl?: string | null }).ctaUrl || null;
    const isLastChunk = Boolean((payload as { isLastChunk?: boolean }).isLastChunk);

    if (!campaignId || !Array.isArray(rawEmails) || rawEmails.length === 0) {
      return;
    }

    // 1. Respect campaign cancellation before doing any work
    const { data: campCheck } = await supabase
      .from('email_campaigns')
      .select('status, cancelled_at, total_recipients')
      .eq('id', campaignId)
      .maybeSingle();

    if (!campCheck || campCheck.status === 'cancelled' || campCheck.cancelled_at) {
      return;
    }

    // 2. Transition campaign status to 'sending' if still 'queued'
    await supabase
      .from('email_campaigns')
      .update({ status: 'sending' })
      .eq('id', campaignId)
      .eq('status', 'queued');

    const normalizedEmails = Array.from(
      new Set(
        rawEmails
          .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
          .filter(Boolean),
      ),
    );

    if (normalizedEmails.length === 0) return;

    // 3. Re-check suppressions & opt-outs at execution time + existing sends for retry idempotency
    const [suppressedSet, { data: existingSends }] = await Promise.all([
      getSuppressedEmailsSet(supabase),
      supabase
        .from('email_campaign_sends')
        .select('email, status')
        .eq('campaign_id', campaignId)
        .in('email', normalizedEmails),
    ]);

    const doneMap = new Map<string, string>();
    for (const row of existingSends ?? []) {
      const r = row as { email: string; status: string };
      doneMap.set(r.email.toLowerCase(), r.status);
    }

    const newlySuppressed: string[] = [];
    const toSend: string[] = [];

    for (const email of normalizedEmails) {
      const prevStatus = doneMap.get(email);
      if (prevStatus === 'sent' || prevStatus === 'suppressed') {
        continue; // Already completed cleanly in an earlier attempt
      }
      if (suppressedSet.has(email)) {
        newlySuppressed.push(email);
      } else {
        toSend.push(email);
      }
    }

    if (newlySuppressed.length > 0) {
      await supabase.from('email_campaign_sends').upsert(
        newlySuppressed.map((email) => ({
          campaign_id: campaignId,
          email,
          status: 'suppressed',
          error: null,
        })),
        { onConflict: 'campaign_id,email' },
      );
    }

    let lastErrorMessage: string | null = null;

    for (let idx = 0; idx < toSend.length; idx++) {
      const email = toSend[idx];
      // Mid-chunk cancellation safety every 10 emails
      if (idx > 0 && idx % 10 === 0) {
        const { data: liveCamp } = await supabase
          .from('email_campaigns')
          .select('status, cancelled_at')
          .eq('id', campaignId)
          .maybeSingle();
        if (liveCamp?.status === 'cancelled' || liveCamp?.cancelled_at) {
          break;
        }
      }

      try {
        await sendSingleBroadcastEmail({
          to: email,
          subject,
          previewText,
          bodyHtml,
          ctaLabel,
          ctaUrl,
          isTest: false,
        });
        await supabase.from('email_campaign_sends').upsert(
          { campaign_id: campaignId, email, status: 'sent', error: null },
          { onConflict: 'campaign_id,email' },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastErrorMessage = msg;
        await supabase.from('email_campaign_sends').upsert(
          { campaign_id: campaignId, email, status: 'failed', error: msg.slice(0, 500) },
          { onConflict: 'campaign_id,email' },
        );
      }

      if (idx < toSend.length - 1) {
        await new Promise((r) => setTimeout(r, 120));
      }
    }

    // 4. Authoritative count recalculation from email_campaign_sends (race-safe & retry-safe)
    const { data: sendRows } = await supabase
      .from('email_campaign_sends')
      .select('status, error')
      .eq('campaign_id', campaignId);

    let sentCount = 0;
    let failedCount = 0;
    let suppressedCount = 0;
    let latestErr: string | null = lastErrorMessage;

    for (const r of sendRows ?? []) {
      const row = r as { status: string; error?: string | null };
      if (row.status === 'sent') sentCount += 1;
      else if (row.status === 'failed') {
        failedCount += 1;
        if (!latestErr && row.error) latestErr = row.error;
      } else if (row.status === 'suppressed') {
        suppressedCount += 1;
      }
    }

    const totalProcessed = sentCount + failedCount + suppressedCount;
    const totalExpected = campCheck.total_recipients ?? 0;
    const allDone =
      (totalExpected > 0 && totalProcessed >= totalExpected) || isLastChunk;

    const updateFields: Record<string, unknown> = {
      sent_count: sentCount,
      failed_count: failedCount,
      suppressed_count: suppressedCount,
      last_error: latestErr,
    };

    if (allDone) {
      updateFields.status = sentCount === 0 && failedCount > 0 ? 'failed' : 'sent';
      updateFields.sent_at = new Date().toISOString();
    }

    await supabase
      .from('email_campaigns')
      .update(updateFields)
      .eq('id', campaignId)
      .neq('status', 'cancelled');
  },

  // ---- checkout.abandoned_recovery --------------------------------
  'checkout.abandoned_recovery': async (payload, supabase) => {
    const abandonId = (payload as { abandonId?: string }).abandonId;
    if (!abandonId) return;

    const { data: draft } = await supabase
      .from('abandoned_checkouts')
      .select('id, phone, email, customer_name, recovered_order_id, subtotal_paise')
      .eq('id', abandonId)
      .maybeSingle();

    // Skip if already converted to a real order
    if (!draft || draft.recovered_order_id) return;

    // Ready hook for WhatsApp / Email recovery dispatch once templates are enabled
    console.log('[ABANDONED_RECOVERY_HOOK]', {
      abandonId: draft.id,
      hasPhone: Boolean(draft.phone),
      hasEmail: Boolean(draft.email),
      subtotalPaise: draft.subtotal_paise,
    });
  },
};

export function getHandler(kind: string): JobHandler | undefined {
  return handlers[kind];
}

export function listHandlerKinds(): string[] {
  return Object.keys(handlers);
}
