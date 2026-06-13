import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/log';
import { withRequest } from '@/lib/observability/context';
import { enqueue } from '@/lib/jobs/queue';

/**
 * POST /api/payments/webhook
 *
 * Razorpay webhook receiver — the SERVER-OF-TRUTH for payment state.
 *
 * Contract:
 *   - Verifies `X-Razorpay-Signature` HMAC-SHA256 over the raw body
 *     using `RAZORPAY_WEBHOOK_SECRET`. Mismatch => 400, no DB write.
 *   - Handles `payment.captured` (=> payment_status='paid') and
 *     `payment.failed` (=> payment_status='failed' + restore stock).
 *   - Idempotent on every axis:
 *       * If `webhook_event_id` already matches the incoming event,
 *         the call is a 200 no-op.
 *       * If the order is already in the target terminal state, the
 *         call is a 200 no-op (we still record the event id).
 *   - Always returns 200 once the signature is valid; Razorpay treats
 *     non-2xx as a retry trigger and we don't want to amplify load
 *     for events we've already processed.
 *
 * `/api/payments/verify` (browser-driven) remains the fast UX path
 * for the success page; both routes converge on the same DB state
 * via a conditional UPDATE pattern, so neither can clobber the other.
 */

// Razorpay sends event payloads with the body bytes hashed; Next.js
// app router gives us the raw text via `req.text()`. We pin the
// runtime to nodejs because edge has no built-in `crypto`.
export const runtime = 'nodejs';

type RazorpayPaymentEntity = {
  id: string;
  order_id: string;
  status?: string;
  error_code?: string;
  error_description?: string;
};

type RazorpayEvent = {
  id: string;
  event: string;
  // Unix epoch (seconds) at which Razorpay generated the event.
  // Used for replay-window enforcement.
  created_at?: number;
  payload?: {
    payment?: { entity?: RazorpayPaymentEntity };
  };
};

/**
 * Threshold (seconds) above which a webhook event is logged as
 * unusually stale. We do NOT reject stale events — Razorpay retries
 * for up to 24h after a 5xx and we want every real retry to land —
 * but a fresh delivery of a multi-hour-old event is a strong
 * indicator of secret leakage or replay, worth surfacing in the
 * admin diagnostics surface for review.
 */
const WEBHOOK_STALE_WARN_SECONDS = 30 * 60;

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  return withRequest(req, () => handlePOST(req));
}

async function handlePOST(req: NextRequest) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    logEvent('payment.webhook_misconfigured', {
      reason: 'RAZORPAY_WEBHOOK_SECRET missing',
    });
    // 500 so Razorpay retries once we configure the secret.
    return NextResponse.json(
      { success: false, error: 'Webhook not configured' },
      { status: 500 },
    );
  }

  // Raw body is REQUIRED for signature verification — never re-stringify.
  const rawBody = await req.text();
  const signature = req.headers.get('x-razorpay-signature') || '';

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  if (!timingSafeEqualHex(expected, signature)) {
    logEvent('payment.webhook_bad_signature', {
      received_len: signature.length,
    });
    return NextResponse.json(
      { success: false, error: 'Invalid signature' },
      { status: 400 },
    );
  }

  let event: RazorpayEvent;
  try {
    event = JSON.parse(rawBody) as RazorpayEvent;
  } catch {
    logEvent('payment.webhook_bad_json', {});
    return NextResponse.json(
      { success: false, error: 'Invalid JSON' },
      { status: 400 },
    );
  }

  const eventId = event.id;
  const eventType = event.event;
  const payment = event.payload?.payment?.entity;

  logEvent('payment.webhook_received', {
    event_id: eventId,
    event_type: eventType,
    razorpay_order_id: payment?.order_id,
    razorpay_payment_id: payment?.id,
  });

  // Observability: surface unusually stale events. Does NOT reject
  // (see WEBHOOK_STALE_WARN_SECONDS comment).
  if (typeof event.created_at === 'number') {
    const ageSeconds = Math.floor(Date.now() / 1000) - event.created_at;
    if (ageSeconds > WEBHOOK_STALE_WARN_SECONDS) {
      logEvent(
        'payment.webhook_stale',
        {
          event_id: eventId,
          event_type: eventType,
          age_seconds: ageSeconds,
          warn_threshold_seconds: WEBHOOK_STALE_WARN_SECONDS,
        },
        { severity: 'warn' },
      );
    }
  }

  // Only react to events we model. Anything else is acknowledged
  // (200) so Razorpay stops retrying, and we log it for awareness.
  if (eventType !== 'payment.captured' && eventType !== 'payment.failed') {
    logEvent('payment.webhook_unhandled', { event_type: eventType });
    return NextResponse.json({ success: true, ignored: true });
  }

  if (!payment?.order_id || !payment.id || !eventId) {
    logEvent('payment.webhook_malformed', { event_type: eventType });
    // 200 because retrying won't fix a malformed event.
    return NextResponse.json({ success: true, ignored: true });
  }

  const supabase = createAdminClient();

  // Pull the customer + total + payment_method too — we'll need them
  // for the post-transition lifecycle email. Cheap addition; the row
  // is already being read.
  const { data: order, error: lookupError } = await supabase
    .from('orders')
    .select(
      'id, order_number, payment_status, order_status, webhook_event_id, product_id, size, quantity, customer, shipping_address, subtotal_paise, discount_paise, shipping_paise, cod_fee_paise, total_paise, payment_method',
    )
    .eq('razorpay_order_id', payment.order_id)
    .single();

  if (lookupError || !order) {
    logEvent('payment.webhook_order_not_found', {
      razorpay_order_id: payment.order_id,
      event_id: eventId,
    });
    // 200 — we don't want Razorpay to retry forever for an order
    // that doesn't exist in our DB (e.g. a mis-routed event).
    return NextResponse.json({ success: true, ignored: true });
  }

  // Event-id dedupe: same delivery applied twice is a no-op.
  if (order.webhook_event_id === eventId) {
    logEvent('payment.webhook_noop', {
      reason: 'duplicate_event_id',
      order_id: order.id,
      event_id: eventId,
    });
    return NextResponse.json({ success: true, idempotent: true });
  }

  // State-based dedupe: if the order is already in the target
  // terminal state, this is a no-op apart from recording the event id.
  const targetStatus = eventType === 'payment.captured' ? 'paid' : 'failed';
  if (order.payment_status === targetStatus) {
    await supabase
      .from('orders')
      .update({ webhook_event_id: eventId })
      .eq('id', order.id);
    logEvent('payment.webhook_noop', {
      reason: 'already_in_target_state',
      order_id: order.id,
      event_id: eventId,
      payment_status: order.payment_status,
    });
    return NextResponse.json({ success: true, idempotent: true });
  }

  if (eventType === 'payment.captured') {
    // Conditional update: only flip from `pending` to `paid`. If
    // /api/payments/verify already raced us and won, the row is
    // already `paid` and we'd have short-circuited above; if it
    // landed between our two queries, the WHERE clause prevents a
    // double-write. `.select('id')` lets us count actually-mutated
    // rows so we only fire the success email on a genuine
    // pending → paid transition (never twice).
    const updateFields: Record<string, any> = {
      payment_status: 'paid',
      razorpay_payment_id: payment.id,
      webhook_event_id: eventId,
    };
    if (order.order_status === 'pending') {
      updateFields.order_status = 'confirmed';
    }

    const { data: capturedRows, error: updErr } = await supabase
      .from('orders')
      .update(updateFields)
      .eq('id', order.id)
      .eq('payment_status', 'pending')
      .select('id');

    if (updErr) {
      logEvent('payment.webhook_update_failed', {
        order_id: order.id,
        event_id: eventId,
        error: updErr.message,
      });
      // 500 so Razorpay retries — the DB error was transient.
      return NextResponse.json(
        { success: false, error: 'DB update failed' },
        { status: 500 },
      );
    }

    if (!capturedRows || capturedRows.length === 0) {
      // Concurrent verify already flipped this to `paid`. The
      // state-dedupe block above usually catches this, but a tight
      // race can land here. Stamp the event id and skip email — we
      // never want to double-send on a non-transition.
      await supabase
        .from('orders')
        .update({ webhook_event_id: eventId })
        .eq('id', order.id);
      logEvent('payment.webhook_noop', {
        reason: 'state_changed_concurrently',
        order_id: order.id,
        event_id: eventId,
      });
      return NextResponse.json({ success: true, idempotent: true });
    }

    logEvent('payment.captured', {
      order_id: order.id,
      order_number: order.order_number,
      event_id: eventId,
    });

    // Durable enqueue for the payment-success email. The DB transition
    // above is already idempotent (gated on payment_status='pending'),
    // so this branch executes EXACTLY ONCE per genuine capture even if
    // Razorpay re-delivers the same event. The job's idempotency key
    // collapses any pathological double-enqueue to a single row.
    await enqueuePaymentEmail(order, 'success', eventId, supabase);

    return NextResponse.json({ success: true });
  }

  // payment.failed
  //
  // Tighten the predicate to `pending` (was `!= 'paid'`): the only
  // legal source state for `failed` is `pending`. `failed` and
  // `refunded` are already handled by the state-dedupe block above,
  // and `paid` must never be downgraded. `.select('id')` lets us
  // count the rows we actually mutated so stock restoration is
  // gated on a genuine pending → failed transition — closing the
  // race where /api/payments/verify flips the row to `paid`
  // between our SELECT (line 129) and UPDATE here.
  const { data: failedUpdatedRows, error: updErr } = await supabase
    .from('orders')
    .update({
      payment_status: 'failed',
      webhook_event_id: eventId,
    })
    .eq('id', order.id)
    .eq('payment_status', 'pending')
    .select('id');

  if (updErr) {
    logEvent('payment.webhook_update_failed', {
      order_id: order.id,
      event_id: eventId,
      error: updErr.message,
    });
    return NextResponse.json(
      { success: false, error: 'DB update failed' },
      { status: 500 },
    );
  }

  if (!failedUpdatedRows || failedUpdatedRows.length === 0) {
    // Concurrent writer (most likely /api/payments/verify) flipped
    // the row to `paid` between our SELECT and this UPDATE. Do NOT
    // restore stock — a paid order's inventory must stay
    // decremented. Stamp the event id so this exact delivery hits
    // the line-148 dedupe on retry instead of re-running this
    // branch.
    await supabase
      .from('orders')
      .update({ webhook_event_id: eventId })
      .eq('id', order.id);
    logEvent('payment.webhook_noop', {
      reason: 'state_changed_concurrently',
      order_id: order.id,
      event_id: eventId,
    });
    return NextResponse.json({ success: true, idempotent: true });
  }

  // Genuine pending → failed transition: restore stock exactly
  // once. Multi-line aware — `restore_order_stock` loops over every
  // order_items row for this order. Legacy single-line orders
  // backfilled by migration 022 also have an order_items row, so
  // this RPC works uniformly across pre-B1 and post-B1 data.
  await supabase.rpc('restore_order_stock', {
    p_order_id: order.id,
  });

  logEvent('payment.failed', {
    order_id: order.id,
    order_number: order.order_number,
    event_id: eventId,
    error_code: payment.error_code,
  });

  // Durable enqueue for the payment-failed email with retry guidance.
  await enqueuePaymentEmail(order, 'failed', eventId, supabase);

  return NextResponse.json({ success: true });
}

/**
 * Build the lifecycle email payload from the order row + product
 * lookup and enqueue it. Idempotency key is scoped to (order, kind,
 * razorpay_event_id) so even if a malformed retry slipped past the
 * DB-level dedupe, the queue still collapses it to one delivery.
 */
async function enqueuePaymentEmail(
  order: {
    id: string;
    order_number: string;
    customer: { name: string; phone: string; email?: string };
    shipping_address?: {
      line1: string;
      line2?: string;
      city: string;
      state: string;
      pincode: string;
    };
    subtotal_paise?: number | null;
    discount_paise?: number | null;
    shipping_paise?: number | null;
    cod_fee_paise?: number | null;
    total_paise: number;
    payment_method: string;
  },
  kind: 'success' | 'failed',
  eventId: string,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<void> {
  // Read every line from order_items. Migration 022 backfilled
  // legacy single-line orders so this query always returns >= 1 row
  // for any orders.id that exists.
  const { data: itemRows } = await supabase
    .from('order_items')
    .select('product_name, size, quantity, unit_price_paise, subtotal_paise, image_url')
    .eq('order_id', order.id)
    .order('created_at', { ascending: true });

  const items = (itemRows ?? []).map((row) => ({
    name: (row as { product_name: string }).product_name,
    size: (row as { size: string }).size,
    quantity: (row as { quantity: number }).quantity,
    unit_price_paise: (row as { unit_price_paise: number }).unit_price_paise,
    subtotal_paise: (row as { subtotal_paise: number }).subtotal_paise,
    image_url: (row as { image_url: string | null }).image_url,
  }));

  // Legacy fields populated from the FIRST line so the current
  // email template (B4 will rewrite to use items[]) renders
  // something sensible. For multi-line orders the user sees the
  // first line in the headline block plus the full items array
  // once B4 ships its updated template.
  const firstItem = items[0];

  const orderPayload = {
    id: order.id,
    order_number: order.order_number,
    customer: order.customer,
    product_name: firstItem?.name || 'Product',
    size: firstItem?.size || '',
    quantity: firstItem?.quantity ?? 1,
    subtotal_paise: order.subtotal_paise,
    discount_paise: order.discount_paise,
    shipping_paise: order.shipping_paise,
    cod_fee_paise: order.cod_fee_paise,
    total_paise: order.total_paise,
    payment_method: order.payment_method,
    shipping_address: order.shipping_address,
    image_url: firstItem?.image_url ?? null,
    items,
  };

  await enqueue(
    {
      kind: kind === 'success' ? 'email.payment_success' : 'email.payment_failed',
      idempotencyKey: `email.payment_${kind}.${order.id}.${eventId}`,
      payload: { order: orderPayload },
    },
    supabase,
  );

  if (kind === 'success') {
    try {
      await enqueue(
        {
          kind: 'email.order_created',
          idempotencyKey: `email.order_created.${order.id}`,
          payload: { order: orderPayload },
        },
        supabase,
      );
    } catch (err) {
      logEvent('payment.webhook_order_created_email_failed', {
        order_id: order.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
