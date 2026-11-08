-- =============================================
-- KickoffPro — 036 Live Analytics & Real-Time Tracking
-- Visitor sessions, active carts tracker, and atomic heartbeat RPC
-- =============================================

CREATE TABLE IF NOT EXISTS visitor_sessions (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_address TEXT,
  country TEXT DEFAULT 'India',
  state TEXT DEFAULT 'Unknown',
  city TEXT DEFAULT 'Unknown',
  current_path TEXT DEFAULT '/',
  referrer TEXT,
  user_agent TEXT,
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS active_carts_tracker (
  session_id TEXT PRIMARY KEY REFERENCES visitor_sessions(id) ON DELETE CASCADE,
  product_count INTEGER DEFAULT 0,
  cart_total_paise BIGINT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_last_active ON visitor_sessions(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_created_at ON visitor_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_location ON visitor_sessions(country, state, city);
CREATE INDEX IF NOT EXISTS idx_active_carts_updated_at ON active_carts_tracker(updated_at DESC);

-- Enable RLS
ALTER TABLE visitor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_carts_tracker ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'visitor_sessions' AND policyname = 'Allow public heartbeat recording'
  ) THEN
    CREATE POLICY "Allow public heartbeat recording" ON visitor_sessions
      FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'active_carts_tracker' AND policyname = 'Allow public cart tracking'
  ) THEN
    CREATE POLICY "Allow public cart tracking" ON active_carts_tracker
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Atomic RPC function to record session heartbeats & cart state
CREATE OR REPLACE FUNCTION record_visitor_heartbeat(
  p_session_id TEXT,
  p_user_id UUID DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL,
  p_country TEXT DEFAULT 'India',
  p_state TEXT DEFAULT 'Unknown',
  p_city TEXT DEFAULT 'Unknown',
  p_current_path TEXT DEFAULT '/',
  p_referrer TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_product_count INTEGER DEFAULT 0,
  p_cart_total_paise BIGINT DEFAULT 0
) RETURNS VOID AS $$
BEGIN
  INSERT INTO visitor_sessions (
    id, user_id, ip_address, country, state, city, current_path, referrer, user_agent, last_active_at, created_at
  ) VALUES (
    p_session_id,
    p_user_id,
    p_ip_address,
    COALESCE(NULLIF(p_country, ''), 'India'),
    COALESCE(NULLIF(p_state, ''), 'Unknown'),
    COALESCE(NULLIF(p_city, ''), 'Unknown'),
    COALESCE(NULLIF(p_current_path, ''), '/'),
    p_referrer,
    p_user_agent,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    user_id = COALESCE(EXCLUDED.user_id, visitor_sessions.user_id),
    current_path = EXCLUDED.current_path,
    last_active_at = NOW(),
    country = CASE WHEN EXCLUDED.country <> 'Unknown' THEN EXCLUDED.country ELSE visitor_sessions.country END,
    state = CASE WHEN EXCLUDED.state <> 'Unknown' THEN EXCLUDED.state ELSE visitor_sessions.state END,
    city = CASE WHEN EXCLUDED.city <> 'Unknown' THEN EXCLUDED.city ELSE visitor_sessions.city END;

  IF p_product_count IS NOT NULL THEN
    INSERT INTO active_carts_tracker (
      session_id, product_count, cart_total_paise, updated_at
    ) VALUES (
      p_session_id,
      p_product_count,
      p_cart_total_paise,
      NOW()
    )
    ON CONFLICT (session_id) DO UPDATE SET
      product_count = EXCLUDED.product_count,
      cart_total_paise = EXCLUDED.cart_total_paise,
      updated_at = NOW();
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION record_visitor_heartbeat TO anon, authenticated, service_role;
