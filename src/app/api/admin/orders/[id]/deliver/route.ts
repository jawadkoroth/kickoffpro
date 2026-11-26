import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError } from '@/lib/api-response';
import { notifyOrderDelivered } from '@/lib/notifications/orderNotifications';
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
  const { data: adminUser } = await admin
    .from('admin_users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (!adminUser) return { ok: false as const, status: 403, message: 'Forbidden', userId: null };

  return { ok: true as const, admin, userId: user.id };
}

/**
 * POST /api/admin/orders/[id]/deliver
 *
 * Explicitly verifies and marks a shipped order as delivered.
 * Requires `confirmed_by_admin: true`, validates the order is currently `'shipped'`
 * and has a non-empty tracking ID, and notifies the customer strictly once via
 * `delivered_notified_at` DB idempotency guard.
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

    let body: {
      confirmed_by_admin?: boolean;
      force_override_automated?: boolean;
      delivery_note?: string;
      delivered_at?: string;
    };
    try {
      body = await req.json();
    } catch {
      return apiError(400, 'Invalid JSON body');
    }

    if (body.confirmed_by_admin !== true) {
      return apiError(
        400,
        'Explicit admin delivery verification checkbox confirmation is required before marking delivered.',
      );
    }

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, order_number, order_status, tracking_id, shipment_mode, shipping_provider, delivered_at')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !order) {
      return apiError(404, 'Order not found');
    }

    if (order.order_status === 'delivered') {
      return apiError(400, 'Order is already marked delivered');
    }

    if (order.order_status !== 'shipped') {
      return apiError(
        400,
        `Cannot mark order as delivered from "${order.order_status}". Order must be shipped with valid tracking first.`,
      );
    }

    if (!order.tracking_id || !order.tracking_id.trim()) {
      return apiError(
        400,
        'Cannot confirm delivery: this order has no Tracking ID recorded.',
      );
    }

    // Check linked automated shipment status if applicable
    const { data: shipment } = await supabase
      .from('shipments')
      .select('id, status, provider_name')
      .eq('order_id', id)
      .order('created_at', { ascending: false })
      .maybeSingle();

    if (
      shipment &&
      order.shipment_mode !== 'manual' &&
      shipment.status !== 'delivered' &&
      body.force_override_automated !== true
    ) {
      return apiError(
        409,
        `Automated courier webhook (${shipment.provider_name ?? 'courier'}) still reports "${shipment.status}". Check courier tracking and confirm manual override if actually delivered.`,
      );
    }

    const deliveredAt =
      body.delivered_at && !Number.isNaN(Date.parse(body.delivered_at))
        ? new Date(body.delivered_at).toISOString()
        : new Date().toISOString();
    const deliveryNote =
      typeof body.delivery_note === 'string' && body.delivery_note.trim()
        ? body.delivery_note.trim().slice(0, 500)
        : null;

    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      .update({
        order_status: 'delivered',
        delivered_at: deliveredAt,
        delivery_note: deliveryNote,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('order_status', 'shipped')
      .select('id')
      .maybeSingle();

    if (updateErr || !updated) {
      return apiError(409, 'Order status changed concurrently; please refresh.');
    }

    if (shipment && shipment.status !== 'delivered') {
      await supabase
        .from('shipments')
        .update({
          status: 'delivered',
          last_provider_event_at: deliveredAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', shipment.id);

      await supabase.from('shipment_status_history').insert({
        shipment_id: shipment.id,
        previous_status: shipment.status,
        next_status: 'delivered',
        source: 'admin',
        notes: deliveryNote || 'Admin verified delivery manually',
      });
    }

    const notifyRes = await notifyOrderDelivered(id, 'admin_deliver');

    logEvent(
      'order.delivered_confirmed_admin',
      {
        order_id: id,
        order_number: order.order_number,
        shipment_mode: order.shipment_mode,
        courier: order.shipping_provider,
        tracking_id: order.tracking_id,
        email_enqueued: notifyRes.enqueued,
        admin_id: gate.userId,
      },
      { source: 'api', entityType: 'order', entityId: id },
    );

    return apiSuccess({
      order_status: 'delivered',
      delivered_at: deliveredAt,
      notified: notifyRes.enqueued,
    });
  } catch (err) {
    logEvent(
      'order.deliver_unhandled_error',
      { error: err instanceof Error ? err.message : String(err) },
      { source: 'api', severity: 'error' },
    );
    return apiError(500, 'Internal server error');
  }
}
