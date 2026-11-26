-- ============================================================================
-- Migration 049: Fulfillment Hardening (Automated + Manual/India Post)
--                & Broadcast Production Hardening
-- ============================================================================

-- 1. Orders: Explicit tracking URL, shipment mode, milestone timestamps,
--    and DB-level notification idempotency guards.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tracking_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS shipment_mode TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS shipped_notified_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS delivered_notified_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS delivery_note TEXT DEFAULT NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_shipment_mode_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_shipment_mode_check
  CHECK (shipment_mode IS NULL OR shipment_mode IN ('automated', 'manual'));

CREATE INDEX IF NOT EXISTS idx_orders_shipped_notified
  ON public.orders (order_status, shipped_notified_at)
  WHERE order_status IN ('shipped', 'delivered');

-- 2. Email Campaigns: Suppressed count, cancellation timestamp, error summary,
--    and expanded audience / status values.
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS suppressed_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE public.email_campaigns
  DROP CONSTRAINT IF EXISTS email_campaigns_audience_mode_check;

ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_audience_mode_check
  CHECK (audience_mode IN ('all', 'newsletter', 'customers', 'opted_in_buyers'));

ALTER TABLE public.email_campaigns
  DROP CONSTRAINT IF EXISTS email_campaigns_status_check;

ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_status_check
  CHECK (status IN ('draft', 'queued', 'sending', 'sent', 'failed', 'cancelled'));

-- 3. Email Campaign Sends: Per-recipient idempotency & forensic delivery log.
--    Ensures chunk retries never double-send the same email for a campaign
--    and preserves exact sent/failed/suppressed counts without drift.
CREATE TABLE IF NOT EXISTS public.email_campaign_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  email citext NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'suppressed')),
  error TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, email)
);

CREATE INDEX IF NOT EXISTS idx_email_campaign_sends_campaign_status
  ON public.email_campaign_sends (campaign_id, status);

ALTER TABLE public.email_campaign_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on email_campaign_sends" ON public.email_campaign_sends;
CREATE POLICY "Service role full access on email_campaign_sends"
  ON public.email_campaign_sends FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admins can view email_campaign_sends" ON public.email_campaign_sends;
CREATE POLICY "Admins can view email_campaign_sends"
  ON public.email_campaign_sends FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.id = auth.uid()
    )
  );
