-- ==============================================================================
-- Migration 045: Manual Coupon Only mode on shipping_settings
-- ==============================================================================

ALTER TABLE public.shipping_settings
  ADD COLUMN IF NOT EXISTS promo_manual_coupon_code TEXT DEFAULT NULL;

COMMENT ON COLUMN public.shipping_settings.promo_manual_coupon_code IS
  'When promo_reward_type is manual_coupon_only, optional specific coupon code to track in CartDrawer progress bar (NULL = auto-pick closest active manual coupon)';
