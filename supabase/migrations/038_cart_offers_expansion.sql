-- ==============================================================================
-- KickoffPro — Migration 038: Advanced Cart Offers & Automated Rewards Engine
-- Extends shipping_settings with multi-rule promotional rewards:
-- 'free_shipping', 'threshold_percentage', 'buy_x_get_specific_free', 'buy_x_get_cheapest_free'
-- ==============================================================================

ALTER TABLE shipping_settings
  ADD COLUMN IF NOT EXISTS promo_reward_type   TEXT    DEFAULT 'free_shipping',
  ADD COLUMN IF NOT EXISTS reward_percentage   NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_product_id   TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS buy_x_quantity      INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS get_y_quantity      INTEGER DEFAULT 1;

COMMENT ON COLUMN shipping_settings.promo_reward_type IS 'Active reward type: free_shipping, threshold_percentage, buy_x_get_specific_free, buy_x_get_cheapest_free';
COMMENT ON COLUMN shipping_settings.reward_percentage IS 'Percentage discount when promo_reward_type is threshold_percentage';
COMMENT ON COLUMN shipping_settings.reward_product_id IS 'Target product ID to be gifted when promo_reward_type is buy_x_get_specific_free';
COMMENT ON COLUMN shipping_settings.buy_x_quantity IS 'Required item count threshold for buy X promotions';
COMMENT ON COLUMN shipping_settings.get_y_quantity IS 'Number of free items awarded in buy X get Y promotions';

