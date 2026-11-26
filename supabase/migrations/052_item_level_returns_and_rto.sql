-- ============================================================================
-- Migration 052: Item-Level Returns/Exchanges, Estimated Refund,
--                COD Paid Timestamp, and RTO (Return to Origin)
-- ============================================================================

-- 1. Expand orders.order_status CHECK constraint to support 'rto'
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%order_status%'
  LOOP
    EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_order_status_check
  CHECK (
    order_status IN (
      'pending',
      'confirmed',
      'shipped',
      'delivered',
      'cancelled',
      'return_requested',
      'returned',
      'rto'
    )
  );

-- 2. Add item-level return payload, estimated refund, COD settlement & RTO columns
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS return_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS estimated_refund_paise INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rto_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rto_reason TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rto_notified_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cod_paid_at TIMESTAMPTZ DEFAULT NULL;

UPDATE public.orders
SET cod_paid_at = updated_at
WHERE payment_method = 'cod'
  AND payment_status = 'paid'
  AND cod_paid_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_rto
  ON public.orders (order_status, rto_at DESC)
  WHERE order_status = 'rto';
