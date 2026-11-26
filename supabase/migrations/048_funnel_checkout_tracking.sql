-- ==============================================================================
-- Migration 048: Accurate Storefront Funnel Tracking (Added to Cart & Reached Checkout)
-- ==============================================================================

ALTER TABLE public.visitor_sessions
  ADD COLUMN IF NOT EXISTS added_to_cart_at    TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reached_checkout_at TIMESTAMPTZ DEFAULT NULL;

-- Backfill any sessions currently on /checkout%
UPDATE public.visitor_sessions
SET reached_checkout_at = COALESCE(reached_checkout_at, last_active_at)
WHERE current_path LIKE '/checkout%' AND reached_checkout_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_visitor_sessions_reached_checkout
  ON public.visitor_sessions(reached_checkout_at DESC)
  WHERE reached_checkout_at IS NOT NULL;

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
    id,
    user_id,
    ip_address,
    country,
    state,
    city,
    current_path,
    referrer,
    user_agent,
    last_active_at,
    created_at,
    added_to_cart_at,
    reached_checkout_at
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
    NOW(),
    CASE WHEN COALESCE(p_product_count, 0) > 0 THEN NOW() ELSE NULL END,
    CASE WHEN COALESCE(p_current_path, '/') LIKE '/checkout%' THEN NOW() ELSE NULL END
  )
  ON CONFLICT (id) DO UPDATE SET
    user_id = COALESCE(EXCLUDED.user_id, visitor_sessions.user_id),
    ip_address = COALESCE(EXCLUDED.ip_address, visitor_sessions.ip_address),
    country = CASE WHEN EXCLUDED.country <> '' AND EXCLUDED.country <> 'India' THEN EXCLUDED.country ELSE visitor_sessions.country END,
    state = CASE WHEN EXCLUDED.state <> '' AND EXCLUDED.state <> 'Unknown' THEN EXCLUDED.state ELSE visitor_sessions.state END,
    city = CASE WHEN EXCLUDED.city <> '' AND EXCLUDED.city <> 'Unknown' THEN EXCLUDED.city ELSE visitor_sessions.city END,
    current_path = COALESCE(NULLIF(EXCLUDED.current_path, ''), visitor_sessions.current_path),
    referrer = COALESCE(EXCLUDED.referrer, visitor_sessions.referrer),
    user_agent = COALESCE(EXCLUDED.user_agent, visitor_sessions.user_agent),
    last_active_at = NOW(),
    added_to_cart_at = CASE
      WHEN COALESCE(p_product_count, 0) > 0 THEN NOW()
      ELSE visitor_sessions.added_to_cart_at
    END,
    reached_checkout_at = CASE
      WHEN COALESCE(p_current_path, '/') LIKE '/checkout%' THEN NOW()
      ELSE visitor_sessions.reached_checkout_at
    END;

  INSERT INTO active_carts_tracker (
    session_id, product_count, cart_total_paise, updated_at
  ) VALUES (
    p_session_id,
    GREATEST(0, COALESCE(p_product_count, 0)),
    GREATEST(0, COALESCE(p_cart_total_paise, 0)),
    NOW()
  )
  ON CONFLICT (session_id) DO UPDATE SET
    product_count = GREATEST(0, COALESCE(EXCLUDED.product_count, 0)),
    cart_total_paise = GREATEST(0, COALESCE(EXCLUDED.cart_total_paise, 0)),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION record_visitor_heartbeat TO anon, authenticated, service_role;

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
  v_funnel_added_to_cart_today INT;
  v_funnel_reached_checkout_today INT;
  v_orders_today_count INT;
  v_orders_today_revenue_paise BIGINT;
  v_today_start_ist TIMESTAMPTZ;
  v_yesterday_start_ist TIMESTAMPTZ;
BEGIN
  v_today_start_ist := ((NOW() AT TIME ZONE 'Asia/Kolkata')::date AT TIME ZONE 'Asia/Kolkata');
  v_yesterday_start_ist := (((NOW() AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '1 day') AT TIME ZONE 'Asia/Kolkata');

  SELECT COUNT(*) INTO v_visitors_right_now
  FROM visitor_sessions
  WHERE last_active_at >= (NOW() - INTERVAL '5 minutes');

  SELECT COUNT(*) INTO v_visitors_last_15m
  FROM visitor_sessions
  WHERE last_active_at >= (NOW() - INTERVAL '15 minutes');

  SELECT COUNT(*) INTO v_sessions_today
  FROM visitor_sessions
  WHERE last_active_at >= v_today_start_ist;

  SELECT COUNT(*) INTO v_sessions_yesterday
  FROM visitor_sessions
  WHERE last_active_at >= v_yesterday_start_ist
    AND last_active_at < v_today_start_ist;

  SELECT COUNT(*), COALESCE(SUM(cart_total_paise), 0)
  INTO v_active_carts_count, v_active_carts_total_paise
  FROM active_carts_tracker
  WHERE product_count > 0
    AND updated_at >= (NOW() - INTERVAL '15 minutes');

  SELECT COUNT(*) INTO v_checking_out_count
  FROM visitor_sessions
  WHERE current_path LIKE '/checkout%'
    AND last_active_at >= (NOW() - INTERVAL '5 minutes');

  -- Today's cumulative storefront funnel: persisted per-session milestones since IST midnight
  SELECT COUNT(*) INTO v_funnel_added_to_cart_today
  FROM visitor_sessions vs
  WHERE vs.last_active_at >= v_today_start_ist
    AND (
      vs.added_to_cart_at >= v_today_start_ist
      OR EXISTS (
        SELECT 1 FROM active_carts_tracker act
        WHERE act.session_id = vs.id AND act.product_count > 0 AND act.updated_at >= v_today_start_ist
      )
    );

  SELECT COUNT(*) INTO v_funnel_reached_checkout_today
  FROM visitor_sessions
  WHERE (
    reached_checkout_at >= v_today_start_ist
    OR (current_path LIKE '/checkout%' AND last_active_at >= v_today_start_ist)
  );

  SELECT COUNT(*), COALESCE(SUM(total_paise), 0)
  INTO v_orders_today_count, v_orders_today_revenue_paise
  FROM orders
  WHERE created_at >= v_today_start_ist
    AND order_status <> 'cancelled'
    AND (payment_status IN ('paid', 'confirmed', 'cod_confirmed') OR payment_method = 'cod');

  RETURN json_build_object(
    'visitors_right_now', COALESCE(v_visitors_right_now, 0),
    'visitors_last_15m', COALESCE(v_visitors_last_15m, 0),
    'sessions_today', COALESCE(v_sessions_today, 0),
    'sessions_yesterday', COALESCE(v_sessions_yesterday, 0),
    'active_carts_count', COALESCE(v_active_carts_count, 0),
    'active_carts_total_paise', COALESCE(v_active_carts_total_paise, 0),
    'checking_out_count', COALESCE(v_checking_out_count, 0),
    'funnel_added_to_cart_today', GREATEST(COALESCE(v_funnel_added_to_cart_today, 0), COALESCE(v_active_carts_count, 0)),
    'funnel_reached_checkout_today', GREATEST(COALESCE(v_funnel_reached_checkout_today, 0), COALESCE(v_checking_out_count, 0), COALESCE(v_orders_today_count, 0)),
    'orders_today_count', COALESCE(v_orders_today_count, 0),
    'orders_today_revenue_paise', COALESCE(v_orders_today_revenue_paise, 0),
    'db_now', NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_live_analytics_snapshot TO anon, authenticated, service_role;
