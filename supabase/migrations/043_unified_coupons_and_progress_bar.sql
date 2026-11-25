-- ==============================================================================
-- Migration 043: Unified Coupons & Magic Cart Progress Bar Control
-- ==============================================================================

-- 1. Support Flat ₹ or Percentage % coupons cleanly
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS discount_type TEXT NOT NULL DEFAULT 'percent'
    CHECK (discount_type IN ('percent', 'flat')),
  ADD COLUMN IF NOT EXISTS discount_paise INTEGER DEFAULT NULL;

-- Relax discount_percent check so flat coupons can store 0 or 1+ without failing
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_discount_percent_check;
ALTER TABLE public.coupons
  ADD CONSTRAINT coupons_discount_percent_check
  CHECK (discount_percent >= 0 AND discount_percent <= 100);

-- 2. Master Magic Cart Progress Bar mode on shipping_settings (controlled via /admin/coupons)
ALTER TABLE public.shipping_settings
  ADD COLUMN IF NOT EXISTS magic_cart_mode TEXT NOT NULL DEFAULT 'free_shipping'
    CHECK (magic_cart_mode IN ('off', 'free_shipping', 'coupon_goal'));

-- Clear legacy promo_reward_type overrides so /admin/coupons is the single source of truth
UPDATE public.shipping_settings
SET promo_reward_type = 'free_shipping',
    magic_cart_mode = CASE
      WHEN promo_banner_enabled = false THEN 'off'
      ELSE 'free_shipping'
    END
WHERE promo_reward_type IS DISTINCT FROM 'free_shipping';
