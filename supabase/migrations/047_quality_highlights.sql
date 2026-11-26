-- ==============================================================================
-- Migration 047: Below-the-Fold Quality & Fabric Showcase Rows on Products
-- ==============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS quality_highlights JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.products.quality_highlights IS
  'Structured array of { badge, title, subtitle, image } rows displayed below the fold on PDP';
