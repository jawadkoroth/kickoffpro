-- ============================================================================
-- Migration 054: Add Shiprocket API User credentials & webhook secret
--                to shipping_settings so /admin/shipping syncs cleanly
--                into shipping_providers for end-to-end Shiprocket support.
-- ============================================================================

ALTER TABLE public.shipping_settings
  ADD COLUMN IF NOT EXISTS auth_email TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auth_password TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT DEFAULT NULL;
