-- ==============================================================================
-- Migration 042: Coupon Cart Modes & Stackability Guard
-- ==============================================================================

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS cart_mode TEXT NOT NULL DEFAULT 'manual_only'
    CHECK (cart_mode IN ('sync_auto', 'manual_with_progress', 'manual_only')),
  ADD COLUMN IF NOT EXISTS stackable_with_promo BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.coupons.cart_mode IS
  'Cart Drawer behavior: sync_auto (auto-apply with progress bar), manual_with_progress (progress bar tracks eligibility, manual click), manual_only (standard manual coupon)';
COMMENT ON COLUMN public.coupons.stackable_with_promo IS
  'When false (default), prevents double-dipping between this coupon and automated Reward Discount';
