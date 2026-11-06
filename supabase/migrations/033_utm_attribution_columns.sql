-- ===================================================================
-- Migration 033: UTM Attribution Columns
-- ===================================================================

-- 1. Dedicated indexed columns for fast campaign reporting & aggregation
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_utm_source
  ON orders(utm_source)
  WHERE utm_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_utm_campaign
  ON orders(utm_source, utm_medium, utm_campaign)
  WHERE utm_source IS NOT NULL;

