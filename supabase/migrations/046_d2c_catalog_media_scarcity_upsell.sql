-- ==============================================================================
-- Migration 046: D2C Apparel Categories/Varieties, Videos, Size Scarcity & Upsells
-- ==============================================================================

-- 1. Products: scalable D2C apparel taxonomy, media videos, and curated upsell flag
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS variety         TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS attributes      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS videos          JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_cart_upsell  BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.variety IS 'Sub-category or silhouette under main category (e.g. Half Sleeve, Oversize, Muscle Fit, Joggers)';
COMMENT ON COLUMN public.products.attributes IS 'Extensible key-value apparel metadata JSONB for filtering and scaling';
COMMENT ON COLUMN public.products.videos IS 'Array of product video URLs or { url, poster } objects rendered on PDP';
COMMENT ON COLUMN public.products.is_cart_upsell IS 'When true, prioritized in CartDrawer "Complete Your Rotation" upsell section';

CREATE INDEX IF NOT EXISTS idx_products_category_variety
  ON public.products(category, variety)
  WHERE is_active = true AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_cart_upsell
  ON public.products(created_at DESC)
  WHERE is_cart_upsell = true AND is_active = true AND archived_at IS NULL;

-- 2. Inventory: explicit per-size low-stock scarcity alert flag
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS low_stock_alert BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.inventory.low_stock_alert IS 'Admin toggle to display low-stock urgency ("Only a few left in <SIZE>") on PDP';
