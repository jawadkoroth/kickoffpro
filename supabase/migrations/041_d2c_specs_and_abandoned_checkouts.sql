-- ==============================================================================
-- Migration 041: D2C Product Fabric Specs & Abandoned Checkout Capture
-- ==============================================================================

-- 1. Optional structured apparel spec fields on products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS gsm        TEXT,
  ADD COLUMN IF NOT EXISTS fabric     TEXT,
  ADD COLUMN IF NOT EXISTS fit        TEXT,
  ADD COLUMN IF NOT EXISTS model_info TEXT;

COMMENT ON COLUMN public.products.gsm IS 'Optional fabric weight, e.g. "220 GSM"';
COMMENT ON COLUMN public.products.fabric IS 'Optional fabric composition, e.g. "100% Combed Cotton"';
COMMENT ON COLUMN public.products.fit IS 'Optional fit style, e.g. "Relaxed Fit"';
COMMENT ON COLUMN public.products.model_info IS 'Optional model reference, e.g. "Model is 5''10\" wearing L"';

-- 2. Abandoned Checkouts table for draft cart/contact capture
CREATE TABLE IF NOT EXISTS public.abandoned_checkouts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_key          TEXT UNIQUE NOT NULL,
  phone                TEXT,
  email                TEXT,
  customer_name        TEXT,
  items                JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal_paise       INTEGER NOT NULL DEFAULT 0,
  recovered_order_id   UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  recovery_enqueued_at TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_abandoned_checkouts_unrecovered
  ON public.abandoned_checkouts (updated_at DESC)
  WHERE recovered_order_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_abandoned_checkouts_phone
  ON public.abandoned_checkouts (phone)
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_abandoned_checkouts_email
  ON public.abandoned_checkouts (email)
  WHERE email IS NOT NULL;

-- Enable RLS (service-role + admin_users only — never publicly exposed)
ALTER TABLE public.abandoned_checkouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on abandoned_checkouts"
  ON public.abandoned_checkouts FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Admins can view abandoned_checkouts"
  ON public.abandoned_checkouts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.id = auth.uid()
    )
  );

CREATE POLICY "Admins can update abandoned_checkouts"
  ON public.abandoned_checkouts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.id = auth.uid()
    )
  );
