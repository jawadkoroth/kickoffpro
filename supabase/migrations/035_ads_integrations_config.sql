-- =============================================
-- KickoffPro — 035 Ads & CAPI Integrations Configuration
-- Additive only; idempotent; RLS restricted to admin_users.
-- =============================================

CREATE TABLE IF NOT EXISTS ads_integrations_config (
  id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,

  -- Meta Ads & Conversions API (CAPI)
  meta_pixel_id TEXT,
  meta_access_token TEXT,
  meta_test_event_code TEXT,
  meta_enabled BOOLEAN DEFAULT TRUE,

  -- Google Ads & GA4 Enhanced Conversions
  google_tag_id TEXT,
  google_api_secret TEXT,
  google_enabled BOOLEAN DEFAULT TRUE,

  -- Snapchat Ads & Conversions API (CAPI)
  snapchat_pixel_id TEXT,
  snapchat_api_token TEXT,
  snapchat_enabled BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE ads_integrations_config ENABLE ROW LEVEL SECURITY;

-- Allow only authenticated admin users to read or write
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ads_integrations_config' AND policyname = 'Admin manage ads config'
  ) THEN
    CREATE POLICY "Admin manage ads config" ON ads_integrations_config FOR ALL
      USING (auth.uid() IN (SELECT id FROM admin_users))
      WITH CHECK (auth.uid() IN (SELECT id FROM admin_users));
  END IF;
END $$;

-- Seed singleton configuration row
INSERT INTO ads_integrations_config (id)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid)
ON CONFLICT (id) DO NOTHING;

