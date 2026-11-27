/**
 * KickoffPro — Shiprocket provider adapter.
 *
 * Auth model: JWT session token obtained via /auth/login (valid 10 days / refreshed proactively).
 * Shipment flow:
 *   1. Ensure valid JWT (auto-login via auth_email + auth_password_encrypted if missing/expired)
 *   2. POST /orders/create/adhoc  -> shipment_id
 *   3. POST /courier/assign/awb   -> awb_code
 *   4. POST /courier/generate/label -> label_url (best-effort)
 *   5. POST /courier/generate/pickup -> queue pickup (best-effort)
 */

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
  TokenRefreshResult,
  ConnectionTestResult,
  ParsedProviderError,
} from './types';
import { logEvent } from '@/lib/log';

export function mapShiprocketStatus(rawStatus: string): import('./state').CanonicalShipmentStatus | null {
  const s = rawStatus?.toUpperCase?.().trim() ?? '';
  if (['DELIVERED'].includes(s)) return 'delivered';
  if (['OUT FOR DELIVERY', 'OFD'].includes(s)) return 'out_for_delivery';
  if (['IN TRANSIT', 'PICKED UP AND IN TRANSIT', 'SHIPPED', 'DISPATCHED'].includes(s)) return 'in_transit';
  if (['PICKUP SCHEDULED', 'PICKUP GENERATED', 'PICKED UP', 'PICKUP QUEUED'].includes(s)) return 'picked_up';
  if (['SHIPMENT CREATED', 'AWB ASSIGNED', 'LABEL GENERATED', 'READY TO SHIP', 'MANIFESTED'].includes(s)) {
    return 'shipment_created';
  }
  if (['RTO INITIATED', 'RTO IN TRANSIT', 'RTO DELIVERED', 'RTO ACKNOWLEDGED', 'RETURNED'].includes(s)) {
    return 'returned';
  }
  if (['CANCELED', 'CANCELLED'].includes(s)) return 'cancelled';
  if (['FAILED DELIVERY', 'UNDELIVERED'].includes(s)) return 'failed';
  return null;
}

export class ShiprocketProvider implements ShippingProvider {
  readonly providerName = 'shiprocket' as const;

  private readonly baseUrl: string;
  private readonly authEmail: string | null;
  private readonly authPasswordEncrypted: string | null;
  private readonly webhookSecret: string | null;
  private readonly pickupName: string;
  private readonly pickupPincodeValue: string;
  private token: string | null;
  private tokenExpiresAt: string | null;
  private tokenRefreshed = false;

  constructor(config: ProviderConfig) {
    this.baseUrl = (config.api_url || 'https://apiv2.shiprocket.in/v1/external').replace(/\/+$/, '');
    this.authEmail = config.auth_email ?? null;
    this.authPasswordEncrypted = config.auth_password_encrypted ?? null;
    this.webhookSecret = config.webhook_secret ?? null;
    this.pickupName = (config.pickup_name ?? '').trim();
    this.pickupPincodeValue = (config.pickup_pincode ?? '').trim();
    this.token = config.token ?? null;
    this.tokenExpiresAt = config.token_expires_at ?? null;
  }

  /** Returns updated token metadata if `refreshAuth()` ran during this provider instance's lifecycle. */
  getRefreshedAuth(): TokenRefreshResult | null {
    if (!this.tokenRefreshed || !this.token || !this.tokenExpiresAt) return null;
    return { token: this.token, expires_at: this.tokenExpiresAt };
  }

  private authHeader(): Record<string, string> {
    if (!this.token) throw new Error('Shiprocket: no token — call refreshAuth() first');
    return { Authorization: `Bearer ${this.token}` };
  }

  private isTokenExpired(): boolean {
    if (!this.token) return true;
    if (!this.tokenExpiresAt) return false;
    const exp = Date.parse(this.tokenExpiresAt);
    if (Number.isNaN(exp)) return false;
    return exp <= Date.now() + 60_000;
  }

  private async ensureToken(): Promise<void> {
    if (!this.isTokenExpired()) return;
    await this.refreshAuth();
  }

  private parseShiprocketError(status: number, data: Record<string, unknown>): ParsedProviderError {
    const base: Omit<ParsedProviderError, 'message'> = {
      provider: 'shiprocket',
      status_code: status,
      raw: data,
      retry_safe: false,
      operational_category: 'unknown',
      severity: 'high',
    };

    const nestedErrors =
      data.errors && typeof data.errors === 'object'
        ? Object.values(data.errors as Record<string, unknown>)
            .flat()
            .filter(Boolean)
            .join('; ')
        : '';
    const message = String(
      nestedErrors || data.message || data.error || (status ? `HTTP ${status}` : 'Shiprocket error'),
    ).trim();
    const errorStr = message.toLowerCase();

    if (status === 401) {
      return {
        ...base,
        message: 'JWT token invalid or expired',
        meaning: message || 'The Shiprocket JWT token has expired or credentials are invalid.',
        suggested_fix: 'Verify Shiprocket API user email/password in Admin -> Shipping and re-run Test Connection.',
        severity: 'critical',
        operational_category: 'auth_failure',
        retry_safe: true,
      };
    }

    if (status === 403) {
      return {
        ...base,
        message: 'API access denied',
        meaning: message || 'Your Shiprocket API user does not have permission for this operation.',
        suggested_fix: 'Verify API user permissions in Shiprocket -> Settings -> API.',
        severity: 'critical',
        operational_category: 'auth_failure',
      };
    }

    if (status === 422 || status === 400) {
      if (errorStr.includes('pickup') || errorStr.includes('warehouse')) {
        return {
          ...base,
          message: message || 'Pickup location not found',
          meaning: 'The configured pickup location name does not match Shiprocket.',
          suggested_fix: 'Shiprocket -> Settings -> Pickup Addresses -> ensure Pickup Nickname matches KickoffPro Pickup Facility Name.',
          severity: 'high',
          operational_category: 'pickup_not_registered',
        };
      }
      if (errorStr.includes('balance') || errorStr.includes('wallet') || errorStr.includes('recharge')) {
        return {
          ...base,
          message: message || 'Shiprocket wallet balance insufficient',
          meaning: message,
          suggested_fix: 'Recharge your Shiprocket wallet before generating AWB.',
          severity: 'high',
          operational_category: 'invalid_payload',
        };
      }
      if (errorStr.includes('phone') || errorStr.includes('mobile')) {
        return {
          ...base,
          message: message || 'Customer phone invalid',
          meaning: 'Customer phone number is missing or invalid format.',
          suggested_fix: 'Update customer information with valid 10-digit phone number.',
          severity: 'medium',
          operational_category: 'phone_missing',
        };
      }
      if (errorStr.includes('pincode') || errorStr.includes('address') || errorStr.includes('postcode')) {
        return {
          ...base,
          message: message || 'Delivery address invalid',
          meaning: 'Pincode is invalid or not serviceable.',
          suggested_fix: 'Verify 6-digit pincode and serviceability in Shiprocket.',
          severity: 'medium',
          operational_category: 'address_invalid',
        };
      }
      if (errorStr.includes('weight')) {
        return {
          ...base,
          message: message || 'Product weight invalid',
          meaning: 'Weight is missing or exceeds limits.',
          suggested_fix: 'Add valid weight_grams to product.',
          severity: 'medium',
          operational_category: 'weight_missing',
        };
      }
      if (errorStr.includes('cod')) {
        return {
          ...base,
          message: message || 'COD not available',
          meaning: 'Cash on Delivery is not available for this destination.',
          suggested_fix: 'Check COD serviceability for destination pincode.',
          severity: 'medium',
          operational_category: 'cod_not_available',
        };
      }
      return {
        ...base,
        message: message || 'Invalid order data',
        meaning: message || 'The order payload failed Shiprocket validation.',
        suggested_fix: 'Check customer address, pickup location, and item details.',
        severity: 'medium',
        operational_category: 'invalid_payload',
      };
    }

    if (status === 429) {
      return {
        ...base,
        message: 'Rate limit exceeded',
        meaning: 'Too many API requests to Shiprocket.',
        suggested_fix: 'Wait 60 seconds before retrying.',
        severity: 'medium',
        operational_category: 'rate_limit',
        retry_safe: true,
      };
    }

    if (status >= 500) {
      return {
        ...base,
        message: 'Shiprocket server error',
        meaning: message || 'Shiprocket API is experiencing issues.',
        suggested_fix: 'Retry in 2-3 minutes.',
        severity: 'high',
        operational_category: 'service_unavailable',
        retry_safe: true,
      };
    }

    return {
      ...base,
      message: message || `HTTP ${status}`,
      meaning: message || 'An unexpected error occurred.',
      suggested_fix: 'Check raw response details below.',
      severity: 'high',
      operational_category: 'unknown',
    };
  }

  validateShipmentRequest(req: ShipmentRequest): ParsedProviderError | null {
    if (!req.customer.phone || req.customer.phone.replace(/\D/g, '').length < 10) {
      return {
        provider: 'shiprocket',
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

    if (!req.address.line1 || !req.address.city || !req.address.state || !req.address.pincode) {
      return {
        provider: 'shiprocket',
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

    if (!/^\d{6}$/.test(req.address.pincode)) {
      return {
        provider: 'shiprocket',
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

    if (!req.product.weight_grams || req.product.weight_grams <= 0) {
      return {
        provider: 'shiprocket',
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

    if (!this.pickupName) {
      return {
        provider: 'shiprocket',
        status_code: 0,
        message: 'Pickup location not configured',
        meaning: 'No pickup warehouse name is configured in settings.',
        suggested_fix: 'Configure Pickup Facility Name in Admin -> Shipping.',
        retry_safe: false,
        operational_category: 'pickup_not_registered',
        severity: 'high',
        raw: null,
      };
    }

    if (!this.pickupPincodeValue || !/^\d{6}$/.test(this.pickupPincodeValue)) {
      return {
        provider: 'shiprocket',
        status_code: 0,
        message: 'Pickup pincode missing or invalid',
        meaning: 'A valid 6-digit pickup pincode is required.',
        suggested_fix: 'Configure pickup pincode in Admin -> Shipping.',
        retry_safe: false,
        operational_category: 'pickup_not_registered',
        severity: 'high',
        raw: { pickup_pincode: this.pickupPincodeValue },
      };
    }

    if (!this.token && (!this.authEmail || !this.authPasswordEncrypted)) {
      return {
        provider: 'shiprocket',
        status_code: 0,
        message: 'Shiprocket credentials not configured',
        meaning: 'Shiprocket API email and password are missing.',
        suggested_fix: 'Enter Shiprocket API Email & Password in Admin -> Shipping and save.',
        retry_safe: false,
        operational_category: 'auth_failure',
        severity: 'critical',
        raw: null,
      };
    }

    return null;
  }

  async refreshAuth(): Promise<TokenRefreshResult> {
    if (!this.authEmail || !this.authPasswordEncrypted) {
      throw new Error('Shiprocket: auth email and password are not configured');
    }
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: this.authEmail.trim(),
        password: this.authPasswordEncrypted,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || !data.token) {
      throw new Error(
        `Shiprocket login failed (${res.status}): ${String(data.message || JSON.stringify(data))}`,
      );
    }
    const token = String(data.token);
    // Shiprocket tokens remain valid for ~10 days; refresh proactively every 24h
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    this.token = token;
    this.tokenExpiresAt = expiresAt;
    this.tokenRefreshed = true;
    logEvent('shipping.shiprocket.token_refreshed', { expires_at: expiresAt }, { source: 'system' });
    return { token, expires_at: expiresAt };
  }

  private async authedFetch(path: string, init: RequestInit): Promise<Response> {
    await this.ensureToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...this.authHeader() },
    });
    if (res.status === 401 && this.authEmail && this.authPasswordEncrypted) {
      await this.refreshAuth();
      return fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), ...this.authHeader() },
      });
    }
    return res;
  }

  async createShipment(req: ShipmentRequest): Promise<ShipmentResponse> {
    const t0 = Date.now();
    try {
      const orderTotalInr = Number(
        ((req.payment.total_amount_paise ?? req.payment.cod_amount_paise ?? 0) / 100).toFixed(2),
      );
      const qty = Math.max(1, req.product.quantity || 1);
      const unitPriceInr = Number((orderTotalInr / qty).toFixed(2));
      const cleanPhone = req.customer.phone.replace(/\D/g, '').slice(-10);

      const orderPayload = {
        order_id: req.order_number,
        order_date: new Date().toISOString().slice(0, 16).replace('T', ' '),
        pickup_location: this.pickupName,
        billing_customer_name: req.customer.name,
        billing_last_name: '',
        billing_address: req.address.line1,
        billing_address_2: req.address.line2 ?? '',
        billing_city: req.address.city,
        billing_pincode: req.address.pincode,
        billing_state: req.address.state,
        billing_country: 'India',
        billing_email: req.customer.email || 'orders@kickoffpro.in',
        billing_phone: cleanPhone,
        shipping_is_billing: true,
        order_items: [
          {
            name: req.product.name,
            sku: req.order_number,
            units: qty,
            selling_price: unitPriceInr,
            discount: 0,
            tax: 0,
            hsn: '',
          },
        ],
        payment_method: req.payment.method === 'cod' ? 'COD' : 'Prepaid',
        sub_total: orderTotalInr,
        length: 15,
        breadth: 12,
        height: 5,
        weight: Math.max(0.05, Number(((req.product.weight_grams || 500) / 1000).toFixed(3))),
      };

      // Step 1: Create adhoc order in Shiprocket
      const createRes = await this.authedFetch('/orders/create/adhoc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload),
      });
      const createData = (await createRes.json().catch(() => ({}))) as Record<string, unknown>;

      if (!createRes.ok || !createData.shipment_id) {
        const latencyMs = Date.now() - t0;
        const parsedError = this.parseShiprocketError(createRes.status, createData);
        logEvent(
          'shipping.shiprocket.create_failed',
          { order_number: req.order_number, status: createRes.status, error: parsedError.message },
          { source: 'api', severity: 'error' },
        );
        return {
          success: false,
          error: parsedError.message,
          parsed_error: parsedError,
          raw_response: createData,
          retry_safe: parsedError.retry_safe,
          latency_ms: latencyMs,
        };
      }

      const shipmentId = Number(createData.shipment_id);
      let awbCode = String(
        ((createData.payload as Record<string, unknown> | undefined)?.awb_code as string | undefined) ||
          createData.awb_code ||
          '',
      ).trim();

      // Step 2: Assign AWB (auto-selects best courier if not already assigned)
      let awbData: Record<string, unknown> | null = null;
      if (!awbCode) {
        const awbRes = await this.authedFetch('/courier/assign/awb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shipment_id: shipmentId }),
        });
        awbData = (await awbRes.json().catch(() => ({}))) as Record<string, unknown>;

        const responseData = (awbData.response as Record<string, unknown> | undefined)?.data as
          | Record<string, unknown>
          | undefined;
        awbCode = String(responseData?.awb_code || awbData.awb_code || '').trim();

        const awbAssignStatus = awbData.awb_assign_status;
        if (!awbRes.ok || !awbCode || awbAssignStatus === 0) {
          const latencyMs = Date.now() - t0;
          const parsedError = this.parseShiprocketError(
            awbRes.ok ? 422 : awbRes.status,
            awbData,
          );
          logEvent(
            'shipping.shiprocket.awb_assign_failed',
            {
              order_number: req.order_number,
              shiprocket_shipment_id: shipmentId,
              error: parsedError.message,
            },
            { source: 'api', severity: 'error' },
          );
          return {
            success: false,
            error: parsedError.message,
            parsed_error: parsedError,
            raw_response: { create: createData, awb: awbData },
            retry_safe: parsedError.retry_safe,
            latency_ms: latencyMs,
          };
        }
      }

      // Step 3: Generate label PDF URL (best-effort)
      let labelUrl: string | undefined;
      let labelData: Record<string, unknown> | null = null;
      try {
        const labelRes = await this.authedFetch('/courier/generate/label', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shipment_id: [shipmentId] }),
        });
        labelData = (await labelRes.json().catch(() => ({}))) as Record<string, unknown>;
        if (typeof labelData.label_url === 'string' && labelData.label_url.trim()) {
          labelUrl = labelData.label_url.trim();
        }
      } catch {
        // Non-blocking: AWB is already issued
      }

      // Step 4: Schedule pickup (best-effort)
      try {
        await this.authedFetch('/courier/generate/pickup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shipment_id: [shipmentId] }),
        });
      } catch {
        // Non-blocking
      }

      const latencyMs = Date.now() - t0;
      logEvent(
        'shipping.shiprocket.awb_created',
        {
          order_number: req.order_number,
          shiprocket_shipment_id: shipmentId,
          awb: awbCode,
          latency_ms: latencyMs,
        },
        { source: 'api' },
      );

      return {
        success: true,
        tracking_id: awbCode,
        label_url: labelUrl,
        raw_response: { create: createData, awb: awbData, label: labelData },
        latency_ms: latencyMs,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      const parsedError = this.parseShiprocketError(0, { message: msg });
      logEvent(
        'shipping.shiprocket.create_failed',
        { order_number: req.order_number, error: msg },
        { source: 'api', severity: 'error' },
      );
      return {
        success: false,
        error: msg,
        parsed_error: parsedError,
        retry_safe: true,
        latency_ms: Date.now() - t0,
      };
    }
  }

  async trackShipment(tracking_id: string): Promise<TrackingResponse> {
    try {
      const res = await this.authedFetch(`/courier/track/awb/${encodeURIComponent(tracking_id)}`, {
        method: 'GET',
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const trackData = data['tracking_data'] as Record<string, unknown> | undefined;
      const shipmentData = trackData?.['shipment_track'] as Array<Record<string, unknown>> | undefined;
      const latest = shipmentData?.[0];
      return {
        status: (latest?.['current_status'] as string) ?? 'unknown',
        location: (latest?.['location'] as string) ?? undefined,
        timestamp: (latest?.['updated_at'] as string) ?? undefined,
        raw: data,
      };
    } catch (err) {
      return { status: 'error', raw: err };
    }
  }

  async cancelShipment(tracking_id: string): Promise<{ success: boolean }> {
    try {
      const res = await this.authedFetch('/orders/cancel/shipment/awbs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ awbs: [tracking_id] }),
      });
      return { success: res.ok };
    } catch {
      return { success: false };
    }
  }

  async generateLabel(tracking_id: string): Promise<LabelResponse> {
    try {
      const res = await this.authedFetch('/courier/generate/label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipment_id: [tracking_id] }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const url = (data['label_url'] as string) ?? '';
      return { url, raw: data };
    } catch {
      return { url: '' };
    }
  }

  async checkServiceability(pincode: string): Promise<ServiceabilityResponse> {
    try {
      const pickupPin = this.pickupPincode;
      const res = await this.authedFetch(
        `/courier/serviceability/?pickup_postcode=${pickupPin}&delivery_postcode=${pincode}&cod=1&weight=0.5`,
        { method: 'GET' },
      );
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const available = (data['data'] as Record<string, unknown> | undefined)?.['available_courier_companies'];
      const couriers = Array.isArray(available) ? available : [];
      return {
        serviceable: couriers.length > 0,
        cod_available: couriers.some((c: Record<string, unknown>) => c['cod'] === 1),
        raw: data,
      };
    } catch (err) {
      logEvent(
        'shipping.shiprocket.serviceability_failed',
        { pincode, error: err instanceof Error ? err.message : String(err) },
        { source: 'api', severity: 'error' },
      );
      return { serviceable: false, cod_available: false };
    }
  }

  private get pickupPincode(): string {
    if (!this.pickupPincodeValue) {
      throw new Error('Shiprocket: pickup pincode not configured.');
    }
    if (!/^\d{6}$/.test(this.pickupPincodeValue)) {
      throw new Error(`Shiprocket: pickup pincode "${this.pickupPincodeValue}" is invalid.`);
    }
    return this.pickupPincodeValue;
  }

  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): boolean {
    if (!this.webhookSecret) return true;

    // Support Shiprocket's `x-api-key` token header as well as HMAC `x-shiprocket-signature`
    const apiKeyHeader = headers['x-api-key'];
    const tokenStr = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
    if (tokenStr && tokenStr === this.webhookSecret) {
      return true;
    }

    const sig = headers['x-shiprocket-signature'];
    const sigStr = Array.isArray(sig) ? sig[0] : sig;
    if (!sigStr) return false;
    const expected = crypto.createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(sigStr), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  parseWebhook(body: unknown): NormalisedShipmentEvent | null {
    try {
      const payload = body as Record<string, unknown>;
      const awb =
        (payload['awb'] as string | undefined) ??
        (payload['awb_code'] as string | undefined) ??
        (payload['tracking_id'] as string | undefined);
      if (!awb) return null;

      const rawStatus =
        (payload['current_status'] as string | undefined) ??
        (payload['status'] as string | undefined) ??
        '';

      const canonical = mapShiprocketStatus(rawStatus);
      if (!canonical) return null;

      const eventType = (payload['event'] as string | undefined) ?? rawStatus;
      const timestamp =
        (payload['current_timestamp'] as string | undefined) ??
        (payload['timestamp'] as string | undefined) ??
        new Date().toISOString();

      const externalEventId = crypto
        .createHash('sha256')
        .update(`${awb}:${eventType}:${timestamp}`)
        .digest('hex');

      return {
        tracking_id: awb,
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

    if (!this.authEmail || !this.authPasswordEncrypted) {
      errors.push('Shiprocket API user email and password are required');
    }

    if (!errors.length) {
      try {
        const refreshResult = await this.refreshAuth();
        authLatency = Date.now() - t0;
        authOk = true;
        this.token = refreshResult.token;
      } catch (err) {
        authLatency = Date.now() - t0;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('401') || msg.includes('403') || msg.toLowerCase().includes('invalid')) {
          errors.push('Shiprocket login failed — verify API user email & password in /admin/shipping');
        } else {
          errors.push(`Auth failed: ${msg}`);
        }
      }
    }

    if (authOk && this.token) {
      try {
        const res = await fetch(`${this.baseUrl}/settings/company/pickup`, {
          headers: this.authHeader(),
        });
        if (res.ok) {
          apiOk = true;
          const pickupData = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          const list = ((pickupData.data as Record<string, unknown> | undefined)?.shipping_address ??
            []) as Array<{ pickup_location?: string }>;
          if (this.pickupName && Array.isArray(list) && list.length > 0) {
            const matched = list.some(
              (addr) => (addr.pickup_location || '').trim().toLowerCase() === this.pickupName.toLowerCase(),
            );
            if (!matched) {
              warnings.push(
                `Pickup "${this.pickupName}" not found in Shiprocket pickup addresses (${list.map((l) => l.pickup_location).filter(Boolean).join(', ')})`,
              );
            }
          }
        } else if (res.status === 401) {
          errors.push('Token rejected by Shiprocket API');
        } else {
          apiOk = true;
          warnings.push(`Pickup list check returned HTTP ${res.status}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`API check failed: ${msg}`);
      }
    }

    if (!this.pickupName) {
      errors.push('Pickup location name not configured');
      pickupOk = false;
    } else if (!/^\d{6}$/.test(this.pickupPincodeValue)) {
      errors.push('Valid 6-digit pickup pincode is required for Shiprocket');
      pickupOk = false;
    } else {
      pickupOk = true;
    }

    const overallSuccess = authOk && apiOk && pickupOk && errors.length === 0;

    logEvent(
      'shipping.shiprocket.connection_test',
      {
        success: overallSuccess,
        auth_ok: authOk,
        api_ok: apiOk,
        pickup_ok: pickupOk,
        latency_ms: authLatency,
        error_count: errors.length,
      },
      { source: 'system', severity: errors.length > 0 ? 'warn' : 'info' },
    );

    return {
      success: overallSuccess,
      provider: 'shiprocket',
      checks: {
        auth: {
          ok: authOk,
          latency_ms: authLatency,
          message: authOk ? 'JWT token authenticated' : errors[0] || 'Authentication failed',
        },
        api: {
          ok: apiOk,
          message: apiOk ? `Reachable: ${this.baseUrl}` : 'Shiprocket API check failed',
        },
        pickup: {
          ok: pickupOk,
          message: pickupOk
            ? `Pickup configured: "${this.pickupName}" (${this.pickupPincodeValue})`
            : 'Pickup location / pincode incomplete',
        },
      },
      errors,
      warnings,
      timestamp: new Date().toISOString(),
    };
  }
}
