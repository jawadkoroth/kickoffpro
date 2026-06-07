-- =============================================
-- NOIR Ecommerce — 023b Shipping RPC permission hardening
--
-- Migration 023 created activate_shipping_provider and
-- upsert_shipment_idempotent without first revoking the Postgres
-- default PUBLIC execute grant. This means anon and authenticated
-- roles can call them directly, bypassing the admin API layer.
--
-- This migration revokes the default grant from every non-service
-- role. Only the service_role (used by server-side admin API
-- routes) retains execute permission.
--
-- Safe to re-run (REVOKE is idempotent when the grant doesn't exist).
-- =============================================

-- activate_shipping_provider
REVOKE EXECUTE ON FUNCTION activate_shipping_provider(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION activate_shipping_provider(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION activate_shipping_provider(UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION activate_shipping_provider(UUID) TO service_role;

-- upsert_shipment_idempotent
REVOKE EXECUTE ON FUNCTION upsert_shipment_idempotent(
  UUID, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, INTEGER, INTEGER, JSONB
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION upsert_shipment_idempotent(
  UUID, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, INTEGER, INTEGER, JSONB
) FROM anon;
REVOKE EXECUTE ON FUNCTION upsert_shipment_idempotent(
  UUID, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, INTEGER, INTEGER, JSONB
) FROM authenticated;
GRANT  EXECUTE ON FUNCTION upsert_shipment_idempotent(
  UUID, UUID, UUID, TEXT, INTEGER, TEXT, TEXT, INTEGER, INTEGER, JSONB
) TO service_role;
