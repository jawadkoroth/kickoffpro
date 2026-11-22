-- =============================================
-- Migration 040: Email Broadcast Campaigns & Marketing Suppressions
-- =============================================

-- 1. Marketing Suppressions table
-- Tracks unsubscribes, spam complaints, and manual opt-outs.
CREATE TABLE IF NOT EXISTS public.marketing_suppressions (
  email citext PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT 'unsubscribed',
  source TEXT NOT NULL DEFAULT 'user_action',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_suppressions_created_at
  ON public.marketing_suppressions (created_at DESC);

-- Enable RLS
ALTER TABLE public.marketing_suppressions ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access on marketing_suppressions"
  ON public.marketing_suppressions FOR ALL
  USING (auth.role() = 'service_role');

-- Allow authenticated admins to view/manage suppressions
CREATE POLICY "Admins can view marketing_suppressions"
  ON public.marketing_suppressions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.id = auth.uid()
    )
  );

-- 2. Email Campaigns table
-- Stores metadata and delivery stats for promotional and broadcast emails.
CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  preview_text TEXT,
  body_html TEXT NOT NULL,
  cta_label TEXT,
  cta_url TEXT,
  audience_mode TEXT NOT NULL CHECK (audience_mode IN ('all', 'newsletter', 'customers')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'sending', 'sent', 'failed')),
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_created_at
  ON public.email_campaigns (created_at DESC);

-- Enable RLS
ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access on email_campaigns"
  ON public.email_campaigns FOR ALL
  USING (auth.role() = 'service_role');

-- Admins can view and create campaigns
CREATE POLICY "Admins can view email_campaigns"
  ON public.email_campaigns FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.id = auth.uid()
    )
  );

CREATE POLICY "Admins can insert email_campaigns"
  ON public.email_campaigns FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.id = auth.uid()
    )
  );

CREATE POLICY "Admins can update email_campaigns"
  ON public.email_campaigns FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.id = auth.uid()
    )
  );

-- 3. Add accepts_marketing column to orders table for audit/consent tracking
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS accepts_marketing BOOLEAN DEFAULT false;
