-- ============================================================================
-- Migration 050: Customer Self-Serve Cancel, Returns/Exchanges Workflow,
--                & Order Activity Sorting
-- ============================================================================

-- 1. Expand orders.order_status CHECK constraint to support return lifecycle
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
      'returned'
    )
  );

-- 2. Add cancellation actor/timestamp, return/exchange metadata, and activity sort timestamp
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS return_type TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS return_reason TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS return_notes TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS return_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS return_requested_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS return_resolved_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_cancelled_by_check,
  DROP CONSTRAINT IF EXISTS orders_return_type_check,
  DROP CONSTRAINT IF EXISTS orders_return_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_cancelled_by_check
    CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer', 'admin', 'system')),
  ADD CONSTRAINT orders_return_type_check
    CHECK (return_type IS NULL OR return_type IN ('refund', 'exchange')),
  ADD CONSTRAINT orders_return_status_check
    CHECK (
      return_status IS NULL OR return_status IN (
        'requested',
        'approved',
        'pickup_scheduled',
        'received',
        'completed',
        'rejected'
      )
    );

-- Backfill last_activity_at cleanly from existing timestamps
UPDATE public.orders
SET last_activity_at = GREATEST(created_at, COALESCE(return_requested_at, created_at));

CREATE INDEX IF NOT EXISTS idx_orders_last_activity
  ON public.orders (last_activity_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_returns
  ON public.orders (order_status, return_requested_at DESC)
  WHERE order_status IN ('return_requested', 'returned');
