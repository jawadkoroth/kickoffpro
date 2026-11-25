-- ==============================================================================
-- Migration 044: BXGY (Buy X Get Y Free) & Item-Count Coupon Rules
-- ==============================================================================

ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_discount_type_check;
ALTER TABLE public.coupons
  ADD CONSTRAINT coupons_discount_type_check
  CHECK (discount_type IN ('percent', 'flat', 'bxgy'));

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS min_items INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buy_qty   INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS get_qty   INTEGER DEFAULT NULL;

COMMENT ON COLUMN public.coupons.min_items IS 'Minimum paid item count required to unlock percent/flat coupon (0 = no item-count gate)';
COMMENT ON COLUMN public.coupons.buy_qty IS 'BXGY: number of items to buy (e.g. 2 in Buy 2 Get 1 Free)';
COMMENT ON COLUMN public.coupons.get_qty IS 'BXGY: number of lowest-priced items made free (e.g. 1 in Buy 2 Get 1 Free)';
