/**
 * KickoffPro — GET /api/admin/shipping/diagnostics
 *
 * Returns comprehensive operational health metrics for the shipping system.
 * Includes provider health, webhook status, shipment pipeline, and recent events.
 *
 * Auth: Admin-only
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { logEvent } from '@/lib/log';

export interface ShippingDiagnostics {
  timestamp: string;
  provider: {
    name: string | null;
    is_active: boolean;
    api_url: string | null;
    last_tested_at: string | null;
    auth_configured: boolean;
    pickup_configured: boolean;
  } | null;
  webhooks: {
    last_24h: {
      received: number;
      processed: number;
      failed: number;
      duplicate: number;
    };
    last_received_at: string | null;
    last_failed_at: string | null;
    signature_failures_24h: number;
  };
  shipments: {
    total: number;
    pending: number;
    in_transit: number;
    delivered: number;
    failed: number;
    stuck_over_48h: number;
    without_tracking: number;
    last_created_at: string | null;
    last_failed_at: string | null;
    success_rate_7d: number;
  };
  database: {
    orphaned_shipments: number;
    shipments_without_history: number;
    duplicate_webhook_attempts: number;
    invalid_state_transitions_24h: number;
  };
  events: Array<{
    id: string;
    type: string;
    message: string;
    severity: string;
    created_at: string;
    metadata?: Record<string, unknown>;
  }>;
}

export async function GET(): Promise<NextResponse> {
  const t0 = Date.now();

  try {
    // Auth check
    const supabaseAuth = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify admin
    const { data: adminUser } = await supabaseAuth
      .from('admin_users')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!adminUser) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const supabase = createAdminClient();

    // ─────────────────────────────────────────────────────────────────
    // 1. Provider Configuration (check both new and legacy systems)
    // ─────────────────────────────────────────────────────────────────
    let providerHealth: ShippingDiagnostics['provider'] = null;

    // Try new system first
    const { data: newProvider } = await supabase
      .from('shipping_providers')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();

    if (newProvider) {
      providerHealth = {
        name: newProvider.name,
        is_active: newProvider.is_active,
        api_url: newProvider.api_url,
        last_tested_at: newProvider.updated_at,
        auth_configured: !!(newProvider.api_key || (newProvider.auth_email && newProvider.auth_password_encrypted)),
        pickup_configured: !!(newProvider.pickup_name && newProvider.pickup_pincode),
      };
    } else {
      // Fall back to legacy system
      const { data: legacySettings } = await supabase
        .from('shipping_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (legacySettings) {
        providerHealth = {
          name: legacySettings.provider_name ?? 'delhivery',
          is_active: legacySettings.provider_enabled ?? false,
          api_url: legacySettings.api_url,
          last_tested_at: legacySettings.updated_at,
          auth_configured: !!legacySettings.api_key,
          pickup_configured: !!(legacySettings.pickup_name && legacySettings.pickup_pincode),
        };
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // 2. Webhook Health (last 24h)
    // ─────────────────────────────────────────────────────────────────
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: webhookStats } = await supabase
      .from('shipping_webhook_events')
      .select('status, processed_at, received_at')
      .gte('received_at', since24h);

    const webhooks = {
      last_24h: {
        received: webhookStats?.length ?? 0,
        processed: webhookStats?.filter(w => w.status === 'processed').length ?? 0,
        failed: webhookStats?.filter(w => w.status === 'failed').length ?? 0,
        duplicate: webhookStats?.filter(w => w.status === 'duplicate').length ?? 0,
      },
      last_received_at: webhookStats?.[webhookStats.length - 1]?.received_at ?? null,
      last_failed_at: webhookStats?.filter(w => w.status === 'failed').pop()?.received_at ?? null,
      signature_failures_24h: 0, // Would need separate tracking
    };

    // ─────────────────────────────────────────────────────────────────
    // 3. Shipment Pipeline
    // ─────────────────────────────────────────────────────────────────
    const { count: totalShipments } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true });

    const { count: pendingShipments } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const { count: inTransitShipments } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true })
      .in('status', ['shipped', 'in_transit', 'out_for_delivery']);

    const { count: deliveredShipments } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'delivered');

    const { count: failedShipments } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true })
      .in('status', ['failed', 'returned', 'cancelled']);

    const { count: withoutTracking } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true })
      .is('tracking_id', null);

    const { data: lastShipment } = await supabase
      .from('shipments')
      .select('created_at, status')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const { data: lastFailedShipment } = await supabase
      .from('shipments')
      .select('created_at')
      .in('status', ['failed', 'cancelled'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Stuck shipments: pending over 48h
    const stuckSince = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { count: stuckShipments } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
      .lt('created_at', stuckSince);

    // Success rate (last 7 days) - simplified calculation
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count: shipments7d } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', since7d);

    const { count: delivered7d } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'delivered')
      .gte('created_at', since7d);

    const successRate7d = shipments7d && shipments7d > 0
      ? Math.round((delivered7d ?? 0) / shipments7d * 100)
      : 0;

    const shipments = {
      total: totalShipments ?? 0,
      pending: pendingShipments ?? 0,
      in_transit: inTransitShipments ?? 0,
      delivered: deliveredShipments ?? 0,
      failed: failedShipments ?? 0,
      stuck_over_48h: stuckShipments ?? 0,
      without_tracking: withoutTracking ?? 0,
      last_created_at: lastShipment?.created_at ?? null,
      last_failed_at: lastFailedShipment?.created_at ?? null,
      success_rate_7d: successRate7d,
    };

    // ─────────────────────────────────────────────────────────────────
    // 4. Database Health
    // ─────────────────────────────────────────────────────────────────

    // Orphaned: shipments without orders
    const { count: orphaned } = await supabase
      .from('shipments')
      .select('*, orders!inner(id)', { count: 'exact', head: true })
      .is('orders.id', null);

    // Without history: shipments with no status history entries
    const { data: shipmentsWithoutHistory } = await supabase
      .from('shipments')
      .select('id')
      .not('id', 'in', supabase
        .from('shipment_status_history')
        .select('shipment_id'));

    // Recent invalid state transitions (detected via app_events)
    const { count: invalidTransitions } = await supabase
      .from('app_events')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'shipment.state_transition_failed')
      .gte('created_at', since24h);

    const database = {
      orphaned_shipments: orphaned ?? 0,
      shipments_without_history: shipmentsWithoutHistory?.length ?? 0,
      duplicate_webhook_attempts: webhooks.last_24h.duplicate,
      invalid_state_transitions_24h: invalidTransitions ?? 0,
    };

    // ─────────────────────────────────────────────────────────────────
    // 5. Recent Events (from app_events)
    // ─────────────────────────────────────────────────────────────────
    const { data: recentEvents } = await supabase
      .from('app_events')
      .select('*')
      .in('type', [
        'shipment.created',
        'shipment.failed',
        'shipping.delhivery.create_shipment_failed',
        'shipping.shiprocket.create_failed',
        'webhook.received',
        'webhook.invalid_signature',
        'shipment.state_transition_failed',
        'push.notification_sent',
        'push.failed',
      ])
      .order('created_at', { ascending: false })
      .limit(20);

    const events = (recentEvents ?? []).map(e => ({
      id: e.id,
      type: e.type,
      message: e.message ?? '',
      severity: e.severity ?? 'info',
      created_at: e.created_at,
      metadata: e.metadata as Record<string, unknown> | undefined,
    }));

    // ─────────────────────────────────────────────────────────────────
    // Assemble Response
    // ─────────────────────────────────────────────────────────────────
    const diagnostics: ShippingDiagnostics = {
      timestamp: new Date().toISOString(),
      provider: providerHealth,
      webhooks,
      shipments,
      database,
      events,
    };

    logEvent('shipping.diagnostics.fetched', {
      latency_ms: Date.now() - t0,
      has_provider: !!providerHealth,
      event_count: events.length,
    }, { source: 'api' });

    return NextResponse.json(diagnostics);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logEvent('shipping.diagnostics.failed', { error: msg }, { source: 'api', severity: 'error' });

    return NextResponse.json(
      { error: 'Failed to fetch diagnostics', details: msg },
      { status: 500 }
    );
  }
}
