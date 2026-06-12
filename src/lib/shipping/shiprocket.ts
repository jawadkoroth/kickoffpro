/**
 * KickoffPro — Shiprocket provider adapter.
 *
 * Auth model: JWT session token obtained via /auth/login.
 * Tokens expire after 24h. refreshAuth() obtains a new token
 * and the registry persists it back to shipping_providers.token.
 *
 * All methods emit logEvent() calls for operational observability.
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

/* ─── Shiprocket status → canonical ──────────────────────────────── */
export function mapShiprocketStatus(rawStatus: string): import('./state').CanonicalShipmentStatus | null {
  const s = rawStatus?.toUpperCase?.() ?? '';
  if (['DELIVERED'].includes(s)) return 'delivered';
  if (['OUT FOR DELIVERY', 'OFD'].includes(s)) return 'out_for_delivery';
  if (['IN TRANSIT', 'PICKED UP AND IN TRANSIT'].includes(s)) return 'in_transit';
  if (['PICKUP SCHEDULED', 'PICKUP GENERATED', 'PICKED UP'].includes(s)) return 'picked_up';
  if (['SHIPMENT CREATED', 'AWB ASSIGNED', 'LABEL GENERATED'].includes(s)) return 'shipment_created';
  if (['RTO INITIATED', 'RTO IN TRANSIT', 'RTO DELIVERED', 'RETURNED'].includes(s)) return 'returned';
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

  constructor(config: ProviderConfig) {
    this.baseUrl = config.api_url ?? 'https://apiv2.shiprocket.in/v1/external';
    this.authEmail = config.auth_email ?? null;
    this.authPasswordEncrypted = config.auth_password_encrypted ?? null;
    this.webhookSecret = config.webhook_secret ?? null;
    this.pickupName = config.pickup_name ?? '';
    this.pickupPincodeValue = config.pickup_pincode ?? '';
    this.token = config.token ?? null;
  }

  private authHeader(): Record<string, string> {
    if (!this.token) throw new Error('Shiprocket: no token — call refreshAuth() first');
    return { Authorization: `Bearer ${this.token}` };
  }

  /**
   * KickoffPro — Shiprocket Error Forensics
   * Parses Shiprocket API errors into actionable diagnostics.
   */
  private parseShiprocketError(status: number, data: Record<string, unknown>): ParsedProviderError {
    const base: Omit<ParsedProviderError, 'message'> = {
      provider: 'shiprocket',
      status_code: status,
      raw: data,
      retry_safe: false,
      operational_category: 'unknown',
      severity: 'high',
    };

    const message = (data.message ?? data.error ?? JSON.stringify(data)) as string;
    const errorStr = message.toLowerCase();

    // 401 Unauthorized — JWT token issues
    if (status === 401) {
      return {
        ...base,
        message: 'JWT token invalid or expired',
        meaning: 'The Shiprocket JWT token has expired or is invalid.',
        suggested_fix: 'Token will auto-refresh on next API call. If persists, re-authenticate in settings.',
        severity: 'critical',
        operational_category: 'auth_failure',
        retry_safe: true,
      };
    }

    // 403 Forbidden
    if (status === 403) {
      return {
        ...base,
        message: 'API access denied',
        meaning: 'Your account does not have permission for this operation.',
        suggested_fix: 'Check Shiprocket account permissions. Upgrade plan if needed.',
        severity: 'critical',
        operational_category: 'auth_failure',
      };
    }

    // 422 — Validation errors
    if (status === 422) {
      // Pickup location issues
      if (errorStr.includes('pickup') || errorStr.includes('warehouse')) {
        return {
          ...base,
          message: 'Pickup location not found',
          meaning: 'The configured pickup location does not exist in Shiprocket.',
          suggested_fix: 'Shiprocket Dashboard → Settings → Pickup Locations → Add warehouse with matching name.',
          severity: 'high',
          operational_category: 'pickup_not_registered',
        };
      }

      // Phone issues
      if (errorStr.includes('phone') || errorStr.includes('mobile')) {
        return {
          ...base,
          message: 'Customer phone invalid',
          meaning: 'Customer phone number is missing or invalid format.',
          suggested_fix: 'Update customer information with valid 10-digit phone number.',
          severity: 'medium',
          operational_category: 'phone_missing',
        };
      }

      // Address/pincode issues
      if (errorStr.includes('pincode') || errorStr.includes('address')) {
        return {
          ...base,
          message: 'Delivery address invalid',
          meaning: 'Pincode is invalid or not serviceable.',
          suggested_fix: 'Verify pincode is valid 6-digit code. Check serviceability in Shiprocket.',
          severity: 'medium',
          operational_category: 'address_invalid',
        };
      }

      // Weight issues
      if (errorStr.includes('weight')) {
        return {
          ...base,
          message: 'Product weight invalid',
          meaning: 'Weight is missing or exceeds limits.',
          suggested_fix: 'Add valid weight_grams to product (max 50000g for most couriers).',
          severity: 'medium',
          operational_category: 'weight_missing',
        };
      }

      // COD issues
      if (errorStr.includes('cod')) {
        return {
          ...base,
          message: 'COD not available',
          meaning: 'Cash on Delivery is not available for this destination.',
          suggested_fix: 'Check serviceability for COD. May need to switch to prepaid.',
          severity: 'medium',
          operational_category: 'cod_not_available',
        };
      }

      // Generic validation error
      return {
        ...base,
        message: message || 'Invalid order data',
        meaning: 'The order payload failed Shiprocket validation.',
        suggested_fix: 'Check all required fields: customer name, phone, complete address, product details.',
        severity: 'medium',
        operational_category: 'invalid_payload',
      };
    }

    // 429 — Rate limiting
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

    // 500+ Server errors
    if (status >= 500) {
      return {
        ...base,
        message: 'Shiprocket server error',
        meaning: 'Shiprocket API is experiencing issues.',
        suggested_fix: 'Retry in 2-3 minutes. Check Shiprocket status if persists.',
        severity: 'high',
        operational_category: 'service_unavailable',
        retry_safe: true,
      };
    }

    // Network/timeout errors
    if (status === 0 || status === -1) {
      return {
        ...base,
        message: 'Network timeout',
        meaning: 'Request to Shiprocket API timed out.',
        suggested_fix: 'Retry shipment creation. Check network connectivity.',
        severity: 'medium',
        operational_category: 'timeout',
        retry_safe: true,
      };
    }

    // Fallback
    return {
      ...base,
      message: message || `HTTP ${status}`,
      meaning: 'An unexpected error occurred.',
      suggested_fix: 'Check error details and contact support if issue persists.',
      severity: 'high',
      operational_category: 'unknown',
    };
  }

  /**
   * KickoffPro: Pre-flight validation for shipment creation.
   */
  validateShipmentRequest(req: ShipmentRequest): ParsedProviderError | null {
    // Customer phone required
    if (!req.customer.phone || req.customer.phone.length < 10) {
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

    // Address validation
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

    // Pincode format
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

    // Product weight required
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

    // Pickup location configured
    if (!this.pickupName) {
      return {
        provider: 'shiprocket',
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

    // Pickup pincode configured
    if (!this.pickupPincodeValue) {
      return {
        provider: 'shiprocket',
        status_code: 0,
        message: 'Pickup pincode not configured',
        meaning: 'No pickup pincode is configured in provider settings.',
        suggested_fix: 'Configure pickup pincode in Admin → Shipping → Provider settings.',
        retry_safe: false,
        operational_category: 'pickup_not_registered',
        severity: 'high',
        raw: null,
      };
    }

    if (!/^\d{6}$/.test(this.pickupPincodeValue)) {
      return {
        provider: 'shiprocket',
        status_code: 0,
        message: 'Invalid pickup pincode format',
        meaning: 'The configured pickup pincode is invalid.',
        suggested_fix: 'Configure a valid 6-digit pickup pincode in Admin → Shipping → Provider settings.',
        retry_safe: false,
        operational_category: 'pickup_not_registered',
        severity: 'high',
        raw: { pickup_pincode: this.pickupPincodeValue },
      };
    }

    // Auth token available
    if (!this.token) {
      return {
        provider: 'shiprocket',
        status_code: 0,
        message: 'Authentication token missing',
        meaning: 'Shiprocket JWT token is not available.',
        suggested_fix: 'Run TEST CONNECTION to authenticate with Shiprocket.',
        retry_safe: true,
        operational_category: 'auth_failure',
        severity: 'critical',
        raw: null,
      };
    }

    return null; // All validations passed
  }

  async refreshAuth(): Promise<TokenRefreshResult> {
    if (!this.authEmail || !this.authPasswordEncrypted) {
      throw new Error('Shiprocket: auth credentials not configured');
    }
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.authEmail, password: this.authPasswordEncrypted }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!data.token) throw new Error(`Shiprocket login failed: ${JSON.stringify(data)}`);
    const token = data.token as string;
    const expiresAt = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
    this.token = token;
    logEvent('shipping.shiprocket.token_refreshed', { expires_at: expiresAt }, { source: 'system' });
    return { token, expires_at: expiresAt };
  }

  async createShipment(req: ShipmentRequest): Promise<ShipmentResponse> {
    try {
      const t0 = Date.now();
      const payload = {
        order_id: req.order_number,
        order_date: new Date().toISOString().split('T')[0],
        pickup_location: this.pickupName,
        billing_customer_name: req.customer.name,
        billing_last_name: '',
        billing_address: req.address.line1,
        billing_address_2: req.address.line2 ?? '',
        billing_city: req.address.city,
        billing_pincode: req.address.pincode,
        billing_state: req.address.state,
        billing_country: 'India',
        billing_email: req.customer.email ?? '',
        billing_phone: req.customer.phone,
        shipping_is_billing: 1,
        order_items: [{
          name: req.product.name,
          sku: req.order_number,
          units: req.product.quantity,
          selling_price: (req.payment.cod_amount_paise ?? 0) / 100,
          discount: 0,
          tax: 0,
          hsn: '',
        }],
        payment_method: req.payment.method === 'cod' ? 'COD' : 'Prepaid',
        sub_total: (req.payment.cod_amount_paise ?? 0) / 100,
        length: 15, breadth: 12, height: 5,
        weight: req.product.weight_grams / 1000,
      };

      const res = await fetch(`${this.baseUrl}/orders/create/adhoc`, {
        method: 'POST',
        headers: { ...this.authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const latencyMs = Date.now() - t0;
      const data = await res.json() as Record<string, unknown>;

      logEvent('shipping.shiprocket.create_shipment', {
        order_number: req.order_number, status_code: res.status, latency_ms: latencyMs,
      }, { source: 'api' });

      if (res.ok && data.shipment_id) {
        const awb = (data.payload as Record<string, unknown>)?.awb_code as string | undefined;
        return { success: true, tracking_id: awb, raw_response: data };
      }
      logEvent('shipping.shiprocket.create_failed', { order_number: req.order_number, error: data.message }, { source: 'api', severity: 'error' });
      return { success: false, error: (data.message as string) ?? 'Shipment creation failed', raw_response: data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      logEvent('shipping.shiprocket.create_failed', { order_number: req.order_number, error: msg }, { source: 'api', severity: 'error' });
      return { success: false, error: msg };
    }
  }

  async trackShipment(tracking_id: string): Promise<TrackingResponse> {
    try {
      const res = await fetch(`${this.baseUrl}/courier/track/awb/${tracking_id}`, { headers: this.authHeader() });
      const data = await res.json() as Record<string, unknown>;
      const trackData = (data['tracking_data'] as Record<string, unknown> | undefined);
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
      const res = await fetch(`${this.baseUrl}/orders/cancel`, {
        method: 'POST',
        headers: { ...this.authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ awbs: [tracking_id] }),
      });
      return { success: res.ok };
    } catch {
      return { success: false };
    }
  }

  async generateLabel(tracking_id: string): Promise<LabelResponse> {
    try {
      const res = await fetch(`${this.baseUrl}/courier/generate/label`, {
        method: 'POST',
        headers: { ...this.authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipment_id: [tracking_id] }),
      });
      const data = await res.json() as Record<string, unknown>;
      const url = (data['label_url'] as string) ?? '';
      return { url, raw: data };
    } catch {
      return { url: '' };
    }
  }

  async checkServiceability(pincode: string): Promise<ServiceabilityResponse> {
    try {
      const pickupPin = this.pickupPincode;
      const res = await fetch(
        `${this.baseUrl}/courier/serviceability/?pickup_postcode=${pickupPin}&delivery_postcode=${pincode}&cod=1&weight=0.5`,
        { headers: this.authHeader() },
      );
      const data = await res.json() as Record<string, unknown>;
      const available = (data['data'] as Record<string, unknown> | undefined)?.['available_courier_companies'];
      const couriers = Array.isArray(available) ? available : [];
      return {
        serviceable: couriers.length > 0,
        cod_available: couriers.some((c: Record<string, unknown>) => c['cod'] === 1),
        raw: data,
      };
    } catch (err) {
      console.error('[SHIPROCKET_SERVICEABILITY_ERROR]', err);
      logEvent('shipping.shiprocket.serviceability_failed', {
        pincode,
        error: err instanceof Error ? err.message : String(err),
      }, { source: 'api', severity: 'error' });
      return { serviceable: false, cod_available: false };
    }
  }

  private get pickupPincode(): string {
    if (!this.pickupPincodeValue) {
      throw new Error(
        'Shiprocket: pickup pincode not configured. ' +
        'Configure pickup_pincode in Admin -> Shipping -> Provider settings.'
      );
    }
    if (!/^\d{6}$/.test(this.pickupPincodeValue)) {
      throw new Error(
        `Shiprocket: pickup pincode "${this.pickupPincodeValue}" is invalid (must be 6 digits).`
      );
    }
    return this.pickupPincodeValue;
  }

  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): boolean {
    if (!this.webhookSecret) return true;
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
        (payload['status'] as string | undefined) ?? '';

      const canonical = mapShiprocketStatus(rawStatus);
      if (!canonical) return null;

      const eventType = (payload['event'] as string | undefined) ?? rawStatus;
      const timestamp = (payload['timestamp'] as string | undefined) ?? new Date().toISOString();

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

    // 1. Check credentials configured
    if (!this.authEmail || !this.authPasswordEncrypted) {
      errors.push('Shiprocket credentials not configured — set email and password');
    }

    // 2. Try to refresh/auth and get a valid token
    if (!errors.length) {
      try {
        const refreshResult = await this.refreshAuth();
        authLatency = Date.now() - t0;
        authOk = true;
        this.token = refreshResult.token;
        logEvent('shipping.shiprocket.connection_test_auth_ok', {
          token_expires: refreshResult.expires_at,
          latency_ms: authLatency,
        }, { source: 'system' });
      } catch (err) {
        authLatency = Date.now() - t0;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('login failed') || msg.includes('401')) {
          errors.push('Login failed — check email/password in settings');
        } else if (msg.includes('fetch') || msg.includes('network')) {
          errors.push('Cannot reach Shiprocket API — check network/firewall');
        } else {
          errors.push(`Auth failed: ${msg}`);
        }
      }
    }

    // 3. Test API with token — try to fetch courier companies list
    if (authOk && this.token) {
      try {
        const res = await fetch(`${this.baseUrl}/courier/courier-companies`, {
          headers: this.authHeader(),
        });
        if (res.ok) {
          apiOk = true;
        } else if (res.status === 401) {
          errors.push('Token rejected — may have expired');
        } else {
          errors.push(`API returned ${res.status}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`API check failed: ${msg}`);
      }
    }

    // 4. Pickup location check
    if (!this.pickupName || this.pickupName.trim().length === 0) {
      errors.push('Pickup location name not configured');
      pickupOk = false;
    } else {
      pickupOk = true;
    }

    logEvent('shipping.shiprocket.connection_test', {
      success: authOk && apiOk && pickupOk,
      auth_ok: authOk,
      api_ok: apiOk,
      pickup_ok: pickupOk,
      latency_ms: authLatency,
      error_count: errors.length,
    }, { source: 'system', severity: errors.length > 0 ? 'warn' : 'info' });

    return {
      success: authOk && apiOk && pickupOk,
      provider: 'shiprocket',
      checks: {
        auth: { ok: authOk, latency_ms: authLatency, message: authOk ? 'JWT token valid' : errors.find(e => e.includes('email') || e.includes('password')) },
        api: { ok: apiOk, message: apiOk ? 'API accessible' : errors.find(e => e.includes('Token') || e.includes('API')) },
        pickup: { ok: pickupOk, message: pickupOk ? `Pickup name: ${this.pickupName}` : 'Pickup name not configured' },
      },
      errors,
      warnings,
      timestamp: new Date().toISOString(),
    };
  }
}
