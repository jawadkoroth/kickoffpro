import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError } from '@/lib/api-response';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_ACTIONS = new Set([
  'approved',
  'pickup_scheduled',
  'received',
  'completed',
  'rejected',
]);

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
 * POST /api/admin/orders/[id]/return-status
 *
 * Updates the workflow state of a customer return/exchange request.
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
      return_status?: string;
      mark_refunded?: boolean;
    };

    const nextReturnStatus = (body.return_status || '').trim();
    if (!VALID_ACTIONS.has(nextReturnStatus)) {
      return apiError(400, 'Invalid return status transition');
    }

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, order_number, order_status, payment_status, return_type')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !order) {
      return apiError(404, 'Order not found');
    }

    if (!['return_requested', 'returned'].includes(order.order_status)) {
      return apiError(400, 'Order does not have an active return request.');
    }

    const nowIso = new Date().toISOString();
    const update: Record<string, unknown> = {
      return_status: nextReturnStatus,
      updated_at: nowIso,
    };

    if (nextReturnStatus === 'completed') {
      update.order_status = 'returned';
      update.return_resolved_at = nowIso;
      if (body.mark_refunded && order.return_type === 'refund' && order.payment_status === 'paid') {
        update.payment_status = 'refunded';
      }
    } else if (nextReturnStatus === 'rejected') {
      update.order_status = 'delivered';
      update.return_resolved_at = nowIso;
    } else {
      update.order_status = 'return_requested';
    }

    const { error: updateErr } = await supabase
      .from('orders')
      .update(update)
      .eq('id', id);

    if (updateErr) {
      return apiError(500, 'Failed to update return status');
    }

    logEvent(
      'order.return_status_updated',
      {
        order_id: id,
        order_number: order.order_number,
        return_status: nextReturnStatus,
        admin_id: gate.userId,
      },
      { source: 'api', entityType: 'order', entityId: id },
    );

    return apiSuccess({
      order_status: update.order_status,
      return_status: nextReturnStatus,
    });
  } catch (err) {
    logEvent(
      'order.return_status_error',
      { error: err instanceof Error ? err.message : String(err) },
      { source: 'api', severity: 'error' },
    );
    return apiError(500, 'Internal server error');
  }
}
