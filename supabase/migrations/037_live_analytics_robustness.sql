-- =============================================
-- KickoffPro — 037 Live Analytics Robustness
-- Relax user_id FK constraint, grant permissions, and add Postgres-native snapshot function
-- =============================================

-- 1. Drop foreign key constraint on visitor_sessions.user_id if present
-- Telemetry/presence tables must never fail or reject heartbeats due to foreign key checks
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'visitor_sessions'
      AND constraint_name = 'visitor_sessions_user_id_fkey'
  ) THEN
    ALTER TABLE visitor_sessions DROP CONSTRAINT visitor_sessions_user_id_fkey;
  END IF;
END $$;

-- 2. Ensure user_id column allows null
ALTER TABLE visitor_sessions ALTER COLUMN user_id DROP NOT NULL;

-- 3. Explicit table grants for public/anon/authenticated roles
GRANT ALL ON TABLE visitor_sessions TO anon, authenticated, service_role;
GRANT ALL ON TABLE active_carts_tracker TO anon, authenticated, service_role;

-- 4. Re-declare record_visitor_heartbeat to guarantee resilient upsert without foreign key traps
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

-- 5. Native Postgres snapshot function using NOW() and Indian Standard Time (IST)
CREATE OR REPLACE FUNCTION get_live_analytics_snapshot()
RETURNS JSON AS $$
DECLARE
  v_visitors_right_now INT;
  v_visitors_last_15m INT;
  v_sessions_today INT;
  v_sessions_yesterday INT;
  v_active_carts_count INT;
  v_active_carts_total_paise BIGINT;
  v_checking_out_count INT;
  v_orders_today_count INT;
  v_orders_today_revenue_paise BIGINT;
  v_today_start_ist TIMESTAMPTZ;
  v_yesterday_start_ist TIMESTAMPTZ;
BEGIN
  -- Compute IST midnight boundaries using Postgres date arithmetic
  v_today_start_ist := ((NOW() AT TIME ZONE 'Asia/Kolkata')::date AT TIME ZONE 'Asia/Kolkata');
  v_yesterday_start_ist := (((NOW() AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '1 day') AT TIME ZONE 'Asia/Kolkata');

  -- Visitors right now (active within last 5 minutes)
  SELECT COUNT(*) INTO v_visitors_right_now
  FROM visitor_sessions
  WHERE last_active_at >= (NOW() - INTERVAL '5 minutes');

  -- Visitors in last 15 minutes
  SELECT COUNT(*) INTO v_visitors_last_15m
  FROM visitor_sessions
  WHERE last_active_at >= (NOW() - INTERVAL '15 minutes');

  -- Sessions active today (using last_active_at so returning sessions are counted)
  SELECT COUNT(*) INTO v_sessions_today
  FROM visitor_sessions
  WHERE last_active_at >= v_today_start_ist;

  -- Sessions active yesterday
  SELECT COUNT(*) INTO v_sessions_yesterday
  FROM visitor_sessions
  WHERE last_active_at >= v_yesterday_start_ist
    AND last_active_at < v_today_start_ist;

  -- Active carts (updated in last 15 minutes with items)
  SELECT COUNT(*), COALESCE(SUM(cart_total_paise), 0)
  INTO v_active_carts_count, v_active_carts_total_paise
  FROM active_carts_tracker
  WHERE product_count > 0
    AND updated_at >= (NOW() - INTERVAL '15 minutes');

  -- Checking out right now
  SELECT COUNT(*) INTO v_checking_out_count
  FROM visitor_sessions
  WHERE current_path LIKE '/checkout%'
    AND last_active_at >= (NOW() - INTERVAL '5 minutes');

  -- Orders today
  SELECT COUNT(*), COALESCE(SUM(total_paise), 0)
  INTO v_orders_today_count, v_orders_today_revenue_paise
  FROM orders
  WHERE created_at >= v_today_start_ist
    AND payment_status IN ('paid', 'confirmed', 'cod_confirmed');

  RETURN json_build_object(
    'visitors_right_now', COALESCE(v_visitors_right_now, 0),
    'visitors_last_15m', COALESCE(v_visitors_last_15m, 0),
    'sessions_today', COALESCE(v_sessions_today, 0),
    'sessions_yesterday', COALESCE(v_sessions_yesterday, 0),
    'active_carts_count', COALESCE(v_active_carts_count, 0),
    'active_carts_total_paise', COALESCE(v_active_carts_total_paise, 0),
    'checking_out_count', COALESCE(v_checking_out_count, 0),
    'orders_today_count', COALESCE(v_orders_today_count, 0),
    'orders_today_revenue_paise', COALESCE(v_orders_today_revenue_paise, 0),
    'db_now', NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_live_analytics_snapshot TO anon, authenticated, service_role;
