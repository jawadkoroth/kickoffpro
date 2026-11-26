import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError } from '@/lib/api-response';
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
 * POST /api/admin/orders/[id]/refund
 *
 * Records completion of a MANUAL Razorpay refund performed by the admin
 * in their Razorpay Dashboard.
 * Never calls any Razorpay refund API.
 * Enforces that prepaid returns have already been inspected as undamaged (`received` / `returned`).
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
      refund_reference?: string;
    };

    if (body.confirmed_by_admin !== true) {
      return apiError(400, 'Please confirm that the Razorpay refund has been processed.');
    }

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select(
        'id, order_number, order_status, payment_method, payment_status, total_paise, razorpay_payment_id, refund_status, return_type, return_status',
      )
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !order) {
      return apiError(404, 'Order not found');
    }

    if (order.payment_status === 'refunded' || order.refund_status === 'completed') {
      return apiError(400, 'This order is already marked as refunded.');
    }

    if (order.payment_status !== 'paid') {
      return apiError(400, 'Only paid prepaid orders can be marked as refunded.');
    }

    const isCancelled = order.order_status === 'cancelled';
    const isVerifiedRefundReturn =
      (order.order_status === 'return_requested' || order.order_status === 'returned') &&
      order.return_type === 'refund' &&
      (order.return_status === 'received' || order.return_status === 'completed');

    if (!isCancelled && !isVerifiedRefundReturn) {
      return apiError(
        400,
        'Manual refund is allowed only for cancelled prepaid orders OR refund returns confirmed as received undamaged.',
      );
    }

    const refundReference =
      typeof body.refund_reference === 'string' && body.refund_reference.trim()
        ? body.refund_reference.trim().slice(0, 300)
        : null;
    const nowIso = new Date().toISOString();

    const update: Record<string, unknown> = {
      payment_status: 'refunded',
      refund_status: 'completed',
      refund_reference: refundReference,
      refunded_at: nowIso,
      updated_at: nowIso,
    };

    // If admin completes the manual refund after inspecting the undamaged return,
    // also finalize the return workflow to returned/completed cleanly.
    if (isVerifiedRefundReturn && order.order_status === 'return_requested') {
      update.order_status = 'returned';
      update.return_status = 'completed';
      update.return_resolved_at = nowIso;
    }

    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      .update(update)
      .eq('id', id)
      .eq('payment_status', 'paid')
      .select('id')
      .maybeSingle();

    if (updateErr || !updated) {
      return apiError(409, 'Order payment status changed concurrently; please refresh.');
    }

    logEvent(
      'order.manual_refund_completed',
      {
        order_id: id,
        order_number: order.order_number,
        razorpay_payment_id: order.razorpay_payment_id,
        refund_reference: refundReference,
        amount_paise: order.total_paise,
        admin_id: gate.userId,
      },
      { source: 'api', entityType: 'order', entityId: id },
    );

    return apiSuccess({
      payment_status: 'refunded',
      refund_status: 'completed',
      refund_reference: refundReference,
      refunded_at: nowIso,
      order_status: update.order_status ?? order.order_status,
    });
  } catch (err) {
    logEvent(
      'order.manual_refund_error',
      { error: err instanceof Error ? err.message : String(err) },
      { source: 'api', severity: 'error' },
    );
    return apiError(500, 'Internal server error');
  }
}
