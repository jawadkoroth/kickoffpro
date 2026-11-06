-- ===================================================================
-- Migration 032: Tracking, CAPI & Ad Attribution
-- ===================================================================

-- 1. Add tracking_event_id and attribution_data columns to orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS tracking_event_id TEXT,
  ADD COLUMN IF NOT EXISTS attribution_data JSONB DEFAULT '{}'::jsonb;

-- 2. Index for deduplication lookup by tracking_event_id
CREATE INDEX IF NOT EXISTS idx_orders_tracking_event_id
  ON orders(tracking_event_id)
  WHERE tracking_event_id IS NOT NULL;

