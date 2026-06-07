/**
 * KickoffPro — Canonical shipment creation entry point.
 *
 * Every code path that needs to create a shipment calls this function.
 * No direct provider imports anywhere else.
 *
 * Dual-write strategy (PR 2):
 *   1. Write a shipments row via upsert_shipment_idempotent RPC
 *      (idempotent on client_request_id).
 *   2. Call the active provider's createShipment().
 *   3. Update the shipments row with the returned tracking_id / label_url.
 *   4. Denormalise back to orders.tracking_id / label_url / shipping_provider
 *      (legacy back-compat columns — kept in sync until cleanup PR).
 *   5. Append a row to shipment_status_history (source = 'system').
 *   6. Log success/failure to app_events (observability spine).
 *
 * When SHIPPING_NEW_PROVIDER_PIPE is not 'on', getActiveProvider() returns
 * null and this function returns null — the caller falls back to its
 * existing legacy path. Zero behaviour change when flag is off.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/log';
import { getActiveProvider, getActiveProviderConfig } from './registry';
import type { ShipmentRequest, ShipmentResponse } from './types';

export interface CreateShipmentForOrderInput {
  /** Stable per-(order, attempt) idempotency key. Pass order_id for attempt 1. */
  clientRequestId: string;
  orderId: string;
  orderNumber: string;
  attemptNumber?: number;
  req: ShipmentRequest;
}

export interface CreateShipmentForOrderResult {
  shipmentId: string;
  trackingId: string | undefined;
  labelUrl: string | undefined;
  providerResponse: ShipmentResponse;
}

/**
 * Create a shipment for an order via the active provider.
 *
 * Returns null when the new provider pipe is disabled (caller uses legacy path).
 * Throws on unrecoverable errors after logging them.
 */
export async function createShipmentForOrder(
  input: CreateShipmentForOrderInput,
): Promise<CreateShipmentForOrderResult | null> {
  const provider = await getActiveProvider();
  if (!provider) return null;

  const config = await getActiveProviderConfig();
  if (!config) return null;

  const supabase = createAdminClient();
  const attemptNumber = input.attemptNumber ?? 1;

  const paymentMethod =
    input.req.payment.method === 'cod' ? 'cod' : 'prepaid';

  const { data: shipmentRow, error: upsertErr } = await supabase.rpc(
    'upsert_shipment_idempotent',
    {
      p_client_request_id: input.clientRequestId,
      p_order_id: input.orderId,
      p_provider_id: config.id,
      p_provider_name: config.name,
      p_attempt_number: attemptNumber,
      p_created_via: 'auto',
      p_payment_method: paymentMethod,
      p_cod_amount_paise: input.req.payment.cod_amount_paise ?? null,
      p_weight_grams: input.req.product.weight_grams ?? null,
      p_raw_create_response: null,
    },
  );

  if (upsertErr || !shipmentRow) {
    logEvent('shipping.create_shipment.upsert_failed', {
      order_id: input.orderId,
      order_number: input.orderNumber,
      client_request_id: input.clientRequestId,
      error: upsertErr?.message ?? 'no row returned',
    }, { source: 'api', severity: 'error', entityType: 'order', entityId: input.orderId });
    throw new Error(`Shipment row upsert failed: ${upsertErr?.message ?? 'no row returned'}`);
  }

  const shipmentId: string = (shipmentRow as { id: string }).id;

  // KickoffPro: Pre-flight validation before calling provider API
  const preflightError = provider.validateShipmentRequest(input.req);
  if (preflightError) {
    logEvent('shipping.create_shipment.preflight_failed', {
      order_id: input.orderId,
      order_number: input.orderNumber,
      shipment_id: shipmentId,
      provider: provider.providerName,
      error: preflightError.message,
      operational_category: preflightError.operational_category,
      severity: preflightError.severity,
    }, { source: 'api', severity: preflightError.severity === 'critical' ? 'error' : 'warn', entityType: 'order', entityId: input.orderId });

    // Update shipment with preflight error details
    await supabase
      .from('shipments')
      .update({
        status: 'failed',
        status_detail: preflightError.message,
        parsed_error: preflightError as object,
        retry_safe: preflightError.retry_safe,
        operational_category: preflightError.operational_category,
        error_severity: preflightError.severity,
        last_error_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', shipmentId);

    await supabase.from('shipment_status_history').insert({
      shipment_id: shipmentId,
      previous_status: 'pending',
      next_status: 'failed',
      source: 'system',
      notes: `[Preflight] ${preflightError.message} — ${preflightError.suggested_fix}`,
      provider_payload: { preflight_error: preflightError } as object,
    });

    return {
      shipmentId,
      trackingId: undefined,
      labelUrl: undefined,
      providerResponse: {
        success: false,
        error: preflightError.message,
        parsed_error: preflightError,
        retry_safe: preflightError.retry_safe,
      },
    };
  }

  const t0 = Date.now();
  const providerResponse = await provider.createShipment(input.req);
  const latencyMs = Date.now() - t0;

  // Add latency to response for storage
  const providerResponseWithLatency = { ...providerResponse, latency_ms: latencyMs };

  if (!providerResponse.success) {
    const parsedError = providerResponse.parsed_error;
    const logSeverity: import('@/lib/log').Severity =
      parsedError?.severity === 'critical' ? 'fatal' :
        parsedError?.severity === 'high' ? 'error' :
          parsedError?.severity === 'medium' ? 'warn' : 'info';

    logEvent('shipping.create_shipment.provider_failed', {
      order_id: input.orderId,
      order_number: input.orderNumber,
      shipment_id: shipmentId,
      provider: provider.providerName,
      error: providerResponse.error,
      operational_category: parsedError?.operational_category ?? 'unknown',
      severity: parsedError?.severity ?? 'high',
      retry_safe: parsedError?.retry_safe ?? false,
      latency_ms: latencyMs,
    }, { source: 'api', severity: logSeverity, entityType: 'order', entityId: input.orderId });

    // KickoffPro: Store forensic error details
    await supabase
      .from('shipments')
      .update({
        status: 'failed',
        status_detail: providerResponse.error,
        raw_create_response: providerResponse.raw_response as object,
        parsed_error: parsedError as object,
        retry_safe: parsedError?.retry_safe ?? false,
        latency_ms: latencyMs,
        operational_category: parsedError?.operational_category ?? 'unknown',
        error_severity: parsedError?.severity ?? 'high',
        last_error_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', shipmentId);

    const historyNotes = parsedError
      ? `${parsedError.message} — ${parsedError.suggested_fix}`
      : providerResponse.error;

    await supabase.from('shipment_status_history').insert({
      shipment_id: shipmentId,
      previous_status: 'pending',
      next_status: 'failed',
      source: 'system',
      notes: historyNotes,
      provider_payload: providerResponse.raw_response as object,
    });

    return {
      shipmentId,
      trackingId: undefined,
      labelUrl: undefined,
      providerResponse: providerResponseWithLatency,
    };
  }

  const trackingId = providerResponse.tracking_id;
  const labelUrl = providerResponse.label_url;

  await supabase
    .from('shipments')
    .update({
      status: 'shipment_created',
      tracking_id: trackingId,
      label_url: labelUrl,
      raw_create_response: providerResponse.raw_response as object,
      latency_ms: latencyMs,
      last_provider_event_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', shipmentId);

  await supabase.from('shipment_status_history').insert({
    shipment_id: shipmentId,
    previous_status: 'pending',
    next_status: 'shipment_created',
    source: 'system',
    provider_payload: providerResponse.raw_response as object,
  });

  await supabase
    .from('orders')
    .update({
      tracking_id: trackingId ?? null,
      label_url: labelUrl ?? null,
      shipping_provider: provider.providerName,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.orderId);

  logEvent('shipping.create_shipment.success', {
    order_id: input.orderId,
    order_number: input.orderNumber,
    shipment_id: shipmentId,
    tracking_id: trackingId,
    provider: provider.providerName,
    latency_ms: latencyMs,
  }, { source: 'api', entityType: 'order', entityId: input.orderId });

  return { shipmentId, trackingId, labelUrl, providerResponse };
}
