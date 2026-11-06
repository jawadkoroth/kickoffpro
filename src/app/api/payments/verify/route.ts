import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError } from '@/lib/api-response';
import { verifyPaymentSignature } from '@/lib/razorpay';
import { logEvent } from '@/lib/log';
import { enqueue } from '@/lib/jobs/queue';
import { notifyAdminsBestEffort } from '@/lib/push/webPush';

/**
 * POST /api/payments/verify
 *
 * Browser-driven fast path for the success page. Verifies the
 * client-supplied Razorpay signature and best-effort flips the
 * order to `paid` so the order detail page renders correctly
 * without waiting for the webhook.
 *
 * The Razorpay WEBHOOK is the source of truth (`/api/payments/webhook`);
 * this route is structured so it cannot conflict with it:
 *
 *   - We use a conditional UPDATE that only flips
 *     `pending → paid`. If the webhook already won, the row is
 *     already `paid`, our update affects 0 rows, and we still
 *     return success (the user's payment IS valid).
 *   - We never call `restore_stock` here. Stock restoration on
 *     payment failure is solely the webhook's job, so we can't
 *     race it into a double-restore.
 *   - On bad signature, we mark `failed` only if the row is still
 *     `pending` (so a paid-via-webhook row stays paid).
 */
export async function POST(req: NextRequest) {
  try {
    const { order_id, razorpay_payment_id, razorpay_signature } =
      await req.json();

    if (!order_id || !razorpay_payment_id || !razorpay_signature) {
      return apiError(400, 'Missing required fields');
    }

    const supabase = createAdminClient();

    // 1. Load the order. We need `razorpay_order_id` for signature
    // verification; everything else is for downstream UX (email).
    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', order_id)
      .single();

    if (error || !order) {
      return apiError(404, 'Order not found');
    }

    // 2. Already paid? Webhook beat us — that's the happy path,
    // not an error. Return success so the client routes to the
    // order page as usual.
    if (order.payment_status === 'paid') {
      logEvent('payment.verify_already_paid', {
        order_id: order.id,
        order_number: order.order_number,
      });
      return apiSuccess({ message: 'Payment already verified' });
    }

    // 3. Verify the signature cryptographically using HMAC-SHA256 with constant-time equality.
    const isValid = verifyPaymentSignature(
      order.razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    );

    if (!isValid) {
      logEvent('payment.verify_bad_signature', {
        order_id: order.id,
        order_number: order.order_number,
      });
      // Only flip to `failed` if still `pending` — never downgrade
      // a paid-via-webhook row. We do NOT restore stock here; the
      // webhook owns that side of the lifecycle.
      await supabase
        .from('orders')
        .update({ payment_status: 'failed' })
        .eq('id', order_id)
        .eq('payment_status', 'pending');

      return apiError(400, 'Payment verification failed');
    }

    const updateFields: Record<string, any> = {
      payment_status: 'paid',
      razorpay_payment_id,
      razorpay_signature,
    };
    if (order.order_status === 'pending') {
      updateFields.order_status = 'confirmed';
    }

    // 4. Conditional flip: only `pending → paid`. If the webhook
    // landed between step 2 and step 4, the WHERE clause keeps us
    // from clobbering its state.
    const { data: updatedOrders, error: updateError } = await supabase
      .from('orders')
      .update(updateFields)
      .eq('id', order_id)
      .eq('payment_status', 'pending')
      .select('id');

    if (updateError) {
      logEvent('payment.verify_update_failed', {
        order_id: order.id,
        error: updateError.message,
      });
      return apiError(500, 'Failed to record payment');
    }

    logEvent('payment.verify_success', {
      order_id: order.id,
      order_number: order.order_number,
    });

    // 5. Enqueue lifecycle jobs and send admin push if we won the transition race
    if (updatedOrders && updatedOrders.length > 0) {
      try {
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

        // Enqueue payment success and order created emails with idempotent keys
        await enqueue(
          {
            kind: 'email.payment_success',
            idempotencyKey: `email.payment_success.${order.id}.${razorpay_payment_id}`,
            payload: { order: orderPayload },
          },
          supabase,
        );

        await enqueue(
          {
            kind: 'email.order_created',
            idempotencyKey: `email.order_created.${order.id}`,
            payload: { order: orderPayload },
          },
          supabase,
        );

        // Record in payment_webhook_events table for uniform audit & idempotency
        await supabase
          .from('payment_webhook_events')
          .insert({
            provider: 'razorpay_verify',
            event_id: razorpay_payment_id,
            order_id: order.id,
            event_type: 'payment.verified',
            payload: { razorpay_order_id: order.razorpay_order_id, razorpay_payment_id },
          });

        // Fire-and-forget push notification to store admins
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
        const trackingEventId = order.tracking_event_id || `order-${order.id}`;
        const attribution = order.attribution_data || {};

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
        logEvent('payment.verify_enqueue_failed', {
          order_id: order.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return apiSuccess({ message: 'Payment verified successfully' });
  } catch (err) {
    logEvent('payment.verify_unhandled_error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return apiError(500, 'Internal server error');
  }
}
