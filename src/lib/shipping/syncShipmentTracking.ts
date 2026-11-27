import { createAdminClient } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/log';
import {
  mapDelhiveryStatus,
  type CanonicalShipmentStatus,
} from './state';
import { DelhiveryProvider } from './delhivery';
import { ShiprocketProvider, mapShiprocketStatus } from './shiprocket';
import type { ProviderConfig, TrackingScanEvent } from './types';
import {
  notifyOrderDelivered,
  notifyOrderRto,
  type OrderNotificationSource,
} from '@/lib/notifications/orderNotifications';

export interface SyncTrackingResult {
  ok: boolean;
  orderId: string;
  trackingId?: string;
  provider?: string;
  rawStatus?: string;
  shipmentStatus?: string;
  orderStatus?: string;
  eventsCount?: number;
  estimatedDeliveryDate?: string;
  error?: string;
  skipped?: string;
}

export function toOrderShipmentStatus(canonical: CanonicalShipmentStatus): string {
  if (canonical === 'returned') return 'rto_delivered';
  return canonical;
}

/**
 * Resolve a ShippingProvider instance for tracking by provider name,
 * reading `shipping_providers` first and falling back to `shipping_settings`.
 */
async function resolveProviderForTracking(
  supabase: ReturnType<typeof createAdminClient>,
  providerName: string,
): Promise<{
  provider: DelhiveryProvider | ShiprocketProvider;
  providerRowId?: string;
} | null> {
  const norm = providerName.toLowerCase().trim();
  const isShiprocket = norm.includes('shiprocket');
  const canonicalName = isShiprocket ? 'shiprocket' : 'delhivery';

  const { data: row } = await supabase
    .from('shipping_providers')
    .select('*')
    .eq('name', canonicalName)
    .maybeSingle();

  if (row) {
    const cfg = row as ProviderConfig;
    return {
      provider: isShiprocket ? new ShiprocketProvider(cfg) : new DelhiveryProvider(cfg),
      providerRowId: cfg.id,
    };
  }

  const { data: settings } = await supabase
    .from('shipping_settings')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (!settings) return null;

  const fallbackCfg: ProviderConfig = {
    id: '',
    name: canonicalName,
    environment: 'live',
    api_url: settings.api_url ?? null,
    api_key: settings.api_key ?? null,
    api_secret: null,
    webhook_secret: settings.webhook_secret ?? null,
    token: null,
    token_expires_at: null,
    auth_email: settings.auth_email ?? null,
    auth_password_encrypted: settings.auth_password ?? null,
    pickup_name: settings.pickup_name ?? null,
    pickup_phone: settings.pickup_phone ?? null,
    pickup_gstin: null,
    pickup_line1: settings.pickup_address_line1 ?? null,
    pickup_line2: settings.pickup_address_line2 ?? null,
    pickup_city: settings.pickup_city ?? null,
    pickup_state: settings.pickup_state ?? null,
    pickup_pincode: settings.pickup_pincode ?? null,
    features_cod: settings.cod_enabled ?? true,
    features_reverse: false,
    features_insurance: false,
  };

  return {
    provider: isShiprocket ? new ShiprocketProvider(fallbackCfg) : new DelhiveryProvider(fallbackCfg),
  };
}

/**
 * Shared, 100% idempotent milestone & tracking-timeline applier used by:
 *   - `syncShipmentTracking()` (cron & admin on-demand sync)
 *   - `POST /api/webhooks/shipping` (real-time courier webhooks)
 */
export async function applyCanonicalShipmentMilestone(opts: {
  orderId: string;
  shipmentId?: string | null;
  canonicalStatus: CanonicalShipmentStatus | null;
  events?: TrackingScanEvent[];
  estimatedDeliveryDate?: string;
  rtoReason?: string;
  source: OrderNotificationSource;
  providerEventAt?: string;
}): Promise<{
  orderStatus: string;
  shipmentStatus: string | null;
  stockRestored: boolean;
}> {
  const supabase = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: order } = await supabase
    .from('orders')
    .select(
      'id, order_number, order_status, payment_status, delivered_at, rto_at, rto_reason, stock_restored_at, shipment_status',
    )
    .eq('id', opts.orderId)
    .maybeSingle();

  if (!order) {
    return { orderStatus: 'unknown', shipmentStatus: null, stockRestored: false };
  }

  const nextShipmentStatus = opts.canonicalStatus
    ? toOrderShipmentStatus(opts.canonicalStatus)
    : (order.shipment_status as string | null) ?? null;

  const orderUpdate: Record<string, unknown> = {
    last_tracking_sync_at: nowIso,
    updated_at: nowIso,
  };

  if (nextShipmentStatus) {
    orderUpdate.shipment_status = nextShipmentStatus;
  }
  if (opts.events && opts.events.length > 0) {
    orderUpdate.tracking_events = opts.events;
  }
  if (opts.estimatedDeliveryDate) {
    orderUpdate.estimated_delivery_date = opts.estimatedDeliveryDate;
  }

  let effectiveOrderStatus = order.order_status as string;
  let stockRestored = false;

  // 1. Delivered milestone (idempotent)
  if (opts.canonicalStatus === 'delivered') {
    if (!['delivered', 'rto', 'cancelled'].includes(order.order_status)) {
      orderUpdate.order_status = 'delivered';
      orderUpdate.delivered_at = order.delivered_at ?? opts.providerEventAt ?? nowIso;
      orderUpdate.last_activity_at = nowIso;
      effectiveOrderStatus = 'delivered';
    }
  }

  // 2. RTO Initiated: warn admin & customer without prematurely restoring stock
  if (opts.canonicalStatus === 'rto_initiated') {
    orderUpdate.shipment_status = 'rto_initiated';
  }

  // 3. RTO Delivered: transition to 'rto', restore stock ONCE, flag prepaid refund_status='pending', notify ONCE
  if (opts.canonicalStatus === 'returned') {
    if (!['rto', 'cancelled'].includes(order.order_status)) {
      orderUpdate.order_status = 'rto';
      orderUpdate.rto_at = order.rto_at ?? opts.providerEventAt ?? nowIso;
      orderUpdate.rto_reason =
        order.rto_reason ?? opts.rtoReason ?? 'Returned undelivered to origin';
      orderUpdate.last_activity_at = nowIso;
      if (order.payment_status === 'paid') {
        orderUpdate.refund_status = 'pending';
      }
      effectiveOrderStatus = 'rto';
    }
  }

  await supabase.from('orders').update(orderUpdate).eq('id', opts.orderId);

  // Sync shipments row (if present)
  const targetShipmentId = opts.shipmentId
    ? opts.shipmentId
    : (
        await supabase
          .from('shipments')
          .select('id')
          .eq('order_id', opts.orderId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data?.id;

  if (targetShipmentId) {
    const shipUpdate: Record<string, unknown> = {
      last_tracking_sync_at: nowIso,
      updated_at: nowIso,
    };
    if (opts.canonicalStatus) {
      shipUpdate.status = opts.canonicalStatus;
    }
    if (opts.events && opts.events.length > 0) {
      shipUpdate.tracking_events = opts.events;
    }
    if (opts.estimatedDeliveryDate) {
      shipUpdate.estimated_delivery_date = opts.estimatedDeliveryDate;
    }
    if (opts.providerEventAt) {
      shipUpdate.last_provider_event_at = opts.providerEventAt;
    }
    await supabase.from('shipments').update(shipUpdate).eq('id', targetShipmentId);
  }

  // Fire idempotent post-commit side effects
  if (opts.canonicalStatus === 'delivered' && effectiveOrderStatus === 'delivered') {
    await notifyOrderDelivered(opts.orderId, opts.source).catch((err) => {
      logEvent(
        'shipping.sync.delivered_notify_failed',
        { order_id: opts.orderId, error: err instanceof Error ? err.message : String(err) },
        { source: 'system', severity: 'error' },
      );
    });
  }

  if (opts.canonicalStatus === 'returned' && effectiveOrderStatus === 'rto') {
    // Atomic stock-restore claim so concurrent webhook + worker sync never double-restores
    if (order.payment_status !== 'failed') {
      const { data: claimed } = await supabase
        .from('orders')
        .update({ stock_restored_at: nowIso })
        .eq('id', opts.orderId)
        .is('stock_restored_at', null)
        .select('id');

      if (claimed && claimed.length > 0) {
        await supabase.rpc('restore_order_stock', { p_order_id: opts.orderId });
        stockRestored = true;
      }
    }

    await notifyOrderRto(opts.orderId, opts.source).catch((err) => {
      logEvent(
        'shipping.sync.rto_notify_failed',
        { order_id: opts.orderId, error: err instanceof Error ? err.message : String(err) },
        { source: 'system', severity: 'error' },
      );
    });
  }

  return {
    orderStatus: effectiveOrderStatus,
    shipmentStatus: nextShipmentStatus,
    stockRestored,
  };
}

/**
 * Fetch live courier tracking scans for an order and apply idempotent
 * state transitions, scan history, ETA, stock restore, and notifications.
 */
export async function syncShipmentTracking(
  orderId: string,
  source: OrderNotificationSource = 'cron',
): Promise<SyncTrackingResult> {
  const supabase = createAdminClient();

  const { data: order, error } = await supabase
    .from('orders')
    .select('id, order_number, order_status, tracking_id, shipping_provider, shipment_mode')
    .eq('id', orderId)
    .maybeSingle();

  if (error || !order) {
    return { ok: false, orderId, error: 'Order not found' };
  }

  const trackingId = (order.tracking_id || '').trim();
  if (!trackingId) {
    return { ok: true, orderId, skipped: 'no_tracking_id' };
  }
  if (order.shipment_mode === 'manual') {
    return { ok: true, orderId, trackingId, skipped: 'manual_shipment' };
  }

  const providerName = (order.shipping_provider || 'shiprocket').toLowerCase();
  const resolved = await resolveProviderForTracking(supabase, providerName);
  if (!resolved) {
    return { ok: false, orderId, trackingId, error: 'Shipping provider not configured' };
  }

  const { provider, providerRowId } = resolved;
  const trackRes = await provider.trackShipment(trackingId);

  // Persist refreshed Shiprocket JWT if login ran during trackShipment()
  if (providerRowId && provider instanceof ShiprocketProvider) {
    const refreshed = provider.getRefreshedAuth();
    if (refreshed) {
      await supabase
        .from('shipping_providers')
        .update({
          token: refreshed.token,
          token_expires_at: refreshed.expires_at,
          last_auth_ok: true,
          last_auth_at: new Date().toISOString(),
        })
        .eq('id', providerRowId);
    }
  }

  if (trackRes.status === 'error') {
    return {
      ok: false,
      orderId,
      trackingId,
      provider: provider.providerName,
      error: 'Courier tracking API request failed',
    };
  }

  const canonicalStatus =
    provider.providerName === 'shiprocket'
      ? mapShiprocketStatus(trackRes.status)
      : mapDelhiveryStatus(trackRes.status);

  const applied = await applyCanonicalShipmentMilestone({
    orderId,
    canonicalStatus,
    events: trackRes.events ?? [],
    estimatedDeliveryDate: trackRes.estimated_delivery_date,
    source,
    providerEventAt: trackRes.timestamp,
  });

  return {
    ok: true,
    orderId,
    trackingId,
    provider: provider.providerName,
    rawStatus: trackRes.status,
    shipmentStatus: applied.shipmentStatus ?? undefined,
    orderStatus: applied.orderStatus,
    eventsCount: trackRes.events?.length ?? 0,
    estimatedDeliveryDate: trackRes.estimated_delivery_date,
  };
}

/**
 * Polls active automated shipped orders (not yet delivered or RTO)
 * prioritizing least-recently-synced orders.
 */
export async function syncActiveAutomatedShipments(limit = 25): Promise<{
  checked: number;
  updated: number;
  errors: number;
}> {
  const supabase = createAdminClient();
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id')
    .eq('order_status', 'shipped')
    .eq('shipment_mode', 'automated')
    .not('tracking_id', 'is', null)
    .order('last_tracking_sync_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error || !orders || orders.length === 0) {
    return { checked: 0, updated: 0, errors: 0 };
  }

  let updated = 0;
  let errors = 0;

  for (const row of orders) {
    const res = await syncShipmentTracking(row.id as string, 'cron');
    if (res.ok && !res.skipped) updated += 1;
    else if (!res.ok) errors += 1;

    // Gentle pacing so we never trip Shiprocket/Delhivery rate limits
    await new Promise((r) => setTimeout(r, 150));
  }

  return { checked: orders.length, updated, errors };
}
