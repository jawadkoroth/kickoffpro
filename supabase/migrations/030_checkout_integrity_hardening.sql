-- ===================================================================
-- Migration 030: Checkout & Pricing Integrity Hardening
-- ===================================================================

-- 1. Orders table check constraints to prevent negative values
ALTER TABLE orders
  ADD CONSTRAINT check_subtotal_paise_nonnegative CHECK (subtotal_paise >= 0),
  ADD CONSTRAINT check_discount_paise_nonnegative CHECK (discount_paise >= 0),
  ADD CONSTRAINT check_total_paise_nonnegative CHECK (total_paise >= 0);

-- 2. Recreate create_order_atomic_v2 to add coupon checks in transaction
CREATE OR REPLACE FUNCTION create_order_atomic_v2(
  p_client_request_id UUID,
  p_order_number      TEXT,
  p_items             JSONB,
  p_subtotal_paise    INTEGER,
  p_discount_paise    INTEGER,
  p_total_paise       INTEGER,
  p_coupon_code       TEXT,
  p_payment_method    TEXT,
  p_customer          JSONB,
  p_shipping_address  JSONB,
  p_user_id           UUID    DEFAULT NULL,
  p_shipping_paise    INTEGER DEFAULT 0,
  p_cod_fee_paise     INTEGER DEFAULT 0
) RETURNS TABLE (
  order_id     UUID,
  order_number TEXT,
  was_existing BOOLEAN
) AS $$
DECLARE
  v_existing_id     UUID;
  v_existing_number TEXT;
  v_rows_affected   INTEGER;
  v_new_id          UUID;
  v_coupon_code     TEXT;
  
  -- Locked coupon fields
  v_is_active       BOOLEAN;
  v_starts_at       TIMESTAMPTZ;
  v_expires_at      TIMESTAMPTZ;
  v_per_user_limit  INTEGER;
  v_usage_limit     INTEGER;
  v_new_users_only  BOOLEAN;
  
  v_per_user_used   INTEGER;
  v_global_used     INTEGER;
  v_total_qty       INTEGER;
  v_item            JSONB;
  v_item_pid        UUID;
  v_item_size       TEXT;
  v_item_qty        INTEGER;
  v_item_unit       INTEGER;
  v_item_subtotal   INTEGER;
  v_item_name       TEXT;
  v_item_image      TEXT;
BEGIN
  -- 1. Idempotent replay
  IF p_client_request_id IS NOT NULL THEN
    SELECT id, orders.order_number
      INTO v_existing_id, v_existing_number
      FROM orders
     WHERE client_request_id = p_client_request_id
     LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      order_id     := v_existing_id;
      order_number := v_existing_number;
      was_existing := TRUE;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- 2. Validate items array shape
  IF p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'EMPTY_ITEMS' USING ERRCODE = 'P0004';
  END IF;

  -- 3. Coupon checks inside the transaction
  v_coupon_code := NULLIF(p_coupon_code, '');
  IF v_coupon_code IS NOT NULL THEN
    -- Lock the coupons row for the entire transaction to prevent race conditions
    SELECT is_active, starts_at, expires_at, per_user_limit, usage_limit, new_users_only
      INTO v_is_active, v_starts_at, v_expires_at, v_per_user_limit, v_usage_limit, v_new_users_only
      FROM coupons
     WHERE code = v_coupon_code
     FOR UPDATE;

    -- A. Coupon exists?
    IF v_is_active IS NULL THEN
      RAISE EXCEPTION 'COUPON_NOT_FOUND' USING ERRCODE = 'P0006';
    END IF;

    -- B. Coupon active?
    IF v_is_active = FALSE THEN
      RAISE EXCEPTION 'COUPON_INACTIVE' USING ERRCODE = 'P0007';
    END IF;

    -- C. Starts at check
    IF v_starts_at IS NOT NULL AND v_starts_at > NOW() THEN
      RAISE EXCEPTION 'COUPON_NOT_STARTED' USING ERRCODE = 'P0008';
    END IF;

    -- D. Expires at check
    IF v_expires_at IS NOT NULL AND v_expires_at < NOW() THEN
      RAISE EXCEPTION 'COUPON_EXPIRED' USING ERRCODE = 'P0009';
    END IF;

    -- E. Auth check for per-user limit coupons
    IF v_per_user_limit IS NOT NULL AND p_user_id IS NULL THEN
      RAISE EXCEPTION 'COUPON_AUTH_REQUIRED' USING ERRCODE = 'P0012';
    END IF;

    -- F. New users only check
    IF v_new_users_only = TRUE THEN
      IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'COUPON_NEW_USERS_ONLY_GUEST' USING ERRCODE = 'P0010';
      ELSE
        SELECT COUNT(*) INTO v_per_user_used
          FROM orders
         WHERE user_id = p_user_id
           AND order_status <> 'cancelled';
        IF v_per_user_used > 0 THEN
          RAISE EXCEPTION 'COUPON_NEW_USERS_ONLY_REPEAT' USING ERRCODE = 'P0011';
        END IF;
      END IF;
    END IF;

    -- G. Per user limit check
    IF v_per_user_limit IS NOT NULL AND p_user_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_per_user_used
        FROM orders
       WHERE user_id = p_user_id
         AND coupon_code = v_coupon_code
         AND order_status <> 'cancelled';
      IF v_per_user_used >= v_per_user_limit THEN
        RAISE EXCEPTION 'COUPON_PER_USER_LIMIT' USING ERRCODE = 'P0002';
      END IF;
    END IF;

    -- H. Global usage limit check
    IF v_usage_limit IS NOT NULL THEN
      SELECT COUNT(*) INTO v_global_used
        FROM orders
       WHERE coupon_code = v_coupon_code
         AND order_status <> 'cancelled';
      IF v_global_used >= v_usage_limit THEN
        RAISE EXCEPTION 'COUPON_USAGE_LIMIT' USING ERRCODE = 'P0003';
      END IF;
    END IF;
  END IF;

  -- 4. Per-item stock decrement
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_pid  := (v_item->>'product_id')::UUID;
    v_item_size := v_item->>'size';
    v_item_qty  := (v_item->>'quantity')::INTEGER;

    IF v_item_pid IS NULL
       OR v_item_size IS NULL
       OR v_item_qty IS NULL
       OR v_item_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_ITEM' USING ERRCODE = 'P0005';
    END IF;

    UPDATE inventory
       SET stock = stock - v_item_qty,
           updated_at = NOW()
     WHERE product_id = v_item_pid
       AND size = v_item_size
       AND stock >= v_item_qty;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected = 0 THEN
      RAISE EXCEPTION 'STOCK_UNAVAILABLE' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- 5. Sum quantity header
  SELECT SUM((v->>'quantity')::INTEGER) INTO v_total_qty
    FROM jsonb_array_elements(p_items) v;

  -- 6. Insert order row
  INSERT INTO orders (
    client_request_id, user_id, order_number,
    quantity, subtotal_paise, discount_paise,
    shipping_paise, cod_fee_paise, total_paise,
    coupon_code, payment_method, payment_status, order_status,
    customer, shipping_address
  ) VALUES (
    p_client_request_id, p_user_id, p_order_number,
    v_total_qty, p_subtotal_paise, p_discount_paise,
    COALESCE(p_shipping_paise, 0), COALESCE(p_cod_fee_paise, 0), p_total_paise,
    v_coupon_code, p_payment_method, 'pending', 'pending',
    p_customer, p_shipping_address
  )
  RETURNING id INTO v_new_id;

  -- 7. Insert order items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_pid      := (v_item->>'product_id')::UUID;
    v_item_size     := v_item->>'size';
    v_item_qty      := (v_item->>'quantity')::INTEGER;
    v_item_unit     := (v_item->>'unit_price_paise')::INTEGER;
    v_item_subtotal := (v_item->>'subtotal_paise')::INTEGER;
    v_item_name     := COALESCE(v_item->>'product_name', '(unnamed product)');
    v_item_image    := v_item->>'image_url';

    INSERT INTO order_items (
      order_id, product_id, product_name, size, quantity,
      unit_price_paise, subtotal_paise, image_url
    ) VALUES (
      v_new_id, v_item_pid, v_item_name, v_item_size, v_item_qty,
      v_item_unit, v_item_subtotal, v_item_image
    );
  END LOOP;

  order_id     := v_new_id;
  order_number := p_order_number;
  was_existing := FALSE;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;
