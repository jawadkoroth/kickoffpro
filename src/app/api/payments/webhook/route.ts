import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/log';
import { withRequest } from '@/lib/observability/context';
import { enqueue } from '@/lib/jobs/queue';
import { notifyAdminsBestEffort } from '@/lib/push/webPush';
import { verifyCashfreeWebhookSignature } from '@/lib/razorpay';

/**
 * POST /api/payments/webhook
 *
 * Payment gateway webhook receiver (Razorpay & Cashfree) — SERVER-OF-TRUTH.
 *
 * Guarantees:
 *   1. Cryptographic HMAC-SHA256 signature verification with constant-time equality
 *      (timingSafeEqual) preventing timing side-channel attacks.
 *   2. Strict multi-layer idempotency:
 *      - Dedicated `payment_webhook_events` table checking (provider, event_id).
 *      - `orders.webhook_event_id` unique column check.
 *      - Atomic conditional updates (only pending -> paid or pending -> failed).
 *   3. Asynchronous execution:
 *      If a user closes their browser tab mid-payment, this backend webhook
 *      transitions the order to 'paid', stamps payment credentials, and
 *      durably enqueues email & admin push tasks without relying on client callbacks.
 */

export const runtime = 'nodejs';

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

const WEBHOOK_STALE_WARN_SECONDS = 30 * 60;

interface NormalizedPaymentEvent {
  provider: 'razorpay' | 'cashfree';
  eventId: string;
  eventType: 'payment.captured' | 'payment.failed' | 'ignored';
  orderIdOrNumber: string;
  paymentId: string;
  createdAtSeconds?: number;
  errorCode?: string;
  rawPayload: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  return withRequest(req, () => handlePOST(req));
}

async function handlePOST(req: NextRequest) {
  const rawBody = await req.text();

  // 1. Determine provider & verify cryptographic HMAC-SHA256 signature
  const rzpSignature = req.headers.get('x-razorpay-signature');
  const cfSignature = req.headers.get('x-webhook-signature') || req.headers.get('x-cf-signature');
  const cfTimestamp = req.headers.get('x-webhook-timestamp') || req.headers.get('x-cf-timestamp') || '';

  let normalized: NormalizedPaymentEvent | null = null;

  if (rzpSignature) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      logEvent('payment.webhook_misconfigured', {
        reason: 'RAZORPAY_WEBHOOK_SECRET missing',
      });
      return NextResponse.json(
        { success: false, error: 'Webhook not configured' },
        { status: 500 },
      );
    }

    const trimmedSig = rzpSignature.trim().toLowerCase();
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    if (!timingSafeEqualHex(expected, trimmedSig)) {
      logEvent('payment.webhook_bad_signature', {
        provider: 'razorpay',
        received_len: rzpSignature.length,
      });
      return NextResponse.json(
        { success: false, error: 'Invalid signature' },
        { status: 400 },
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      logEvent('payment.webhook_bad_json', { provider: 'razorpay' });
      return NextResponse.json(
        { success: false, error: 'Invalid JSON' },
        { status: 400 },
      );
    }

    const payment = parsed.payload?.payment?.entity;
    const rzpEvent = parsed.event;
    let eventType: NormalizedPaymentEvent['eventType'] = 'ignored';
    if (rzpEvent === 'payment.captured') eventType = 'payment.captured';
    else if (rzpEvent === 'payment.failed') eventType = 'payment.failed';

    normalized = {
      provider: 'razorpay',
      eventId: parsed.id || payment?.id || '',
      eventType,
      orderIdOrNumber: payment?.order_id || '',
      paymentId: payment?.id || '',
      createdAtSeconds: typeof parsed.created_at === 'number' ? parsed.created_at : undefined,
      errorCode: payment?.error_code,
      rawPayload: parsed,
    };
  } else if (cfSignature) {
    const secret = process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_API_SECRET;
    if (!secret) {
      logEvent('payment.webhook_misconfigured', {
        reason: 'CASHFREE_WEBHOOK_SECRET missing',
      });
      return NextResponse.json(
        { success: false, error: 'Webhook not configured' },
        { status: 500 },
      );
    }

    const isValid = verifyCashfreeWebhookSignature(rawBody, cfSignature, cfTimestamp, secret);
    if (!isValid) {
      logEvent('payment.webhook_bad_signature', {
        provider: 'cashfree',
        received_len: cfSignature.length,
      });
      return NextResponse.json(
        { success: false, error: 'Invalid signature' },
        { status: 400 },
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      logEvent('payment.webhook_bad_json', { provider: 'cashfree' });
      return NextResponse.json(
        { success: false, error: 'Invalid JSON' },
        { status: 400 },
      );
    }

    const cfEventId = req.headers.get('x-cf-event-id') || parsed.event_id || parsed.data?.payment?.cf_payment_id || parsed.referenceId || '';
    const cfStatus = parsed.data?.payment?.payment_status || parsed.txStatus;
    const isSuccess = parsed.type === 'PAYMENT_SUCCESS_WEBHOOK' || cfStatus === 'SUCCESS';
    const isFailed = parsed.type === 'PAYMENT_FAILED_WEBHOOK' || cfStatus === 'FAILED' || cfStatus === 'USER_DROPPED';

    let eventType: NormalizedPaymentEvent['eventType'] = 'ignored';
    if (isSuccess) eventType = 'payment.captured';
    else if (isFailed) eventType = 'payment.failed';

    normalized = {
      provider: 'cashfree',
      eventId: String(cfEventId),
      eventType,
      orderIdOrNumber: parsed.data?.order?.order_id || parsed.orderId || '',
      paymentId: String(parsed.data?.payment?.cf_payment_id || parsed.referenceId || ''),
      rawPayload: parsed,
    };
  } else {
    logEvent('payment.webhook_missing_signature', {});
    return NextResponse.json(
      { success: false, error: 'Missing webhook signature header' },
      { status: 400 },
    );
  }

  const { provider, eventId, eventType, orderIdOrNumber, paymentId, createdAtSeconds, rawPayload } = normalized;

  logEvent('payment.webhook_received', {
    provider,
    event_id: eventId,
    event_type: eventType,
    order_id_or_number: orderIdOrNumber,
    payment_id: paymentId,
  });

  // Stale event awareness
  if (createdAtSeconds) {
    const ageSeconds = Math.floor(Date.now() / 1000) - createdAtSeconds;
    if (ageSeconds > WEBHOOK_STALE_WARN_SECONDS) {
      logEvent(
        'payment.webhook_stale',
        {
          provider,
          event_id: eventId,
          age_seconds: ageSeconds,
          warn_threshold_seconds: WEBHOOK_STALE_WARN_SECONDS,
        },
        { severity: 'warn' },
      );
    }
  }

  // Acknowledge unhandled event types immediately with 200
  if (eventType === 'ignored') {
    logEvent('payment.webhook_unhandled', { provider, event_type: eventType });
    return NextResponse.json({ success: true, ignored: true });
  }

  if (!orderIdOrNumber || !eventId) {
    logEvent('payment.webhook_malformed', { provider, event_type: eventType });
    return NextResponse.json({ success: true, ignored: true });
  }

  const supabase = createAdminClient();

  // 2. Strict idempotency check against dedicated `payment_webhook_events` table
  const { data: existingProcessedEvent } = await supabase
    .from('payment_webhook_events')
    .select('id, order_id')
    .eq('provider', provider)
    .eq('event_id', eventId)
    .maybeSingle();

  if (existingProcessedEvent) {
    logEvent('payment.webhook_noop', {
      reason: 'duplicate_event_in_idempotency_table',
      provider,
      event_id: eventId,
      order_id: existingProcessedEvent.order_id,
    });
    return NextResponse.json({ success: true, idempotent: true });
  }

  // 3. Locate the order
  let orderQuery = supabase
    .from('orders')
    .select(
      'id, order_number, payment_status, order_status, webhook_event_id, product_id, size, quantity, customer, shipping_address, subtotal_paise, discount_paise, shipping_paise, cod_fee_paise, total_paise, payment_method',
    );

  if (provider === 'razorpay') {
    orderQuery = orderQuery.or(`razorpay_order_id.eq.${orderIdOrNumber},order_number.eq.${orderIdOrNumber}`);
  } else {
    orderQuery = orderQuery.or(`order_number.eq.${orderIdOrNumber},id.eq.${orderIdOrNumber}`);
  }

  const { data: order, error: lookupError } = await orderQuery.maybeSingle();

  if (lookupError || !order) {
    logEvent('payment.webhook_order_not_found', {
      provider,
      order_identifier: orderIdOrNumber,
      event_id: eventId,
    });
    return NextResponse.json({ success: true, ignored: true });
  }

  // 4. Strict idempotency check against orders.webhook_event_id
  if (order.webhook_event_id === eventId) {
    logEvent('payment.webhook_noop', {
      reason: 'duplicate_event_id_on_order',
      order_id: order.id,
      event_id: eventId,
    });
    return NextResponse.json({ success: true, idempotent: true });
  }

  // 5. State-based deduplication
  const targetStatus = eventType === 'payment.captured' ? 'paid' : 'failed';
  if (order.payment_status === targetStatus) {
    await supabase
      .from('orders')
      .update({ webhook_event_id: eventId })
      .eq('id', order.id);

    await supabase
      .from('payment_webhook_events')
      .insert({
        provider,
        event_id: eventId,
        order_id: order.id,
        event_type: eventType,
        payload: rawPayload,
      });

    logEvent('payment.webhook_noop', {
      reason: 'already_in_target_state',
      order_id: order.id,
      event_id: eventId,
      payment_status: order.payment_status,
    });
    return NextResponse.json({ success: true, idempotent: true });
  }

  // 6. Record event in `payment_webhook_events` table before mutating order state
  const { error: insertEventErr } = await supabase
    .from('payment_webhook_events')
    .insert({
      provider,
      event_id: eventId,
      order_id: order.id,
      event_type: eventType,
      payload: rawPayload,
    });

  if (insertEventErr) {
    // Unique violation (23505) indicates another concurrent webhook process handled this
    if ((insertEventErr as { code?: string }).code === '23505') {
      logEvent('payment.webhook_noop', {
        reason: 'concurrent_event_conflict',
        provider,
        event_id: eventId,
      });
      return NextResponse.json({ success: true, idempotent: true });
    }
    logEvent('payment.webhook_event_log_warning', {
      error: insertEventErr.message,
      event_id: eventId,
    });
  }

  // 7. Handle `payment.captured`
  if (eventType === 'payment.captured') {
    const updateFields: Record<string, any> = {
      payment_status: 'paid',
      razorpay_payment_id: paymentId,
      webhook_event_id: eventId,
    };
    if (order.order_status === 'pending') {
      updateFields.order_status = 'confirmed';
    }

    // Atomic conditional update: only transitions pending -> paid
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
      return NextResponse.json(
        { success: false, error: 'DB update failed' },
        { status: 500 },
      );
    }

    if (!capturedRows || capturedRows.length === 0) {
      // Browser fast path (/api/payments/verify) already won
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

    // Durably enqueue background email jobs & send admin notification
    await enqueuePaymentEmail(order, 'success', eventId, supabase);

    return NextResponse.json({ success: true });
  }

  // 8. Handle `payment.failed`
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
    // Concurrent writer flipped row to `paid` — keep stock decremented
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

  // Genuine pending -> failed transition: restore stock across all multi-line items
  await supabase.rpc('restore_order_stock', {
    p_order_id: order.id,
  });

  logEvent('payment.failed', {
    order_id: order.id,
    order_number: order.order_number,
    event_id: eventId,
    error_code: normalized.errorCode,
  });

  // Enqueue payment-failed email with retry link
  await enqueuePaymentEmail(order, 'failed', eventId, supabase);

  return NextResponse.json({ success: true });
}

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

  // Enqueue payment notification email
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
      // Enqueue order created confirmation email
      await enqueue(
        {
          kind: 'email.order_created',
          idempotencyKey: `email.order_created.${order.id}`,
          payload: { order: orderPayload },
        },
        supabase,
      );

      // Best-effort push notification to store administrators
      const lineSummary =
        items.length === 1
          ? `${firstItem?.name || 'Item'} · ${firstItem?.size || ''} × ${firstItem?.quantity || 1}`
          : `${items.length} items`;

      await notifyAdminsBestEffort(supabase, {
        title: `New paid order ${order.order_number}`,
        body: `${lineSummary} — ₹${(order.total_paise / 100).toLocaleString('en-IN')}`,
        tag: `order-${order.id}`,
        url: `/admin/orders/${order.id}`,
      });

      // Enqueue server-side Conversions API (Meta CAPI, Google, Snapchat)
      const { data: orderWithTracking } = await supabase
        .from('orders')
        .select('tracking_event_id, attribution_data')
        .eq('id', order.id)
        .single();

      const trackingEventId = orderWithTracking?.tracking_event_id || `order-${order.id}`;
      const attribution = orderWithTracking?.attribution_data || {};

      await enqueue(
        {
          kind: 'tracking.capi_purchase',
          idempotencyKey: `tracking.capi_purchase.${order.id}`,
          payload: {
            orderId: order.id,
            orderNumber: order.order_number,
            totalPaise: order.total_paise,
            eventId: trackingEventId,
            customer: order.customer,
            shippingAddress: order.shipping_address,
            items: items.map((i) => ({
              product_id: i.name,
              product_name: i.name,
              size: i.size,
              quantity: i.quantity,
              unit_price_paise: i.unit_price_paise,
              subtotal_paise: i.subtotal_paise,
            })),
            attribution,
          },
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
