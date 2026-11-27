-- Migration 055: End-to-end automated shipment tracking columns & idempotent stock-restore guard

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipment_status TEXT,
  ADD COLUMN IF NOT EXISTS tracking_events JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_tracking_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estimated_delivery_date TEXT,
  ADD COLUMN IF NOT EXISTS stock_restored_at TIMESTAMPTZ;

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS tracking_events JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_tracking_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estimated_delivery_date TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_active_automated_tracking
  ON public.orders (order_status, shipment_mode, last_tracking_sync_at)
  WHERE order_status = 'shipped' AND shipment_mode = 'automated';
