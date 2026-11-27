/**
 * KickoffPro — Unified shipping webhook receiver.
 *
 * Handles inbound webhook events from all courier providers.
 * Provider is identified by the `?provider=delhivery` query param
 * (or X-Provider header as fallback).
 *
 * Processing pipeline:
 *   1. Read raw body (required for HMAC signature verification).
 *   2. Identify provider from query param / header.
 *   3. Instantiate provider via registry (reads shipping_providers table).
 *      Falls back to legacy shipping_settings when flag is off.
 *   4. Verify webhook signature. Reject with 401 on failure.
 *   5. Dedup: check shipping_webhook_events for external_event_id.
 *   6. Parse body → NormalisedShipmentEvent.
 *   7. Look up shipment row by tracking_id.
 *   8. Validate state machine transition via canTransition().
 *   9. Atomic DB writes:
 *      a. Insert shipping_webhook_events row (dedup + audit).
 *      b. Update shipments.status.
 *      c. Append shipment_status_history row (source = 'webhook').
 *      d. Denorm: update orders.order_status if milestone.
 *  10. Log to app_events (observability spine).
 *  11. Always return 200 — provider retries on non-2xx.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/log';
import { canTransition } from '@/lib/shipping/state';
import type { CanonicalShipmentStatus } from '@/lib/shipping/state';
import type { NormalisedShipmentEvent, TrackingScanEvent } from '@/lib/shipping/types';
import { DelhiveryProvider } from '@/lib/shipping/delhivery';
import { ShiprocketProvider } from '@/lib/shipping/shiprocket';
import type { ProviderConfig } from '@/lib/shipping/types';
import { applyCanonicalShipmentMilestone } from '@/lib/shipping/syncShipmentTracking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ─── helpers ─────────────────────────────────────────────────────── */

function ok200(reason: string): NextResponse {
  return NextResponse.json({ ok: true, reason }, { status: 200 });
}

function headerStr(h: Headers, key: string): string | undefined {
  return h.get(key) ?? undefined;
}

/* ─── legacy config bridge ────────────────────────────────────────── */

async function getLegacyProviderConfig(
  supabase: ReturnType<typeof createAdminClient>,
  providerName: string,
): Promise<ProviderConfig | null> {
  const { data } = await supabase
    .from('shipping_settings')
    .select('*')
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id ?? '',
    name: providerName,
    environment: 'sandbox',
    api_url: data.api_url ?? null,
    api_key: data.api_key ?? null,
    api_secret: null,
    webhook_secret: data.webhook_secret ?? null,
    token: null,
    token_expires_at: null,
    auth_email: data.auth_email ?? null,
    auth_password_encrypted: data.auth_password ?? null,
    pickup_name: data.pickup_name ?? null,
    pickup_phone: data.pickup_phone ?? null,
    pickup_gstin: null,
    pickup_line1: data.pickup_address_line1 ?? null,
    pickup_line2: data.pickup_address_line2 ?? null,
    pickup_city: data.pickup_city ?? null,
    pickup_state: data.pickup_state ?? null,
    pickup_pincode: data.pickup_pincode ?? null,
    features_cod: data.cod_enabled ?? true,
    features_reverse: false,
    features_insurance: false,
  };
}

function detectProviderName(req: NextRequest, rawBody: string): string | null {
  const url = new URL(req.url);
  const explicit =
    url.searchParams.get('provider') ??
    headerStr(req.headers, 'x-provider');
  if (explicit) return explicit;

  // Shiprocket blocks URLs containing "shiprocket", "kartrocket", "sr", or "kr"
  const courierAlias = url.searchParams.get('courier')?.toLowerCase();
  if (courierAlias === 'rocket' || courierAlias === '2') return 'shiprocket';
  if (courierAlias === 'delhivery' || courierAlias === '1') return 'delhivery';

  if (req.headers.has('x-shiprocket-signature')) return 'shiprocket';

  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      if ('Shipment' in parsed) return 'delhivery';
      if (
        'awb' in parsed ||
        'current_status' in parsed ||
        'current_status_id' in parsed ||
        'shipment_status' in parsed ||
        'courier_name' in parsed
      ) {
        return 'shiprocket';
      }
    }
  } catch {
    // Non-JSON body; fall back to DB active provider below
  }
  return null;
}

/* ─── POST handler ────────────────────────────────────────────────── */

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const supabase = createAdminClient();

  const detected = detectProviderName(req, rawBody);
  let providerName: string = detected ?? '';
  if (!providerName) {
    const { data: settings } = await supabase
      .from('shipping_settings')
      .select('provider_name')
      .limit(1)
      .maybeSingle();
    providerName = settings?.provider_name || 'delhivery';
  }

  const headersRecord: Record<string, string | string[] | undefined> = {};
  req.headers.forEach((value, key) => { headersRecord[key] = value; });

  /* 1. Resolve provider config ──────────────────────────────────── */
  let config: ProviderConfig | null = null;

  if (process.env.SHIPPING_NEW_PROVIDER_PIPE === 'on') {
    const { data } = await supabase
      .from('shipping_providers')
      .select('*')
      .eq('name', providerName)
      .eq('is_active', true)
      .maybeSingle();
    config = data as ProviderConfig | null;
  }

  if (!config) {
    config = await getLegacyProviderConfig(supabase, providerName);
  }

  if (!config) {
    logEvent('shipping.webhook.no_config', { provider: providerName }, { source: 'webhook', severity: 'error' });
    return ok200('no_config');
  }

  /* 2. Instantiate provider ─────────────────────────────────────── */
  let parsed: NormalisedShipmentEvent | null = null;
  let signatureValid = true;

  try {
    if (providerName === 'delhivery') {
      const provider = new DelhiveryProvider(config);
      signatureValid = provider.verifyWebhook(headersRecord, rawBody);
      if (!signatureValid) {
        logEvent('shipping.webhook.signature_failed', { provider: providerName }, { source: 'webhook', severity: 'warn' });
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
      const body = JSON.parse(rawBody) as unknown;
      parsed = provider.parseWebhook(body);
    } else if (providerName === 'shiprocket') {
      const provider = new ShiprocketProvider(config);
      signatureValid = provider.verifyWebhook(headersRecord, rawBody);
      if (!signatureValid) {
        logEvent('shipping.webhook.signature_failed', { provider: providerName }, { source: 'webhook', severity: 'warn' });
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
      const body = JSON.parse(rawBody) as unknown;
      parsed = provider.parseWebhook(body);
    } else {
      const body = JSON.parse(rawBody) as unknown;
      logEvent('shipping.webhook.unknown_provider', { provider: providerName, body }, { source: 'webhook', severity: 'warn' });
      return ok200('unknown_provider');
    }
  } catch (err) {
    logEvent('shipping.webhook.parse_error', {
      provider: providerName,
      error: err instanceof Error ? err.message : String(err),
    }, { source: 'webhook', severity: 'error' });
    return ok200('parse_error');
  }

  if (!parsed) {
    logEvent('shipping.webhook.unparseable', { provider: providerName }, { source: 'webhook', severity: 'warn' });
    return ok200('not_a_shipment_event');
  }

  const { tracking_id, canonical_status, external_event_id, provider_event_type, provider_event_at, raw } = parsed;

  logEvent('shipping.webhook.received', {
    provider: providerName,
    tracking_id,
    canonical_status,
    external_event_id,
    provider_event_type,
  }, { source: 'webhook' });

  /* 3. Idempotency check ─────────────────────────────────────────── */
  const { data: existingEvent } = await supabase
    .from('shipping_webhook_events')
    .select('id')
    .eq('external_event_id', external_event_id)
    .maybeSingle();

  if (existingEvent) {
    logEvent('shipping.webhook.duplicate', { external_event_id, tracking_id }, { source: 'webhook' });
    return ok200('duplicate');
  }

  /* 4. Look up shipment (and fallback to orders by tracking_id) ──── */
  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, status, order_id')
    .eq('tracking_id', tracking_id)
    .maybeSingle();

  let orderId: string | null = shipment?.order_id ?? null;
  if (!orderId) {
    const { data: orderRow } = await supabase
      .from('orders')
      .select('id')
      .eq('tracking_id', tracking_id)
      .maybeSingle();
    orderId = orderRow?.id ?? null;
  }

  /* 5. Insert webhook event row (dedup anchor) ───────────────────── */
  await supabase.from('shipping_webhook_events').insert({
    provider_name: providerName,
    external_event_id,
    tracking_id,
    payload: raw as object,
    linked_shipment_id: shipment?.id ?? null,
    received_at: new Date().toISOString(),
  });

  if (!shipment && !orderId) {
    logEvent('shipping.webhook.no_shipment', { tracking_id, canonical_status }, { source: 'webhook', severity: 'warn' });
    return ok200('no_shipment_found');
  }

  /* 6. State machine guard (when shipment row exists) ───────────── */
  const currentStatus = (shipment?.status as CanonicalShipmentStatus | undefined) ?? null;
  if (currentStatus && currentStatus !== canonical_status && !canTransition(currentStatus, canonical_status)) {
    logEvent('shipping.webhook.illegal_transition', {
      tracking_id, from: currentStatus, to: canonical_status,
    }, { source: 'webhook', severity: 'warn' });
    return ok200('illegal_transition');
  }

  /* 7. Append history ─────────────────────────────────────────────── */
  if (shipment) {
    await supabase.from('shipment_status_history').insert({
      shipment_id: shipment.id,
      previous_status: currentStatus,
      next_status: canonical_status,
      source: 'webhook',
      provider_payload: raw as object,
    });
  }

  /* 8. Extract any scan events / ETD from webhook payload ─────────── */
  const rawObj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawScans = Array.isArray(rawObj.scans) ? (rawObj.scans as Array<Record<string, unknown>>) : [];
  const extractedEvents: TrackingScanEvent[] = rawScans
    .map((s) => ({
      timestamp: String(s.date || s.timestamp || provider_event_at || ''),
      status: String(s['sr-status-label'] || s.status || s.activity || provider_event_type),
      location: s.location ? String(s.location) : undefined,
      activity: s.activity ? String(s.activity) : undefined,
    }))
    .filter((e) => e.timestamp || e.status || e.activity);

  if (extractedEvents.length === 0) {
    extractedEvents.push({
      timestamp: provider_event_at ?? new Date().toISOString(),
      status: provider_event_type,
      location: rawObj.current_location ? String(rawObj.current_location) : undefined,
      activity: provider_event_type,
    });
  }

  const estimatedDeliveryDate =
    typeof rawObj.etd === 'string' && rawObj.etd.trim()
      ? rawObj.etd.trim()
      : undefined;

  /* 9. Apply idempotent milestone, stock restore, and notifications ─ */
  if (orderId) {
    await applyCanonicalShipmentMilestone({
      orderId,
      shipmentId: shipment?.id ?? null,
      canonicalStatus: canonical_status,
      events: extractedEvents,
      estimatedDeliveryDate,
      source: 'webhook',
      providerEventAt: provider_event_at,
    });
  }

  logEvent('shipping.webhook.processed', {
    tracking_id, from: currentStatus, to: canonical_status,
    shipment_id: shipment?.id ?? null, order_id: orderId,
  }, { source: 'webhook' });

  return ok200('processed');
}
