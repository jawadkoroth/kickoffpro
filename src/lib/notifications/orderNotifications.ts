import { createAdminClient } from '@/lib/supabase/admin';
import { enqueue, triggerImmediateQueueProcessing } from '@/lib/jobs/queue';
import { logEvent } from '@/lib/log';
import type { OrderEmailData, OrderStatusForEmail } from '@/lib/email/sendOrderEmail';
import { formatCourierDisplayName, resolveTrackingUrl } from '@/lib/shipping/couriers';

export type OrderNotificationSource =
  | 'admin_action'
  | 'auto_ship'
  | 'manual_ship'
  | 'admin_deliver'
  | 'webhook'
  | 'notify_status_api'
  | 'cron';

export interface DispatchNotificationResult {
  ok: boolean;
  enqueued: boolean;
  skipped?: string;
}

const SUPPORTED_STATUSES = new Set<OrderStatusForEmail>([
  'confirmed',
  'shipped',
  'delivered',
  'cancelled',
]);

/**
 * Future WhatsApp hook cleanly separated behind channel abstraction.
 * Plug in approved WhatsApp template API client here when enabled.
 */
async function dispatchWhatsAppHook(
  order: OrderEmailData,
  status: OrderStatusForEmail,
): Promise<void> {
  if (process.env.WHATSAPP_NOTIFY_ENABLED !== 'true') return;
  logEvent('notification.whatsapp_hook', {
    order_id: order.id,
    order_number: order.order_number,
    phone: order.customer.phone,
    status,
    courier: order.shipping_provider ?? null,
    tracking_id: order.tracking_id ?? null,
  });
}

/**
 * Authoritative, DB-idempotent customer notification dispatcher for order lifecycle changes.
 *
 * Guarantees:
 * - Never sends "Order Shipped" unless `tracking_id` is present and order is `'shipped'`.
 * - Enforces single-send idempotency via `orders.shipped_notified_at` and `orders.delivered_notified_at`
 *   using atomic conditional updates before enqueuing jobs.
 * - Attaches full `order_items`, Courier Partner name, Tracking ID, and Tracking Link.
 */
export async function dispatchOrderNotification(opts: {
  orderId: string;
  targetStatus?: string;
  source?: OrderNotificationSource;
}): Promise<DispatchNotificationResult> {
  const { orderId, targetStatus, source = 'admin_action' } = opts;
  const supabase = createAdminClient();

  const { data: order, error: fetchErr } = await supabase
    .from('orders')
    .select(
      'id, order_number, customer, shipping_address, subtotal_paise, discount_paise, shipping_paise, cod_fee_paise, total_paise, payment_method, order_status, tracking_id, shipping_provider, tracking_url, shipment_mode, shipped_notified_at, delivered_at, delivered_notified_at',
    )
    .eq('id', orderId)
    .maybeSingle();

  if (fetchErr || !order) {
    return { ok: false, enqueued: false, skipped: 'order_not_found' };
  }

  const effectiveStatus = (targetStatus || order.order_status) as OrderStatusForEmail;
  if (!SUPPORTED_STATUSES.has(effectiveStatus)) {
    return { ok: false, enqueued: false, skipped: `unsupported_status:${effectiveStatus}` };
  }

  // Ensure DB state actually matches requested notification milestone
  if (order.order_status !== effectiveStatus) {
    return {
      ok: false,
      enqueued: false,
      skipped: `status_mismatch:${order.order_status}!=${effectiveStatus}`,
    };
  }

  // Strict guard for "shipped": must have an actual tracking/consignment ID
  const cleanTrackingId = (order.tracking_id || '').trim();
  if (effectiveStatus === 'shipped' && !cleanTrackingId) {
    logEvent(
      'notification.shipped_blocked_no_tracking',
      { order_id: order.id, order_number: order.order_number, source },
      { source: 'api', severity: 'warn', entityType: 'order', entityId: order.id },
    );
    return { ok: false, enqueued: false, skipped: 'missing_tracking_id' };
  }

  // Strict atomic DB idempotency guards for shipped and delivered milestones
  const nowIso = new Date().toISOString();
  if (effectiveStatus === 'shipped') {
    const { data: claimed } = await supabase
      .from('orders')
      .update({ shipped_notified_at: nowIso })
      .eq('id', order.id)
      .is('shipped_notified_at', null)
      .select('id');

    if (!claimed || claimed.length === 0) {
      return { ok: true, enqueued: false, skipped: 'already_notified_shipped' };
    }
  }

  if (effectiveStatus === 'delivered') {
    const { data: claimed } = await supabase
      .from('orders')
      .update({ delivered_notified_at: nowIso })
      .eq('id', order.id)
      .is('delivered_notified_at', null)
      .select('id');

    if (!claimed || claimed.length === 0) {
      return { ok: true, enqueued: false, skipped: 'already_notified_delivered' };
    }
  }

  const { data: itemRows } = await supabase
    .from('order_items')
    .select('product_name, size, quantity, unit_price_paise, subtotal_paise, image_url')
    .eq('order_id', order.id)
    .order('created_at', { ascending: true });

  const items = (itemRows ?? []).map((row) => {
    const r = row as {
      product_name: string;
      size: string;
      quantity: number;
      unit_price_paise: number;
      subtotal_paise: number;
      image_url: string | null;
    };
    return {
      name: r.product_name,
      size: r.size,
      quantity: r.quantity,
      unit_price_paise: r.unit_price_paise,
      subtotal_paise: r.subtotal_paise,
      image_url: r.image_url,
    };
  });

  const firstItem = items[0];
  const courierDisplay = formatCourierDisplayName(order.shipping_provider);
  const trackingUrl = resolveTrackingUrl(
    order.shipping_provider,
    cleanTrackingId,
    order.tracking_url,
  );

  const emailData: OrderEmailData = {
    id: order.id,
    order_number: order.order_number,
    customer: order.customer as OrderEmailData['customer'],
    product_name: firstItem?.name || 'Product',
    size: firstItem?.size || '',
    quantity: firstItem?.quantity ?? 1,
    subtotal_paise: order.subtotal_paise,
    discount_paise: order.discount_paise,
    shipping_paise: order.shipping_paise,
    cod_fee_paise: order.cod_fee_paise,
    total_paise: order.total_paise,
    payment_method: order.payment_method,
    shipping_address: order.shipping_address as OrderEmailData['shipping_address'],
    image_url: firstItem?.image_url || null,
    items,
    tracking_id: cleanTrackingId || null,
    shipping_provider: order.shipping_provider ? courierDisplay : null,
    tracking_url: trackingUrl,
    shipment_mode: order.shipment_mode as 'automated' | 'manual' | null,
    delivered_at: order.delivered_at ?? null,
  };

  const jobId = await enqueue(
    {
      kind: 'email.order_status',
      idempotencyKey: `email.order_status.${order.id}.${effectiveStatus}`,
      payload: {
        order: emailData,
        status: effectiveStatus,
      },
    },
    supabase,
  );

  triggerImmediateQueueProcessing();

  await dispatchWhatsAppHook(emailData, effectiveStatus).catch(() => {});

  logEvent('notification.order_status_dispatched', {
    order_id: order.id,
    order_number: order.order_number,
    status: effectiveStatus,
    source,
    job_id: jobId,
    has_tracking: Boolean(cleanTrackingId),
  });

  return { ok: true, enqueued: Boolean(jobId) };
}

export function notifyOrderConfirmed(orderId: string, source: OrderNotificationSource = 'admin_action') {
  return dispatchOrderNotification({ orderId, targetStatus: 'confirmed', source });
}

export function notifyOrderShipped(orderId: string, source: OrderNotificationSource = 'auto_ship') {
  return dispatchOrderNotification({ orderId, targetStatus: 'shipped', source });
}

export function notifyOrderDelivered(orderId: string, source: OrderNotificationSource = 'webhook') {
  return dispatchOrderNotification({ orderId, targetStatus: 'delivered', source });
}

export function notifyOrderCancelled(orderId: string, source: OrderNotificationSource = 'admin_action') {
  return dispatchOrderNotification({ orderId, targetStatus: 'cancelled', source });
}
