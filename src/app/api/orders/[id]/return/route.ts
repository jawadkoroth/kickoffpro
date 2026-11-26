import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError } from '@/lib/api-response';
import { authorizeCustomerOrder } from '@/lib/orders/authorizeCustomerOrder';
import { getReturnWindowState } from '@/lib/orders/returnWindow';
import { enqueue, triggerImmediateQueueProcessing } from '@/lib/jobs/queue';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/orders/[id]/return
 *
 * Customer Return / Exchange request endpoint.
 * Allowed when `order_status === 'delivered'`.
 * Sets `order_status = 'return_requested'` and updates `last_activity_at = now()`
 * so even older orders automatically surface back at the top of `/admin/orders`.
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
      email?: string;
      phone?: string;
    };

    const returnType = body.return_type === 'exchange' ? 'exchange' : body.return_type === 'refund' ? 'refund' : null;
    if (!returnType) {
      return apiError(400, 'Please select whether you want an Exchange or a Refund.');
    }

    const returnReason = typeof body.return_reason === 'string' ? body.return_reason.trim().slice(0, 200) : '';
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
      .select('id, order_number, user_id, order_status, customer, delivered_at, updated_at')
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

    const nowIso = new Date().toISOString();

    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      .update({
        order_status: 'return_requested',
        return_type: returnType,
        return_reason: returnReason,
        return_notes: returnNotes,
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
            body: `${returnReason}${returnNotes ? ` · ${returnNotes.slice(0, 60)}` : ''}`,
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
      },
      { source: 'api', entityType: 'order', entityId: id },
    );

    return apiSuccess({
      order_status: 'return_requested',
      return_type: returnType,
      return_reason: returnReason,
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
