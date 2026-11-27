-- ============================================================================
-- Migration 053: Fix ambiguous upsert_shipment_idempotent overload &
--                recover orders stuck as 'shipped' with NULL tracking_id
-- ============================================================================

-- 1. Drop the stale 10-argument overload from migration 023 so Postgres /
--    PostgREST unambiguously resolves the 15-argument function from migration 027.
DROP FUNCTION IF EXISTS public.upsert_shipment_idempotent(
  UUID, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, INTEGER, INTEGER, JSONB
);

-- 2. Re-confirm permissions on the remaining 15-argument signature
REVOKE ALL ON FUNCTION public.upsert_shipment_idempotent(
  UUID, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, INTEGER, INTEGER, JSONB,
  JSONB, BOOLEAN, INTEGER, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.upsert_shipment_idempotent(
  UUID, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, INTEGER, INTEGER, JSONB,
  JSONB, BOOLEAN, INTEGER, TEXT, TEXT
) TO service_role;

-- 3. Recover any automated shipments that were falsely marked 'shipped'
--    with NULL tracking_id due to Delhivery HTTP-200 failure false positive.
UPDATE public.orders
SET
  order_status = 'confirmed',
  shipment_mode = NULL,
  shipped_at = NULL,
  shipping_provider = NULL,
  updated_at = NOW()
WHERE order_status = 'shipped'
  AND (tracking_id IS NULL OR BTRIM(tracking_id) = '')
  AND (shipment_mode = 'automated' OR shipment_mode IS NULL);
