import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError } from '@/lib/api-response';
import { calcShipping } from '@/lib/shipping/calcShipping';
import { enqueue } from '@/lib/jobs/queue';

/**
 * POST /api/orders/[id]/switch-to-cod
 *
 * Safeguard #3: Converts an existing unpaid/failed online order into a COD
 * order in-place — without creating a duplicate order or double-decrementing
 * inventory. Requires matching `client_request_id` or `phone` for authorization.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: orderId } = await params;
    const body = await req.json().catch(() => null);
    const clientRequestId = typeof body?.client_request_id === 'string' ? body.client_request_id : '';
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';

    if (!orderId || (!clientRequestId && !phone)) {
      return apiError(400, 'Missing order authorization details');
    }

    const supabase = createAdminClient();

    const [{ data: order, error: orderErr }, { data: shippingSettings }] = await Promise.all([
      supabase.from('orders').select('*').eq('id', orderId).single(),
      supabase
        .from('shipping_settings')
        .select('free_shipping_threshold_paise, default_shipping_charge_paise, cod_enabled, cod_fee_paise')
        .limit(1)
        .maybeSingle(),
    ]);

    if (orderErr || !order) {
      return apiError(404, 'Order not found');
    }

    const orderPhone = (order.customer as { phone?: string } | null)?.phone || '';
    const matchesRequest = clientRequestId && order.client_request_id === clientRequestId;
    const matchesPhone = phone && orderPhone === phone;
    if (!matchesRequest && !matchesPhone) {
      return apiError(403, 'Unauthorized');
    }

    if (order.payment_status === 'paid') {
      return apiError(400, 'Order is already paid');
    }
    if (order.order_status === 'cancelled') {
      return apiError(400, 'Order is cancelled');
    }
    if (order.payment_method === 'cod') {
      return apiSuccess({ order_id: order.id, total_paise: order.total_paise, cod_fee_paise: order.cod_fee_paise });
    }

    // Recompute COD pricing without prepaid discount.
    // Recover pre-prepaid discount by subtracting any prepaid discount that was applied:
    const onlineCalc = calcShipping({
      subtotalPaise: Math.max(0, (order.subtotal_paise || 0) - (order.discount_paise || 0)),
      paymentMethod: 'online',
      shippingSettings: shippingSettings ?? null,
    });
    const baseDiscount = Math.max(0, (order.discount_paise || 0) - onlineCalc.prepaidDiscountPaise);
    const postDiscountSubtotal = Math.max(0, (order.subtotal_paise || 0) - baseDiscount);

    const codQuote = calcShipping({
      subtotalPaise: postDiscountSubtotal,
      paymentMethod: 'cod',
      shippingSettings: shippingSettings ?? null,
    });

    if (!codQuote.codAllowed) {
      return apiError(400, 'Cash on Delivery is currently unavailable.');
    }

    const { error: updateErr } = await supabase
      .from('orders')
      .update({
        payment_method: 'cod',
        payment_status: 'pending',
        discount_paise: baseDiscount,
        shipping_paise: codQuote.shippingPaise,
        cod_fee_paise: codQuote.codFeePaise,
        total_paise: codQuote.totalPaise,
      })
      .eq('id', orderId)
      .eq('payment_status', order.payment_status);

    if (updateErr) {
      return apiError(500, 'Failed to switch order to COD');
    }

    await enqueue({
      kind: 'email.order_created',
      idempotencyKey: `email.order_created.${order.id}`,
      payload: {
        order: {
          id: order.id,
          order_number: order.order_number,
          product_name: order.product_name,
          size: order.size,
          quantity: order.quantity || 1,
          subtotal_paise: order.subtotal_paise,
          discount_paise: baseDiscount,
          shipping_paise: codQuote.shippingPaise,
          cod_fee_paise: codQuote.codFeePaise,
          total_paise: codQuote.totalPaise,
          payment_method: 'cod',
          customer: order.customer,
          shipping_address: order.shipping_address,
        },
      },
    }).catch(() => {});

    return apiSuccess({
      order_id: order.id,
      order_number: order.order_number,
      total_paise: codQuote.totalPaise,
      cod_fee_paise: codQuote.codFeePaise,
    });
  } catch (err) {
    console.error('[SWITCH_TO_COD_ERROR]', err);
    return apiError(500, 'Internal server error');
  }
}
