import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError } from '@/lib/api-response';
import { authorizeCustomerOrder } from '@/lib/orders/authorizeCustomerOrder';
import { notifyOrderCancelled } from '@/lib/notifications/orderNotifications';
import { enqueue, triggerImmediateQueueProcessing } from '@/lib/jobs/queue';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/orders/[id]/cancel
 *
 * Customer self-serve cancellation.
 * Allowed strictly before the order is shipped (status in pending | confirmed AND no tracking_id).
 * Atomically transitions to 'cancelled', restores stock, and notifies both customer & admin.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      reason?: string;
      email?: string;
      phone?: string;
    };

    const supabase = createAdminClient();
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select(
        'id, order_number, user_id, order_status, payment_status, tracking_id, customer',
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

    if (order.order_status === 'cancelled') {
      return apiError(400, 'This order is already cancelled.');
    }

    if (
      !['pending', 'confirmed'].includes(order.order_status) ||
      Boolean(order.tracking_id && order.tracking_id.trim())
    ) {
      return apiError(
        400,
        'Order has already been dispatched and cannot be cancelled. You can request a return after delivery.',
      );
    }

    const rawReason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const cancelReason = rawReason
      ? rawReason.slice(0, 300)
      : 'Cancelled by customer before dispatch';
    const nowIso = new Date().toISOString();

    // Atomic guard against concurrent shipment creation
    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      .update({
        order_status: 'cancelled',
        cancel_reason: cancelReason,
        cancelled_by: 'customer',
        cancelled_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', id)
      .in('order_status', ['pending', 'confirmed'])
      .is('tracking_id', null)
      .select('id')
      .maybeSingle();

    if (updateErr || !updated) {
      return apiError(
        409,
        'This order has just been dispatched or updated and can no longer be cancelled.',
      );
    }

    if (order.payment_status !== 'failed') {
      await supabase.rpc('restore_order_stock', { p_order_id: id });
    }

    await notifyOrderCancelled(id, 'admin_action');

    await enqueue(
      {
        kind: 'push.admin_notify',
        idempotencyKey: `push.customer_cancel.${id}`,
        payload: {
          push: {
            title: `Order Cancelled by Customer — ${order.order_number}`,
            body: `Do not ship. Reason: ${cancelReason}`,
            url: `/admin/orders/${id}`,
            tag: `cancel-${id}`,
          },
        },
      },
      supabase,
    );
    triggerImmediateQueueProcessing();

    logEvent(
      'order.customer_cancelled',
      {
        order_id: id,
        order_number: order.order_number,
        previous_status: order.order_status,
        reason: cancelReason,
      },
      { source: 'api', entityType: 'order', entityId: id },
    );

    return apiSuccess({
      order_status: 'cancelled',
      cancel_reason: cancelReason,
      cancelled_at: nowIso,
    });
  } catch (err) {
    logEvent(
      'order.customer_cancel_error',
      { error: err instanceof Error ? err.message : String(err) },
      { source: 'api', severity: 'error' },
    );
    return apiError(500, 'Failed to cancel order');
  }
}
