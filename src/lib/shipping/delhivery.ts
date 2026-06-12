import crypto from 'crypto';
import {
  ShippingProvider,
  ShipmentRequest,
  ShipmentResponse,
  TrackingResponse,
  ServiceabilityResponse,
  LabelResponse,
  NormalisedShipmentEvent,
  ProviderConfig,
  ConnectionTestResult,
  ParsedProviderError,
} from './types';
import { mapDelhiveryStatus } from './state';
import { logEvent } from '@/lib/log';

/**
 * KickoffPro — Delhivery Error Forensics
 * Parses Delhivery API errors into actionable diagnostics.
 */
function parseDelhiveryError(status: number, data: Record<string, unknown>, _context?: string): ParsedProviderError {
  const base: Omit<ParsedProviderError, 'message'> = {
    provider: 'delhivery',
    status_code: status,
    raw: _context ? { ...data, context: _context } : data,
    retry_safe: false,
    operational_category: 'unknown',
    severity: 'high',
  };

  // 401 Unauthorized — Auth failure
  if (status === 401) {
    return {
      ...base,
      message: 'API key invalid or expired',
      meaning: 'The Delhivery token/API key is invalid or expired.',
      suggested_fix: 'Verify API credentials in Delhivery One dashboard. Re-run TEST CONNECTION.',
      severity: 'critical',
      operational_category: 'auth_failure',
    };
  }

  // 403 Forbidden — Permission issues
  if (status === 403) {
    return {
      ...base,
      message: 'API access denied',
      meaning: 'Your API key does not have permission for this operation.',
      suggested_fix: 'Check API key permissions in Delhivery One. Ensure "Create Order" scope is enabled.',
      severity: 'critical',
      operational_category: 'auth_failure',
    };
  }

  // 404 — Endpoint not found (usually wrong base URL)
  if (status === 404) {
    return {
      ...base,
      message: 'API endpoint not found',
      meaning: 'The API endpoint URL is incorrect. Base URL may have wrong path.',
      suggested_fix: 'Verify API base URL. Should be: https://track.delhivery.com (without /api suffix)',
      severity: 'high',
      operational_category: 'invalid_payload',
    };
  }

  // 400 / Generic payload errors — includes "format key missing"
  if (status === 400) {
    const errStr = JSON.stringify(data).toLowerCase();
    const rmk400 = (data.rmk ?? data.error ?? data.message ?? '') as string;
    if (errStr.includes('format') || errStr.includes('key missing') || errStr.includes('post')) {
      return {
        ...base,
        message: 'Malformed request — format/data fields missing',
        meaning: 'Delhivery requires multipart/form-data with format=json and data=<JSON string>, not raw JSON body.',
        suggested_fix: 'Ensure the request sends Content-Type: multipart/form-data with fields: format=json and data=<JSON payload string>.',
        severity: 'high',
        operational_category: 'invalid_payload',
        retry_safe: false,
      };
    }
    return {
      ...base,
      message: rmk400 || 'Bad request',
      meaning: 'Delhivery rejected the request payload.',
      suggested_fix: 'Check all required fields and request format.',
      severity: 'high',
      operational_category: 'invalid_payload',
    };
  }

  // 422 — Validation errors
  if (status === 422) {
    const rmk = (data.rmk ?? data.error ?? data.message ?? '') as string;
    const errorStr = JSON.stringify(data).toLowerCase();

    // Pickup location issues
    if (rmk.includes('pickup') || errorStr.includes('pickup') || errorStr.includes('warehouse')) {
      return {
        ...base,
        message: 'Pickup location invalid',
        meaning: 'The configured pickup address does not exist in Delhivery One.',
        suggested_fix: 'Delhivery One → Settings → Pickup Locations → Create warehouse using same address + phone as KickoffPro admin.',
        severity: 'high',
        operational_category: 'pickup_not_registered',
      };
    }

    // Phone/address issues
    if (rmk.includes('phone') || errorStr.includes('phone') || errorStr.includes('mobile')) {
      return {
        ...base,
        message: 'Customer phone invalid',
        meaning: 'Customer phone number is missing or invalid.',
        suggested_fix: 'Update customer information with valid 10-digit phone number before shipment creation.',
        severity: 'medium',
        operational_category: 'phone_missing',
      };
    }

    // Address issues
    if (rmk.includes('address') || errorStr.includes('address') || errorStr.includes('pincode')) {
      return {
        ...base,
        message: 'Delivery address invalid',
        meaning: 'Delivery address is incomplete or pincode is invalid.',
        suggested_fix: 'Verify customer address has: line1, city, state, valid 6-digit pincode.',
        severity: 'medium',
        operational_category: 'address_invalid',
      };
    }

    // Weight issues
    if (rmk.includes('weight') || errorStr.includes('weight')) {
      return {
        ...base,
        message: 'Product weight missing',
        meaning: 'Product weight is required for shipment creation.',
        suggested_fix: 'Add weight_grams to product before creating shipment.',
        severity: 'medium',
        operational_category: 'weight_missing',
      };
    }

    // COD issues
    if (rmk.includes('cod') || errorStr.includes('cod')) {
      return {
        ...base,
        message: 'COD not available',
        meaning: 'Cash on Delivery is not available for this destination.',
        suggested_fix: 'Check serviceability for destination pincode. May need to disable COD for this order.',
        severity: 'medium',
        operational_category: 'cod_not_available',
      };
    }

    // Generic 422
    return {
      ...base,
      message: rmk || 'Invalid shipment data',
      meaning: 'The shipment payload failed validation.',
      suggested_fix: 'Check all required fields: customer name, phone, complete address, product weight.',
      severity: 'medium',
      operational_category: 'invalid_payload',
    };
  }

  // 429 — Rate limiting
  if (status === 429) {
    return {
      ...base,
      message: 'Rate limit exceeded',
      meaning: 'Too many requests to Delhivery API.',
      suggested_fix: 'Wait 60 seconds before retrying. Consider batching shipments.',
      severity: 'medium',
      operational_category: 'rate_limit',
      retry_safe: true,
    };
  }

  // 500/502/503/504 — Server errors
  if (status >= 500) {
    return {
      ...base,
      message: 'Delhivery server error',
      meaning: 'Delhivery API is experiencing issues.',
      suggested_fix: 'Retry in 2-3 minutes. Check Delhivery status page if issues persist.',
      severity: 'high',
      operational_category: 'service_unavailable',
      retry_safe: true,
    };
  }

  // Network/timeout errors (status 0 or negative)
  if (status === 0 || status === -1) {
    return {
      ...base,
      message: 'Network timeout',
      meaning: 'Request to Delhivery API timed out.',
      suggested_fix: 'Retry shipment creation. If persists, check network connectivity.',
      severity: 'medium',
      operational_category: 'timeout',
      retry_safe: true,
    };
  }

  // Fallback for unknown errors
  const fallbackMsg = (data.rmk ?? data.error ?? data.message ?? `HTTP ${status}`) as string;
  return {
    ...base,
    message: fallbackMsg,
    meaning: 'An unexpected error occurred.',
    suggested_fix: 'Check error details and contact support if issue persists.',
    severity: 'high',
    operational_category: 'unknown',
  };
}

export class DelhiveryProvider implements ShippingProvider {
  readonly providerName = 'delhivery' as const;

  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly webhookSecret: string | null;
  private readonly pickupName: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.api_key ?? '';
    // CORRECT: Base URL without /api suffix — endpoints add their own paths
    this.apiUrl = (config.api_url ?? 'https://track.delhivery.com').replace(/\/api\/?$/, '');
    this.webhookSecret = config.webhook_secret ?? null;
    this.pickupName = config.pickup_name ?? '';
  }

  private authHeader(): Record<string, string> {
    return { Authorization: `Token ${this.apiKey}` };
  }

  /**
   * Pre-flight validation for shipment creation.
   * Validates all prerequisites before calling provider API.
   */
  validateShipmentRequest(req: ShipmentRequest): ParsedProviderError | null {
    // Customer phone required
    if (!req.customer.phone || req.customer.phone.length < 10) {
      return {
        provider: 'delhivery',
        status_code: 0,
        message: 'Customer phone missing or invalid',
        meaning: 'Customer phone number is required for shipment creation.',
        suggested_fix: 'Update customer information with valid 10-digit phone number.',
        retry_safe: false,
        operational_category: 'phone_missing',
        severity: 'medium',
        raw: { field: 'customer.phone', value: req.customer.phone },
      };
    }

    // Address validation
    if (!req.address.line1 || !req.address.city || !req.address.state || !req.address.pincode) {
      return {
        provider: 'delhivery',
        status_code: 0,
        message: 'Delivery address incomplete',
        meaning: 'Delivery address is missing required fields.',
        suggested_fix: 'Verify address has: line1, city, state, and 6-digit pincode.',
        retry_safe: false,
        operational_category: 'address_invalid',
        severity: 'medium',
        raw: { address: req.address },
      };
    }

    // Pincode format (6 digits)
    if (!/^\d{6}$/.test(req.address.pincode)) {
      return {
        provider: 'delhivery',
        status_code: 0,
        message: 'Invalid pincode format',
        meaning: 'Pincode must be exactly 6 digits.',
        suggested_fix: 'Verify pincode is valid 6-digit Indian postal code.',
        retry_safe: false,
        operational_category: 'address_invalid',
        severity: 'medium',
        raw: { pincode: req.address.pincode },
      };
    }

    // Product weight required
    if (!req.product.weight_grams || req.product.weight_grams <= 0) {
      return {
        provider: 'delhivery',
        status_code: 0,
        message: 'Product weight missing',
        meaning: 'Product weight is required for shipping cost calculation.',
        suggested_fix: 'Add weight_grams to product before creating shipment.',
        retry_safe: false,
        operational_category: 'weight_missing',
        severity: 'medium',
        raw: { weight_grams: req.product.weight_grams },
      };
    }

    // Pickup location configured
    if (!this.pickupName) {
      return {
        provider: 'delhivery',
        status_code: 0,
        message: 'Pickup location not configured',
        meaning: 'No pickup warehouse name is configured in settings.',
        suggested_fix: 'Configure pickup location in Admin → Shipping → Provider settings.',
        retry_safe: false,
        operational_category: 'pickup_not_registered',
        severity: 'high',
        raw: null,
      };
    }

    return null; // All validations passed
  }

  async createShipment(req: ShipmentRequest): Promise<ShipmentResponse> {
    // KickoffPro: Delhivery shipment payload — field names are Delhivery One API spec
    const shipmentPayload = {
      shipments: [{
        name: req.customer.name,
        add: req.address.line1,
        add2: req.address.line2 ?? '',
        address_type: 'home',
        city: req.address.city,
        state: req.address.state,
        pin: req.address.pincode,
        phone: req.customer.phone,
        order: req.order_number,
        payment_mode: req.payment.method === 'cod' ? 'COD' : 'Prepaid',
        cod_amount: req.payment.method === 'cod'
          ? ((req.payment.cod_amount_paise ?? 0) / 100).toString()
          : '0',
        // Weight must be in KG for Delhivery One
        weight: ((req.product.weight_grams ?? 500) / 1000).toFixed(3),
        shipment_width: 10,
        shipment_height: 10,
        shipment_length: 15,
        product_desc: req.product.name,
        quantity: req.product.quantity ?? 1,
      }],
      pickup_location: { name: this.pickupName },
    };

    const endpoint = `${this.apiUrl}/api/cmu/create.json`;
    const payloadDataStr = JSON.stringify(shipmentPayload);

    // KickoffPro: Delhivery requires multipart/form-data with:
    //   format=json
    //   data=<JSON string>
    // NOT application/json raw body — this is the "format key missing in POST" root cause.
    const formData = new FormData();
    formData.append('format', 'json');
    formData.append('data', payloadDataStr);

    const requestHeaders: Record<string, string> = {
      ...this.authHeader(),
      // Note: Don't set Content-Type for FormData - browser sets it with boundary
    };

    try {
      const t0 = Date.now();

      logEvent('shipping.delhivery.create_shipment_attempt', {
        order_number: req.order_number,
        endpoint,
        pickup_name: this.pickupName,
        payment_mode: shipmentPayload.shipments[0].payment_mode,
        weight_kg: shipmentPayload.shipments[0].weight,
        pincode: req.address.pincode,
        payload_preview: payloadDataStr.substring(0, 300),
      }, { source: 'api' });

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: requestHeaders,
        body: formData,
      });

      const latencyMs = Date.now() - t0;
      const rawText = await response.text();

      // Safe JSON parse — Delhivery sometimes returns non-JSON on errors
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        data = { raw_text: rawText, parse_error: 'Response was not valid JSON' };
      }

      // Log full request/response for diagnostics
      logEvent('shipping.delhivery.create_shipment', {
        order_number: req.order_number,
        endpoint,
        status_code: response.status,
        latency_ms: latencyMs,
        success: response.ok && !!data.packages,
        pickup_name: this.pickupName,
        response_preview: rawText.substring(0, 500),
      }, { source: 'api' });

      // Success: Delhivery returns { packages: [{ waybill, ... }] } on success
      const pkgs = data.packages as Array<{ waybill?: string; status?: string }> | undefined;
      const waybill = pkgs?.[0]?.waybill ?? (data.waybill as string | undefined);

      if (response.ok && waybill) {
        logEvent('shipping.delhivery.awb_created', {
          order_number: req.order_number,
          waybill,
          latency_ms: latencyMs,
        }, { source: 'api' });

        return {
          success: true,
          tracking_id: waybill,
          label_url: `${this.apiUrl}/api/p/packing_slip?wbns=${waybill}`,
          raw_response: data,
          latency_ms: latencyMs,
        };
      }

      // Also handle Delhivery's "upload" style success with cod/pre_count
      if (response.ok && (data.cod_count !== undefined || data.pre_count !== undefined)) {
        // Partial success — may have created some AWBs
        const uploadPkgs = data.package_count as number | undefined;
        logEvent('shipping.delhivery.awb_created', {
          order_number: req.order_number,
          waybill: 'pending_upload_response',
          package_count: uploadPkgs,
          latency_ms: latencyMs,
        }, { source: 'api' });
        return {
          success: true,
          tracking_id: waybill,
          raw_response: data,
          latency_ms: latencyMs,
        };
      }

      // Parse error with forensic diagnostics
      const parsedError = parseDelhiveryError(response.status, data, 'createShipment');

      const logSeverity: import('@/lib/log').Severity =
        parsedError.severity === 'critical' ? 'fatal' :
          parsedError.severity === 'high' ? 'error' :
            parsedError.severity === 'medium' ? 'warn' : 'info';

      logEvent('shipping.delhivery.create_shipment_failed', {
        order_number: req.order_number,
        endpoint,
        status_code: response.status,
        error: parsedError.message,
        operational_category: parsedError.operational_category,
        severity: parsedError.severity,
        retry_safe: parsedError.retry_safe,
        latency_ms: latencyMs,
        response_body: rawText.substring(0, 1000),
      }, { source: 'api', severity: logSeverity });

      return {
        success: false,
        error: parsedError.message,
        parsed_error: parsedError,
        raw_response: { ...data, _endpoint: endpoint, _status: response.status },
        retry_safe: parsedError.retry_safe,
        latency_ms: latencyMs,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      const isTimeout = msg.includes('timeout') || msg.includes('ETIMEDOUT');
      const parsedError = parseDelhiveryError(isTimeout ? 0 : -1, { error: msg });

      logEvent('shipping.delhivery.create_shipment_failed', {
        order_number: req.order_number,
        endpoint,
        error: msg,
        operational_category: parsedError.operational_category,
        severity: parsedError.severity,
        retry_safe: parsedError.retry_safe,
      }, { source: 'api', severity: 'error' });

      return {
        success: false,
        error: parsedError.message,
        parsed_error: parsedError,
        raw_response: { error: msg, _endpoint: endpoint },
        retry_safe: parsedError.retry_safe,
      };
    }
  }

  async trackShipment(tracking_id: string): Promise<TrackingResponse> {
    try {
      const response = await fetch(
        `${this.apiUrl}/api/v1/packages/json/?waybill=${tracking_id}`,
        { headers: this.authHeader() },
      );
      const data = await response.json() as Record<string, unknown>;
      const shipmentData = (data['ShipmentData'] as Array<{ Shipment?: { Status?: { Status?: string; Instructions?: string; StatusDateTime?: string } } }> | undefined)?.[0];
      const rawStatus = shipmentData?.Shipment?.Status?.Status ?? 'unknown';
      return {
        status: rawStatus,
        location: shipmentData?.Shipment?.Status?.Instructions,
        timestamp: shipmentData?.Shipment?.Status?.StatusDateTime,
        raw: data,
      };
    } catch (err) {
      return { status: 'error', raw: err };
    }
  }

  async cancelShipment(tracking_id: string): Promise<{ success: boolean }> {
    try {
      // Delhivery cancel also uses form-encoded body
      const formData = new FormData();
      formData.append('waybill', tracking_id);
      formData.append('cancellation', 'true');

      const response = await fetch(`${this.apiUrl}/api/p/edit`, {
        method: 'POST',
        headers: { ...this.authHeader() }, // Don't set Content-Type for FormData
        body: formData,
      });
      const rawText = await response.text();
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(rawText) as Record<string, unknown>; } catch { /* non-JSON */ }
      return { success: response.ok && !!data.status };
    } catch {
      return { success: false };
    }
  }

  async generateLabel(tracking_id: string): Promise<LabelResponse> {
    const url = `${this.apiUrl}/api/p/packing_slip?wbns=${tracking_id}`;
    return { url };
  }

  async checkServiceability(pincode: string): Promise<ServiceabilityResponse> {
    try {
      const response = await fetch(
        `${this.apiUrl}/c/api/pin-codes/json/?filter_codes=${pincode}`,
        { headers: this.authHeader() },
      );
      const data = await response.json() as Record<string, unknown>;
      const deliveryData = data['delivery_codes'] as Array<{ postal_code?: { cod?: string; pre_paid?: string } }> | undefined;
      const entry = deliveryData?.[0]?.postal_code;
      return {
        serviceable: !!entry,
        cod_available: entry?.cod === 'Y',
        raw: data,
      };
    } catch {
      return { serviceable: false, cod_available: false };
    }
  }

  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): boolean {
    if (!this.webhookSecret) {
      return true;
    }
    const signature = headers['x-delhivery-signature'] ?? headers['x-webhook-signature'];
    const sig = Array.isArray(signature) ? signature[0] : signature;
    if (!sig) return false;
    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }

  parseWebhook(body: unknown): NormalisedShipmentEvent | null {
    try {
      const payload = body as Record<string, unknown>;
      const waybill =
        (payload['waybill'] as string | undefined) ??
        (payload['tracking_id'] as string | undefined);
      if (!waybill) return null;

      const rawStatus =
        (payload['status'] as string | undefined) ??
        (payload['Status'] as string | undefined) ??
        '';
      const canonical = mapDelhiveryStatus(rawStatus);
      if (!canonical) return null;

      const eventType = (payload['event_type'] as string | undefined) ?? rawStatus;
      const timestamp = (payload['timestamp'] as string | undefined) ?? new Date().toISOString();

      const externalEventId = crypto
        .createHash('sha256')
        .update(`${waybill}:${eventType}:${timestamp}`)
        .digest('hex');

      return {
        tracking_id: waybill,
        canonical_status: canonical,
        provider_event_type: eventType,
        provider_event_at: timestamp,
        external_event_id: externalEventId,
        raw: body,
      };
    } catch {
      return null;
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const t0 = Date.now();
    const errors: string[] = [];
    const warnings: string[] = [];
    let authOk = false;
    let apiOk = false;
    let pickupOk = false;
    let authLatency = 0;
    let pickupLatency = 0;

    // ── 1. Auth + endpoint check via pincode serviceability (lightweight) ──
    try {
      const testPin = '110001'; // Delhi — always serviceable
      const t1 = Date.now();
      const res = await fetch(
        `${this.apiUrl}/c/api/pin-codes/json/?filter_codes=${testPin}`,
        { headers: this.authHeader() },
      );
      authLatency = Date.now() - t1;
      const rawText = await res.text();

      if (res.status === 401 || res.status === 403) {
        errors.push('API key invalid or expired — regenerate in Delhivery One dashboard');
      } else if (res.status === 404) {
        errors.push(`Endpoint not found (404) — base URL should be https://track.delhivery.com, got: ${this.apiUrl}`);
      } else if (res.ok) {
        authOk = true;
        apiOk = true;
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(rawText) as Record<string, unknown>; } catch { /* skip */ }
        if (!parsed?.delivery_codes || !Array.isArray(parsed.delivery_codes)) {
          warnings.push('Unexpected API response format — verify base URL is https://track.delhivery.com');
        }
      } else {
        errors.push(`API returned HTTP ${res.status} — verify endpoint URL and API key`);
      }
    } catch (err) {
      authLatency = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('network')) {
        errors.push(`Cannot reach Delhivery API (${this.apiUrl}) — check network/firewall`);
      } else {
        errors.push(`Auth check failed: ${msg}`);
      }
    }

    // ── 2. Pickup facility validation via Delhivery facilities API ──
    if (!this.pickupName || this.pickupName.trim().length === 0) {
      errors.push('Pickup location name not configured — add pickup name in provider settings');
      pickupOk = false;
    } else if (authOk) {
      // Try to validate pickup name exists in Delhivery's registered facilities
      try {
        const t2 = Date.now();
        const facilityRes = await fetch(
          `${this.apiUrl}/api/backend/clientwarehouse/detail/?name=${encodeURIComponent(this.pickupName)}`,
          { headers: this.authHeader() },
        );
        pickupLatency = Date.now() - t2;

        if (facilityRes.ok) {
          const rawText = await facilityRes.text();
          let facilityData: Record<string, unknown> = {};
          try { facilityData = JSON.parse(rawText) as Record<string, unknown>; } catch { /* skip */ }

          // Delhivery returns { data: [...] } or { count: N, data: [...] }
          const facilityList = facilityData.data as unknown[] | undefined;
          if (facilityList && facilityList.length > 0) {
            pickupOk = true;
          } else if (facilityData.count === 0 || (facilityList && facilityList.length === 0)) {
            errors.push(`Pickup location "${this.pickupName}" not found in Delhivery One — verify name matches exactly`);
            warnings.push('Go to Delhivery One → Settings → Pickup Locations to verify the pickup name');
          } else {
            // Unknown response format — treat as ok (can't definitively fail)
            pickupOk = true;
            warnings.push('Could not verify pickup location — response format unexpected');
          }
        } else if (facilityRes.status === 404) {
          // Some Delhivery accounts don't have this endpoint — fall back to name-present check
          pickupOk = true;
          warnings.push(`Pickup name set: "${this.pickupName}" (facility API not available for verification)`);
        } else {
          pickupOk = true; // Don't block on non-critical facility check failures
          warnings.push(`Pickup facility check returned ${facilityRes.status} — name may not be registered`);
        }
      } catch {
        // Network error on facility check — don't fail the whole test
        pickupOk = true;
        warnings.push(`Pickup name set: "${this.pickupName}" (could not verify via API)`);
      }
    } else {
      // Auth failed — can't check pickup
      pickupOk = false;
    }

    const overallSuccess = authOk && apiOk && pickupOk && errors.length === 0;

    logEvent('shipping.delhivery.connection_test', {
      success: overallSuccess,
      auth_ok: authOk,
      api_ok: apiOk,
      pickup_ok: pickupOk,
      auth_latency_ms: authLatency,
      pickup_latency_ms: pickupLatency,
      error_count: errors.length,
      warning_count: warnings.length,
      base_url: this.apiUrl,
      pickup_name: this.pickupName,
    }, { source: 'system', severity: errors.length > 0 ? 'warn' : 'info' });

    return {
      success: overallSuccess,
      provider: 'delhivery',
      checks: {
        auth: {
          ok: authOk,
          latency_ms: authLatency,
          message: authOk ? 'API key valid — endpoint reachable' : (errors.find(e => e.includes('API key') || e.includes('reach') || e.includes('Cannot reach') || e.includes('HTTP')) ?? 'Auth check failed'),
        },
        api: {
          ok: apiOk,
          message: apiOk ? `Endpoint reachable: ${this.apiUrl}` : (errors.find(e => e.includes('endpoint') || e.includes('reach')) ?? 'Endpoint unreachable'),
        },
        pickup: {
          ok: pickupOk,
          message: pickupOk
            ? `Pickup configured: "${this.pickupName}"`
            : (errors.find(e => e.includes('Pickup') || e.includes('pickup')) ?? 'Pickup not configured'),
        },
      },
      errors,
      warnings,
      timestamp: new Date().toISOString(),
    };
  }
}
