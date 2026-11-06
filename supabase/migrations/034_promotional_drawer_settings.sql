-- ==============================================================================
-- KickoffPro — Migration 034: Dynamic Promotional Drawer & Offer Settings
-- Additive only. Extends shipping_settings with marketing & promotional controls.
-- ==============================================================================

ALTER TABLE shipping_settings
  ADD COLUMN IF NOT EXISTS promo_banner_enabled          BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS promo_goal_type              TEXT    DEFAULT 'amount', -- 'amount' or 'item_count'
  ADD COLUMN IF NOT EXISTS promo_goal_threshold_paise   INTEGER DEFAULT 99900,
  ADD COLUMN IF NOT EXISTS promo_goal_item_count        INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS promo_progress_template      TEXT    DEFAULT 'Add {remaining} more to unlock FREE SHIPPING',
  ADD COLUMN IF NOT EXISTS promo_unlocked_text          TEXT    DEFAULT 'You unlocked FREE Standard Shipping!',
  ADD COLUMN IF NOT EXISTS promo_nudge_enabled          BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS promo_nudge_title            TEXT    DEFAULT 'Pay with UPI & Save {cod_fee}',
  ADD COLUMN IF NOT EXISTS promo_nudge_badge            TEXT    DEFAULT 'LOWEST PRICE',
  ADD COLUMN IF NOT EXISTS promo_nudge_text             TEXT    DEFAULT 'Instant UPI avoids the {cod_fee} COD handling charge and guarantees Priority Dispatch within 24 hours.';

