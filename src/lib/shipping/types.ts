export interface ShipmentRequest {
  order_number: string;
  customer: { name: string; phone: string; email?: string };
  address: { line1: string; line2?: string; city: string; state: string; pincode: string };
  product: { name: string; quantity: number; weight_grams: number };
  payment: { method: 'cod' | 'prepaid'; cod_amount_paise?: number };
}

export interface ShipmentResponse {
  success: boolean;
  tracking_id?: string;
  label_url?: string;
  error?: string;
  raw_response?: unknown;
  /** KickoffPro: Parsed forensic error with actionable diagnostics */
  parsed_error?: ParsedProviderError;
  /** KickoffPro: Whether this failure is safe to retry */
  retry_safe?: boolean;
  /** KickoffPro: Request latency in milliseconds */
  latency_ms?: number;
}

export interface TrackingResponse {
  status: string;
  location?: string;
  timestamp?: string;
  raw?: unknown;
}

export interface ServiceabilityResponse {
  serviceable: boolean;
  cod_available: boolean;
  raw?: unknown;
}

export interface LabelResponse {
  url: string;
  raw?: unknown;
}

/**
 * Canonical normalised event emitted by parseWebhook().
 * Provider-specific status strings are mapped into CanonicalShipmentStatus
 * before this struct is constructed — business logic never sees raw provider states.
 */
export interface NormalisedShipmentEvent {
  tracking_id: string;
  canonical_status: import('./state').CanonicalShipmentStatus;
  provider_event_type: string;
  /** Provider's own event timestamp (may differ from received_at). */
  provider_event_at?: string;
  /** Stable dedup key: used as external_event_id in shipping_webhook_events. */
  external_event_id: string;
  raw: unknown;
}

/**
 * Typed config row from shipping_providers table.
 * Passed to provider constructors by the registry.
 */
export interface ProviderConfig {
  id: string;
  name: string;
  environment: 'sandbox' | 'live';
  api_url: string | null;
  api_key: string | null;
  api_secret: string | null;
  webhook_secret: string | null;
  token: string | null;
  token_expires_at: string | null;
  auth_email: string | null;
  auth_password_encrypted: string | null;
  pickup_name: string | null;
  pickup_phone: string | null;
  pickup_gstin: string | null;
  pickup_line1: string | null;
  pickup_line2: string | null;
  pickup_city: string | null;
  pickup_state: string | null;
  pickup_pincode: string | null;
  features_cod: boolean;
  features_reverse: boolean;
  features_insurance: boolean;
}

export interface TokenRefreshResult {
  token: string;
  expires_at: string;
}

/**
 * Result from testConnection() — structured diagnostics for operational visibility.
 */
export interface ConnectionTestResult {
  success: boolean;
  provider: 'delhivery' | 'shiprocket';
  checks: {
    auth: { ok: boolean; latency_ms: number; message?: string };
    api: { ok: boolean; message?: string };
    pickup: { ok: boolean; message?: string };
  };
  errors: string[];
  warnings: string[];
  timestamp: string;
}

/**
 * KickoffPro — Normalized provider error with forensic diagnostics.
 * Every shipping failure produces actionable intelligence.
 */
export interface ParsedProviderError {
  provider: 'delhivery' | 'shiprocket';
  status_code: number;
  message: string;
  meaning?: string;
  suggested_fix?: string;
  retry_safe: boolean;
  operational_category:
  | 'auth_failure'
  | 'invalid_pickup'
  | 'invalid_payload'
  | 'network_error'
  | 'rate_limit'
  | 'service_unavailable'
  | 'pickup_not_registered'
  | 'address_invalid'
  | 'phone_missing'
  | 'weight_missing'
  | 'cod_not_available'
  | 'timeout'
  | 'unknown';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  raw: unknown;
}

export interface ShippingProvider {
  readonly providerName: 'delhivery' | 'shiprocket';

  createShipment(req: ShipmentRequest): Promise<ShipmentResponse>;
  trackShipment(tracking_id: string): Promise<TrackingResponse>;
  cancelShipment(tracking_id: string): Promise<{ success: boolean }>;

  /** Generate/fetch label URL for an already-created shipment. */
  generateLabel(tracking_id: string): Promise<LabelResponse>;

  /** Check if a destination pincode is serviceable (and COD available). */
  checkServiceability(pincode: string): Promise<ServiceabilityResponse>;

  /**
   * Verify the webhook signature from inbound provider request.
   * Returns true if signature is valid (or provider doesn't sign — then
   * callers must fall back to IP allowlist verification).
   */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean;

  /**
   * Parse a raw provider webhook body into a canonical event.
   * Returns null if the payload is not a shipment status event
   * (e.g. a provider heartbeat or unknown event type).
   */
  parseWebhook(body: unknown): NormalisedShipmentEvent | null;

  /**
   * Refresh the provider auth token.
   * Optional — Delhivery uses static API keys and does not implement this.
   * Shiprocket (PR 4) and future session-token providers implement it.
   */
  refreshAuth?(): Promise<TokenRefreshResult>;

  /**
   * Test connection to provider API and validate configuration.
   * Returns structured diagnostics for the admin diagnostics panel.
   */
  testConnection(): Promise<ConnectionTestResult>;

  /**
   * KickoffPro: Pre-flight validation for shipment creation.
   * Validates all prerequisites before calling provider API.
   * Returns null if valid, or ParsedProviderError with actionable diagnostics.
   */
  validateShipmentRequest(req: ShipmentRequest): ParsedProviderError | null;
}
