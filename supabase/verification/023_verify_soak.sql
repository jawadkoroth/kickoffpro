-- =============================================
-- PR 1 Soak Verification Script
-- Run each block in Supabase SQL Editor.
-- Every SELECT should return the expected value
-- described in the comment above it.
-- =============================================

-- ---------------------------------------------------------------
-- 1. TABLE + INDEX EXISTENCE
-- ---------------------------------------------------------------

-- Must return 6 rows (one per table)
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'shipping_providers',
    'shipments',
    'shipment_status_history',
    'shipping_webhook_events',
    'shipping_pricing_rules',
    'cod_rules'
  )
ORDER BY table_name;

-- Must return all indexes from migration 023
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'shipping_providers_one_active',
    'idx_shipments_order_id',
    'idx_shipments_tracking_id',
    'idx_shipments_status',
    'idx_shipments_provider_id',
    'idx_shipment_status_history_shipment_id',
    'idx_shipment_status_history_source',
    'idx_shipping_webhook_events_pending',
    'idx_shipping_webhook_events_tracking',
    'idx_shipping_webhook_events_provider'
  )
ORDER BY tablename, indexname;

-- ---------------------------------------------------------------
-- 2. BACKFILL ROW COUNTS
-- ---------------------------------------------------------------

-- Must be 1
SELECT COUNT(*) AS shipping_providers_count FROM shipping_providers;

-- Must be 1
SELECT COUNT(*) AS pricing_rules_count FROM shipping_pricing_rules;

-- Must be 1
SELECT COUNT(*) AS cod_rules_count FROM cod_rules;

-- Must equal: SELECT COUNT(*) FROM orders WHERE tracking_id IS NOT NULL
SELECT COUNT(*) AS shipments_count FROM shipments;
SELECT COUNT(*) AS orders_with_tracking FROM orders WHERE tracking_id IS NOT NULL;
-- These two numbers must match ^^^

-- Must equal shipments_count (one history row per shipment)
SELECT COUNT(*) AS history_count FROM shipment_status_history;

-- ---------------------------------------------------------------
-- 3. BACKFILL INTEGRITY — spot-check
-- ---------------------------------------------------------------

-- Providers row should carry over settings from shipping_settings
SELECT
  sp.name,
  sp.is_active,
  sp.environment,
  sp.features_cod,
  sp.pickup_city,
  sp.pickup_state,
  -- Compare against source
  ss.provider_name      AS source_name,
  ss.provider_enabled   AS source_active,
  ss.cod_enabled        AS source_cod,
  ss.pickup_city        AS source_pickup_city
FROM shipping_providers sp
CROSS JOIN shipping_settings ss
LIMIT 1;

-- Pricing rules should carry over threshold + charge
SELECT
  pr.free_shipping_threshold_paise,
  pr.default_charge_paise,
  pr.default_weight_grams,
  ss.free_shipping_threshold_paise  AS source_threshold,
  ss.default_shipping_charge_paise  AS source_charge
FROM shipping_pricing_rules pr
CROSS JOIN shipping_settings ss
LIMIT 1;

-- COD rules
SELECT
  cr.enabled,
  cr.fee_paise,
  ss.cod_enabled  AS source_enabled,
  ss.cod_fee_paise AS source_fee
FROM cod_rules cr
CROSS JOIN shipping_settings ss
LIMIT 1;

-- Shipments carry tracking_id, correct status mapping
SELECT
  s.tracking_id,
  s.status          AS shipment_status,
  o.order_status    AS order_status,
  s.created_via,
  s.provider_name,
  s.client_request_id = s.order_id AS crid_matches_order_id
FROM shipments s
JOIN orders o ON o.id = s.order_id
LIMIT 10;

-- Status mapping integrity: delivered orders → delivered shipments
SELECT
  o.order_status,
  s.status,
  CASE
    WHEN o.order_status = 'delivered' AND s.status <> 'delivered'  THEN 'MISMATCH'
    WHEN o.order_status = 'shipped'   AND s.status <> 'in_transit' THEN 'MISMATCH'
    WHEN o.order_status = 'cancelled' AND s.status <> 'cancelled'  THEN 'MISMATCH'
    ELSE 'OK'
  END AS mapping_check
FROM shipments s
JOIN orders o ON o.id = s.order_id;

-- History: every shipment has exactly one history row, source=system
SELECT
  s.id AS shipment_id,
  COUNT(h.id) AS history_rows,
  MIN(h.source) AS source,
  MIN(h.previous_status) AS prev_status,   -- should be NULL
  MIN(h.next_status) AS next_status
FROM shipments s
LEFT JOIN shipment_status_history h ON h.shipment_id = s.id
GROUP BY s.id
HAVING COUNT(h.id) <> 1;
-- Must return 0 rows (every shipment has exactly 1 history row)

-- ---------------------------------------------------------------
-- 4. ACTIVE-PROVIDER UNIQUENESS (partial unique index)
-- ---------------------------------------------------------------

-- Attempt to insert a second active provider.
-- Must FAIL with: duplicate key value violates unique constraint
-- "shipping_providers_one_active"
DO $$
BEGIN
  BEGIN
    INSERT INTO shipping_providers (name, is_active)
    VALUES ('shiprocket', TRUE);
    RAISE NOTICE 'TEST FAILED: second active provider was allowed';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'TEST PASSED: unique_violation raised as expected';
  END;
END $$;

-- Inactive insert must SUCCEED (partial index only covers is_active=TRUE)
DO $$
BEGIN
  BEGIN
    INSERT INTO shipping_providers (name, is_active)
    VALUES ('shiprocket', FALSE);
    RAISE NOTICE 'TEST PASSED: inactive provider inserted OK';
    -- Clean up
    DELETE FROM shipping_providers WHERE name = 'shiprocket';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST FAILED: %', SQLERRM;
  END;
END $$;

-- ---------------------------------------------------------------
-- 5. upsert_shipment_idempotent — duplicate protection
-- ---------------------------------------------------------------

DO $$
DECLARE
  v_test_order_id   UUID;
  v_provider_id     UUID;
  v_test_crid       UUID := gen_random_uuid();
  v_row1            shipments;
  v_row2            shipments;
BEGIN
  -- Use any existing order + provider
  SELECT id INTO v_test_order_id FROM orders LIMIT 1;
  SELECT id INTO v_provider_id   FROM shipping_providers LIMIT 1;

  IF v_test_order_id IS NULL OR v_provider_id IS NULL THEN
    RAISE NOTICE 'SKIP: no orders or providers to test against';
    RETURN;
  END IF;

  -- First call — must insert
  SELECT * INTO v_row1 FROM upsert_shipment_idempotent(
    v_test_crid, v_test_order_id, v_provider_id,
    'delhivery', 1, 'auto', 'prepaid', NULL, NULL, NULL
  );

  -- Second call with same client_request_id — must return same row, not error
  SELECT * INTO v_row2 FROM upsert_shipment_idempotent(
    v_test_crid, v_test_order_id, v_provider_id,
    'delhivery', 1, 'auto', 'prepaid', NULL, NULL, NULL
  );

  IF v_row1.id = v_row2.id THEN
    RAISE NOTICE 'TEST PASSED: same id returned on duplicate call (%)' , v_row1.id;
  ELSE
    RAISE NOTICE 'TEST FAILED: different ids returned (% vs %)', v_row1.id, v_row2.id;
  END IF;

  -- Verify only 1 row exists in shipments for this client_request_id
  PERFORM (
    SELECT COUNT(*) FROM shipments WHERE client_request_id = v_test_crid
    HAVING COUNT(*) = 1
  );
  IF FOUND THEN
    RAISE NOTICE 'TEST PASSED: exactly 1 shipments row for the crid';
  ELSE
    RAISE NOTICE 'TEST FAILED: unexpected row count for crid %', v_test_crid;
  END IF;

  -- Clean up test row
  DELETE FROM shipments WHERE client_request_id = v_test_crid;
  RAISE NOTICE 'Cleanup done';
END $$;

-- ---------------------------------------------------------------
-- 6. activate_shipping_provider — atomic switch
-- ---------------------------------------------------------------

DO $$
DECLARE
  v_delhivery_id  UUID;
  v_shiprocket_id UUID;
  v_active_count  INTEGER;
BEGIN
  SELECT id INTO v_delhivery_id FROM shipping_providers WHERE name = 'delhivery';

  -- Insert a test inactive shiprocket row
  INSERT INTO shipping_providers (name, is_active)
  VALUES ('shiprocket', FALSE)
  ON CONFLICT (name) DO NOTHING;

  SELECT id INTO v_shiprocket_id FROM shipping_providers WHERE name = 'shiprocket';

  -- Activate shiprocket
  PERFORM activate_shipping_provider(v_shiprocket_id);

  -- Must be exactly 1 active provider
  SELECT COUNT(*) INTO v_active_count
    FROM shipping_providers WHERE is_active = TRUE;

  IF v_active_count = 1 THEN
    RAISE NOTICE 'TEST PASSED: exactly 1 active provider after switch';
  ELSE
    RAISE NOTICE 'TEST FAILED: % active providers after switch', v_active_count;
  END IF;

  -- Verify it's the right one
  IF EXISTS (SELECT 1 FROM shipping_providers WHERE id = v_shiprocket_id AND is_active = TRUE) THEN
    RAISE NOTICE 'TEST PASSED: shiprocket is now active';
  ELSE
    RAISE NOTICE 'TEST FAILED: shiprocket not active after switch';
  END IF;

  -- Restore: switch delhivery back
  PERFORM activate_shipping_provider(v_delhivery_id);

  -- Clean up test shiprocket row
  DELETE FROM shipping_providers WHERE name = 'shiprocket';

  RAISE NOTICE 'Cleanup done. Delhivery restored as active.';
END $$;

-- ---------------------------------------------------------------
-- 7. APPEND-ONLY HISTORY GUARD (manual verification)
-- ---------------------------------------------------------------

-- Confirm no UPDATE or DELETE policies exist on shipment_status_history
-- (only SELECT is permitted for authenticated users; writes are service-role only)
SELECT
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'shipment_status_history'
ORDER BY cmd;
-- Expected: one SELECT policy for admins + one SELECT policy for users
-- No INSERT / UPDATE / DELETE policies listed (service-role only writes)

-- ---------------------------------------------------------------
-- 8. MIGRATION RE-RUN SAFETY (idempotency)
-- ---------------------------------------------------------------

-- Re-running any of the CREATE TABLE IF NOT EXISTS statements must be safe.
-- Simulate by re-running the backfill inserts manually:
INSERT INTO shipping_providers (name, is_active)
SELECT 'delhivery', FALSE
WHERE NOT EXISTS (SELECT 1 FROM shipping_providers WHERE name = 'delhivery');
-- Must return: INSERT 0 (row already exists, nothing inserted)

INSERT INTO shipping_pricing_rules (free_shipping_threshold_paise, default_charge_paise)
SELECT 0, 0
WHERE NOT EXISTS (SELECT 1 FROM shipping_pricing_rules);
-- Must return: INSERT 0

INSERT INTO cod_rules (enabled)
SELECT TRUE
WHERE NOT EXISTS (SELECT 1 FROM cod_rules);
-- Must return: INSERT 0

-- ---------------------------------------------------------------
-- 9. LEGACY COMPATIBILITY
-- ---------------------------------------------------------------

-- Existing orders still have their tracking/label/provider columns intact
SELECT
  id,
  order_number,
  tracking_id,
  label_url,
  shipping_provider,
  order_status
FROM orders
WHERE tracking_id IS NOT NULL
LIMIT 5;

-- shipping_settings singleton unchanged
SELECT * FROM shipping_settings;

-- ---------------------------------------------------------------
-- 10. RPC PERMISSIONS
-- ---------------------------------------------------------------

-- Both RPCs must be granted to service_role
SELECT
  routine_name,
  grantee,
  privilege_type
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND routine_name IN ('activate_shipping_provider', 'upsert_shipment_idempotent')
ORDER BY routine_name, grantee;
-- Expected: rows for service_role with EXECUTE privilege

-- =============================================
-- END OF SOAK VERIFICATION SCRIPT
-- =============================================
