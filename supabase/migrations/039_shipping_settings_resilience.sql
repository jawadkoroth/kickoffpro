-- ==============================================================================
-- KickoffPro — Migration 039: Shipping Settings Resilience & Public Read Policy
-- Additive only. Ensures storefront quote and promo calculations can read non-sensitive shipping configuration.
-- ==============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'shipping_settings' 
    AND policyname = 'Public read shipping_settings'
  ) THEN
    CREATE POLICY "Public read shipping_settings" ON shipping_settings FOR SELECT USING (true);
  END IF;
END $$;

-- Seed default singleton row if table is empty
INSERT INTO shipping_settings (
  provider_name,
  free_shipping_threshold_paise,
  default_shipping_charge_paise,
  cod_enabled,
  cod_fee_paise,
  promo_reward_type
)
SELECT 'delhivery', 99900, 9900, true, 5000, 'free_shipping'
WHERE NOT EXISTS (SELECT 1 FROM shipping_settings);

-- Grant execute permissions on shipping RPCs to authenticated role as well
DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION activate_shipping_provider(UUID) TO authenticated;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
