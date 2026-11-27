-- Migration 056: Product color swatches and style-group colorway linking

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS style_group TEXT,
  ADD COLUMN IF NOT EXISTS color_name TEXT,
  ADD COLUMN IF NOT EXISTS color_hex TEXT,
  ADD COLUMN IF NOT EXISTS color_secondary_hex TEXT;

CREATE INDEX IF NOT EXISTS idx_products_active_style_group
  ON public.products (style_group)
  WHERE style_group IS NOT NULL AND is_active = true;
