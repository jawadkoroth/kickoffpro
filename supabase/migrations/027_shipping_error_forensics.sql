-- =============================================
-- NOIR Ecommerce — 026 Shipping Error Forensics
--
-- Add columns to shipments table for storing
-- parsed provider error details and operational
-- metadata for the admin diagnostics panel.
-- =============================================

-- Add forensic error columns to shipments table
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS parsed_error JSONB,
  ADD COLUMN IF NOT EXISTS retry_safe BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS latency_ms INTEGER,
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS operational_category TEXT,
  ADD COLUMN IF NOT EXISTS error_severity TEXT CHECK (error_severity IN ('critical', 'high', 'medium', 'low', 'info'));

-- Index for querying failed shipments by operational category
CREATE INDEX IF NOT EXISTS idx_shipments_operational_category
  ON shipments(operational_category)
  WHERE operational_category IS NOT NULL;

-- Index for retry-safe failed shipments
CREATE INDEX IF NOT EXISTS idx_shipments_retry_safe
  ON shipments(retry_safe, last_error_at)
  WHERE retry_safe = TRUE AND status = 'failed';

COMMENT ON COLUMN shipments.parsed_error IS 'NOIR: Parsed provider error with message, meaning, suggested_fix';
COMMENT ON COLUMN shipments.retry_safe IS 'NOIR: Whether this failure is safe to retry (timeouts, rate limits, server errors)';
COMMENT ON COLUMN shipments.latency_ms IS 'NOIR: Request latency in milliseconds';
COMMENT ON COLUMN shipments.last_error_at IS 'NOIR: When the last error occurred';
COMMENT ON COLUMN shipments.operational_category IS 'NOIR: Categorized error type (auth_failure, pickup_not_registered, etc.)';
COMMENT ON COLUMN shipments.error_severity IS 'NOIR: Error severity level (critical, high, medium, low, info)';

-- Update the upsert_shipment_idempotent function to include new fields
CREATE OR REPLACE FUNCTION upsert_shipment_idempotent(
  p_client_request_id  UUID,
  p_order_id           UUID,
  p_provider_id        UUID,
  p_provider_name      TEXT,
  p_attempt_number     INTEGER  DEFAULT 1,
  p_created_via        TEXT     DEFAULT 'auto',
  p_payment_method     TEXT     DEFAULT 'prepaid',
  p_cod_amount_paise   INTEGER  DEFAULT NULL,
  p_weight_grams       INTEGER  DEFAULT NULL,
  p_raw_create_response JSONB   DEFAULT NULL,
  p_parsed_error        JSONB    DEFAULT NULL,
  p_retry_safe          BOOLEAN  DEFAULT FALSE,
  p_latency_ms          INTEGER  DEFAULT NULL,
  p_operational_category TEXT  DEFAULT NULL,
  p_error_severity      TEXT     DEFAULT NULL
) RETURNS shipments
LANGUAGE plpgsql AS $$
DECLARE
  v_row shipments;
BEGIN
  INSERT INTO shipments (
    client_request_id,
    order_id,
    provider_id,
    provider_name,
    attempt_number,
    created_via,
    status,
    payment_method,
    cod_amount_paise,
    weight_grams,
    raw_create_response,
    parsed_error,
    retry_safe,
    latency_ms,
    operational_category,
    error_severity,
    last_error_at
  ) VALUES (
    p_client_request_id,
    p_order_id,
    p_provider_id,
    p_provider_name,
    p_attempt_number,
    p_created_via,
    CASE WHEN p_parsed_error IS NOT NULL THEN 'failed' ELSE 'pending' END,
    p_payment_method,
    p_cod_amount_paise,
    p_weight_grams,
    p_raw_create_response,
    p_parsed_error,
    p_retry_safe,
    p_latency_ms,
    p_operational_category,
    p_error_severity,
    CASE WHEN p_parsed_error IS NOT NULL THEN NOW() ELSE NULL END
  )
  ON CONFLICT (client_request_id) DO UPDATE SET
    raw_create_response = COALESCE(EXCLUDED.raw_create_response, shipments.raw_create_response),
    parsed_error = COALESCE(EXCLUDED.parsed_error, shipments.parsed_error),
    retry_safe = COALESCE(EXCLUDED.retry_safe, shipments.retry_safe),
    latency_ms = COALESCE(EXCLUDED.latency_ms, shipments.latency_ms),
    operational_category = COALESCE(EXCLUDED.operational_category, shipments.operational_category),
    error_severity = COALESCE(EXCLUDED.error_severity, shipments.error_severity),
    last_error_at = COALESCE(EXCLUDED.last_error_at, shipments.last_error_at),
    status = CASE WHEN EXCLUDED.parsed_error IS NOT NULL THEN 'failed' ELSE shipments.status END,
    updated_at = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION upsert_shipment_idempotent(
  UUID, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, INTEGER, INTEGER, JSONB,
  JSONB, BOOLEAN, INTEGER, TEXT, TEXT
) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION upsert_shipment_idempotent(
  UUID, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, INTEGER, INTEGER, JSONB,
  JSONB, BOOLEAN, INTEGER, TEXT, TEXT
) TO service_role;

-- End of migration 026

