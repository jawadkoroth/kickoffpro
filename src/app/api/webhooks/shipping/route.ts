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
import { canTransition, shipmentStatusToOrderStatus } from '@/lib/shipping/state';
import type { CanonicalShipmentStatus } from '@/lib/shipping/state';
import type { NormalisedShipmentEvent } from '@/lib/shipping/types';
import { DelhiveryProvider } from '@/lib/shipping/delhivery';
import { ShiprocketProvider } from '@/lib/shipping/shiprocket';
import type { ProviderConfig } from '@/lib/shipping/types';

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
    auth_email: null,
    auth_password_encrypted: null,
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

/* ─── POST handler ────────────────────────────────────────────────── */

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const url = new URL(req.url);
  const providerName =
    url.searchParams.get('provider') ??
    headerStr(req.headers, 'x-provider') ??
    'delhivery';

  const supabase = createAdminClient();

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

  /* 4. Look up shipment ──────────────────────────────────────────── */
  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, status, order_id')
    .eq('tracking_id', tracking_id)
    .maybeSingle();

  /* 5. Insert webhook event row (dedup anchor) ───────────────────── */
  await supabase.from('shipping_webhook_events').insert({
    provider_name: providerName,
    external_event_id,
    tracking_id,
    raw_payload: raw as object,
    canonical_status,
    shipment_id: shipment?.id ?? null,
    received_at: new Date().toISOString(),
  });

  if (!shipment) {
    logEvent('shipping.webhook.no_shipment', { tracking_id, canonical_status }, { source: 'webhook', severity: 'warn' });
    return ok200('no_shipment_found');
  }

  const currentStatus = shipment.status as CanonicalShipmentStatus;

  /* 6. State machine guard ───────────────────────────────────────── */
  if (!canTransition(currentStatus, canonical_status)) {
    logEvent('shipping.webhook.illegal_transition', {
      tracking_id, from: currentStatus, to: canonical_status,
    }, { source: 'webhook', severity: 'warn' });
    return ok200('illegal_transition');
  }

  /* 7. Update shipment status ────────────────────────────────────── */
  await supabase
    .from('shipments')
    .update({
      status: canonical_status,
      last_provider_event_at: provider_event_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', shipment.id);

  /* 8. Append history ─────────────────────────────────────────────── */
  await supabase.from('shipment_status_history').insert({
    shipment_id: shipment.id,
    previous_status: currentStatus,
    next_status: canonical_status,
    source: 'webhook',
    provider_payload: raw as object,
  });

  /* 9. Denorm order status ───────────────────────────────────────── */
  const orderStatus = shipmentStatusToOrderStatus(canonical_status);
  if (orderStatus && shipment.order_id) {
    await supabase
      .from('orders')
      .update({ order_status: orderStatus, updated_at: new Date().toISOString() })
      .eq('id', shipment.order_id);
  }

  logEvent('shipping.webhook.processed', {
    tracking_id, from: currentStatus, to: canonical_status,
    shipment_id: shipment.id, order_id: shipment.order_id,
  }, { source: 'webhook' });

  return ok200('processed');
}
