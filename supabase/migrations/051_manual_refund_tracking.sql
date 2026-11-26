-- ============================================================================
-- Migration 051: Manual Razorpay Refund Tracking
-- ============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS refund_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS refund_reference TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_refund_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_refund_status_check
  CHECK (refund_status IN ('none', 'pending', 'completed'));

-- Backfill completed refunds
UPDATE public.orders
SET
  refund_status = 'completed',
  refunded_at = COALESCE(refunded_at, updated_at)
WHERE payment_status = 'refunded'
  AND refund_status = 'none';

-- Backfill cancelled prepaid orders awaiting manual Razorpay refund
UPDATE public.orders
SET refund_status = 'pending'
WHERE order_status = 'cancelled'
  AND payment_status = 'paid'
  AND refund_status = 'none';

CREATE INDEX IF NOT EXISTS idx_orders_refund_pending
  ON public.orders (refund_status, last_activity_at DESC)
  WHERE refund_status = 'pending';
