import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError } from '@/lib/api-response';
import { notifyOrderRto } from '@/lib/notifications/orderNotifications';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function gateAdmin() {
  const ssr = await createServerSupabaseClient();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  if (!user) return { ok: false as const, status: 401, message: 'Unauthorized', userId: null };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('admin_users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();
  if (!row) return { ok: false as const, status: 403, message: 'Forbidden', userId: null };
  return { ok: true as const, admin, userId: user.id };
}

/**
 * POST /api/admin/orders/[id]/rto
 *
 * Marks a shipped order as RTO (Return to Origin), restores stock, flags
 * prepaid paid orders with `refund_status = 'pending'` for manual Razorpay action,
 * and dispatches an idempotent RTO email notification to the customer.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await gateAdmin();
    if (!gate.ok) return apiError(gate.status, gate.message);

    const { id } = await params;
    const supabase = gate.admin;

    const body = (await req.json().catch(() => ({}))) as {
      confirmed_by_admin?: boolean;
      rto_reason?: string;
    };

    if (body.confirmed_by_admin !== true) {
      return apiError(400, 'Please confirm marking this shipment as RTO.');
    }

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, order_number, order_status, payment_status, tracking_id, shipping_provider')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !order) {
      return apiError(404, 'Order not found');
    }

    if (order.order_status !== 'shipped') {
      return apiError(400, `Only shipped orders can be marked as RTO (current: ${order.order_status}).`);
    }

    const cleanReason =
      typeof body.rto_reason === 'string' && body.rto_reason.trim()
        ? body.rto_reason.trim().slice(0, 400)
        : 'Returned undelivered to origin';
    const nowIso = new Date().toISOString();
    const isPrepaidPaid = order.payment_status === 'paid';

    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      .update({
        order_status: 'rto',
        rto_at: nowIso,
        rto_reason: cleanReason,
        shipment_status: 'rto_delivered',
        last_activity_at: nowIso,
        refund_status: isPrepaidPaid ? 'pending' : 'none',
        updated_at: nowIso,
      })
      .eq('id', id)
      .eq('order_status', 'shipped')
      .select('id')
      .maybeSingle();

    if (updateErr || !updated) {
      return apiError(409, 'Order status changed concurrently; please refresh.');
    }

    if (order.payment_status !== 'failed') {
      const { data: claimed } = await supabase
        .from('orders')
        .update({ stock_restored_at: nowIso })
        .eq('id', id)
        .is('stock_restored_at', null)
        .select('id');
      if (claimed && claimed.length > 0) {
        await supabase.rpc('restore_order_stock', { p_order_id: id });
      }
    }

    const { data: shipment } = await supabase
      .from('shipments')
      .select('id, status')
      .eq('order_id', id)
      .order('created_at', { ascending: false })
      .maybeSingle();

    if (shipment && shipment.status !== 'returned') {
      await supabase
        .from('shipments')
        .update({
          status: 'returned',
          last_provider_event_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', shipment.id);

      await supabase.from('shipment_status_history').insert({
        shipment_id: shipment.id,
        previous_status: shipment.status,
        next_status: 'returned',
        source: 'admin',
        notes: `RTO: ${cleanReason}`,
      });
    }

    const notifyRes = await notifyOrderRto(id, 'admin_action');

    logEvent(
      'order.marked_rto',
      {
        order_id: id,
        order_number: order.order_number,
        rto_reason: cleanReason,
        refund_status: isPrepaidPaid ? 'pending' : 'none',
        notified: notifyRes.enqueued,
        admin_id: gate.userId,
      },
      { source: 'api', entityType: 'order', entityId: id },
    );

    return apiSuccess({
      order_status: 'rto',
      rto_at: nowIso,
      rto_reason: cleanReason,
      refund_status: isPrepaidPaid ? 'pending' : 'none',
      notified: notifyRes.enqueued,
    });
  } catch (err) {
    logEvent(
      'order.rto_error',
      { error: err instanceof Error ? err.message : String(err) },
      { source: 'api', severity: 'error' },
    );
    return apiError(500, 'Internal server error');
  }
}
