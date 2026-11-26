import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError } from '@/lib/api-response';
import { authorizeCustomerOrder } from '@/lib/orders/authorizeCustomerOrder';
import { getReturnWindowState } from '@/lib/orders/returnWindow';
import { enqueue, triggerImmediateQueueProcessing } from '@/lib/jobs/queue';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RequestedReturnItemInput {
  order_item_id?: string;
  requested_size?: string;
}

export interface StoredReturnItem {
  order_item_id: string;
  product_id: string;
  title: string;
  current_size: string;
  quantity: number;
  unit_price_paise: number;
  subtotal_paise: number;
  requested_size: string | null;
}

/**
 * POST /api/orders/[id]/return
 *
 * Customer Return / Exchange request endpoint with:
 * - Strict 7-day window anchored to `delivered_at` (fallback `updated_at`)
 * - Item-level selection (`return_items`)
 * - Required valid `requested_size` per item for exchanges
 * - Offer protection: orders with discount/coupon applied allow full-order refund only
 * - Server-calculated `estimated_refund_paise`
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      return_type?: string;
      return_reason?: string;
      return_notes?: string;
      return_items?: RequestedReturnItemInput[];
      email?: string;
      phone?: string;
    };

    const returnType =
      body.return_type === 'exchange'
        ? 'exchange'
        : body.return_type === 'refund'
          ? 'refund'
          : null;
    if (!returnType) {
      return apiError(400, 'Please select whether you want an Exchange or a Refund.');
    }

    const returnReason =
      typeof body.return_reason === 'string' ? body.return_reason.trim().slice(0, 200) : '';
    if (!returnReason) {
      return apiError(400, 'Please select a reason for your return request.');
    }

    const returnNotes =
      typeof body.return_notes === 'string' && body.return_notes.trim()
        ? body.return_notes.trim().slice(0, 1000)
        : null;

    if (returnReason.toLowerCase() === 'other' && !returnNotes) {
      return apiError(400, 'Please add a short note describing your return reason.');
    }

    const supabase = createAdminClient();
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select(
        'id, order_number, user_id, order_status, customer, delivered_at, updated_at, discount_paise, coupon_code, subtotal_paise, shipping_paise, cod_fee_paise, total_paise',
      )
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !order) {
      return apiError(404, 'Order not found');
    }

    const authorized = await authorizeCustomerOrder(req, order, body);
    if (!authorized) {
      return apiError(403, 'Unauthorized');
    }

    if (order.order_status === 'return_requested' || order.order_status === 'returned') {
      return apiError(400, 'A return request has already been submitted for this order.');
    }

    if (order.order_status !== 'delivered') {
      return apiError(
        400,
        'Returns and exchanges can only be requested after the order has been delivered.',
      );
    }

    const windowState = getReturnWindowState(order);
    if (!windowState.eligible) {
      return apiError(400, 'The 7-day return/exchange window for this order has closed.');
    }

    const { data: rawOrderItems } = await supabase
      .from('order_items')
      .select('id, product_id, product_name, size, quantity, unit_price_paise, subtotal_paise')
      .eq('order_id', id)
      .order('created_at', { ascending: true });

    const orderItems = (rawOrderItems ?? []) as Array<{
      id: string;
      product_id: string;
      product_name: string;
      size: string;
      quantity: number;
      unit_price_paise: number;
      subtotal_paise: number;
    }>;

    if (orderItems.length === 0) {
      return apiError(400, 'No line items found for this order.');
    }

    const productIds = Array.from(new Set(orderItems.map((i) => i.product_id).filter(Boolean)));
    const { data: prodRows } = await supabase
      .from('products')
      .select('id, sizes, inventory')
      .in('id', productIds);

    const productSizesMap = new Map<string, string[]>();
    for (const p of prodRows ?? []) {
      const row = p as {
        id: string;
        sizes?: string[] | null;
        inventory?: Array<{ size: string; stock: number }> | null;
      };
      const sizes =
        row.inventory && row.inventory.length > 0
          ? row.inventory.map((inv) => inv.size)
          : row.sizes && row.sizes.length > 0
            ? row.sizes
            : ['S', 'M', 'L', 'XL', 'XXL'];
      productSizesMap.set(row.id, sizes);
    }

    const hasOfferApplied =
      (order.discount_paise ?? 0) > 0 || Boolean(order.coupon_code && order.coupon_code.trim());

    const inputItems = Array.isArray(body.return_items) ? body.return_items : [];
    const itemById = new Map(orderItems.map((it) => [it.id, it]));

    const selectedEntries: StoredReturnItem[] = [];
    const seenIds = new Set<string>();

    for (const reqItem of inputItems) {
      const itemId = typeof reqItem.order_item_id === 'string' ? reqItem.order_item_id : '';
      if (!itemId || seenIds.has(itemId)) continue;
      const line = itemById.get(itemId);
      if (!line) continue;
      seenIds.add(itemId);

      const allowedSizes = productSizesMap.get(line.product_id) ?? ['S', 'M', 'L', 'XL', 'XXL'];
      const requestedSize =
        typeof reqItem.requested_size === 'string' && reqItem.requested_size.trim()
          ? reqItem.requested_size.trim()
          : null;

      if (returnType === 'exchange') {
        if (!requestedSize) {
          return apiError(400, `Please select a new size for "${line.product_name}".`);
        }
        if (!allowedSizes.includes(requestedSize)) {
          return apiError(
            400,
            `Requested size "${requestedSize}" is not valid for "${line.product_name}".`,
          );
        }
      }

      selectedEntries.push({
        order_item_id: line.id,
        product_id: line.product_id,
        title: line.product_name,
        current_size: line.size,
        quantity: line.quantity,
        unit_price_paise: line.unit_price_paise,
        subtotal_paise: line.subtotal_paise,
        requested_size: returnType === 'exchange' ? requestedSize : null,
      });
    }

    if (selectedEntries.length === 0) {
      return apiError(400, 'Please select at least one item for your return or exchange.');
    }

    if (returnType === 'refund' && hasOfferApplied && selectedEntries.length !== orderItems.length) {
      return apiError(
        400,
        'Because a promotional offer/coupon was applied to this order, refunds are only available for the full order.',
      );
    }

    let estimatedRefundPaise = 0;
    if (returnType === 'refund') {
      if (selectedEntries.length === orderItems.length) {
        // Full order return: refund customer's actual net paid product total
        const netProductsPaid = Math.max(
          0,
          (order.total_paise ?? 0) - (order.shipping_paise ?? 0) - (order.cod_fee_paise ?? 0),
        );
        estimatedRefundPaise = netProductsPaid;
      } else {
        estimatedRefundPaise = selectedEntries.reduce((sum, it) => sum + it.subtotal_paise, 0);
      }
    }

    const nowIso = new Date().toISOString();

    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      .update({
        order_status: 'return_requested',
        return_type: returnType,
        return_reason: returnReason,
        return_notes: returnNotes,
        return_items: selectedEntries,
        estimated_refund_paise: estimatedRefundPaise,
        return_status: 'requested',
        return_requested_at: nowIso,
        last_activity_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', id)
      .eq('order_status', 'delivered')
      .select('id')
      .maybeSingle();

    if (updateErr || !updated) {
      return apiError(409, 'Could not submit return request; please refresh and try again.');
    }

    await enqueue(
      {
        kind: 'push.admin_notify',
        idempotencyKey: `push.return_request.${id}`,
        payload: {
          push: {
            title: `Return Request (${returnType.toUpperCase()}) — ${order.order_number}`,
            body: `${selectedEntries.length} item(s) · ${returnReason}`,
            url: `/admin/orders/${id}`,
            tag: `return-${id}`,
          },
        },
      },
      supabase,
    );
    triggerImmediateQueueProcessing();

    logEvent(
      'order.return_requested',
      {
        order_id: id,
        order_number: order.order_number,
        return_type: returnType,
        return_reason: returnReason,
        item_count: selectedEntries.length,
        estimated_refund_paise: estimatedRefundPaise,
      },
      { source: 'api', entityType: 'order', entityId: id },
    );

    return apiSuccess({
      order_status: 'return_requested',
      return_type: returnType,
      return_reason: returnReason,
      return_items: selectedEntries,
      estimated_refund_paise: estimatedRefundPaise,
      return_status: 'requested',
      return_requested_at: nowIso,
    });
  } catch (err) {
    logEvent(
      'order.return_request_error',
      { error: err instanceof Error ? err.message : String(err) },
      { source: 'api', severity: 'error' },
    );
    return apiError(500, 'Failed to submit return request');
  }
}
