-- =============================================
-- NOIR Ecommerce — Database Migration
-- Run this in Supabase SQL Editor
-- =============================================

-- 1. Products table
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  price_paise INTEGER NOT NULL,
  images JSONB DEFAULT '[]'::jsonb,
  sizes JSONB DEFAULT '[]'::jsonb,
  category TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Inventory table
CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(product_id, size)
);

-- 3. Orders table
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT UNIQUE NOT NULL,
  product_id UUID NOT NULL REFERENCES products(id),
  size TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  unit_price_paise INTEGER NOT NULL,
  subtotal_paise INTEGER NOT NULL,
  discount_paise INTEGER DEFAULT 0,
  total_paise INTEGER NOT NULL,
  coupon_code TEXT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cod', 'online')),
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  order_status TEXT DEFAULT 'pending' CHECK (order_status IN ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled')),
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  razorpay_signature TEXT,
  customer JSONB NOT NULL,
  shipping_address JSONB NOT NULL,
  tracking_id TEXT,
  label_url TEXT,
  label_url_original TEXT,
  shipping_provider TEXT,
  retry_count INTEGER DEFAULT 0,
  cancel_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Coupons table (simplified)
CREATE TABLE coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  discount_percent INTEGER NOT NULL CHECK (discount_percent >= 1 AND discount_percent <= 100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Shipping settings (singleton)
CREATE TABLE shipping_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  active_provider TEXT DEFAULT 'delhivery',
  provider_config JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Admin users
CREATE TABLE admin_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================
-- INDEXES
-- =============================================

CREATE INDEX idx_inventory_product_size ON inventory(product_id, size);
CREATE INDEX idx_orders_status ON orders(order_status);
CREATE INDEX idx_orders_payment ON orders(payment_method, payment_status);
CREATE INDEX idx_orders_stuck ON orders(payment_method, payment_status, created_at)
  WHERE payment_method = 'online' AND payment_status = 'pending';
CREATE INDEX idx_orders_created ON orders(created_at DESC);

-- =============================================
-- FUNCTIONS
-- =============================================

-- Atomic stock decrement (prevents overselling)
CREATE OR REPLACE FUNCTION decrement_stock(
  p_product_id UUID,
  p_size TEXT,
  p_quantity INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
  rows_affected INTEGER;
BEGIN
  UPDATE inventory
  SET stock = stock - p_quantity,
      updated_at = NOW()
  WHERE product_id = p_product_id
    AND size = p_size
    AND stock >= p_quantity;

  GET DIAGNOSTICS rows_affected = ROW_COUNT;
  RETURN rows_affected > 0;
END;
$$ LANGUAGE plpgsql;

-- Restore stock on cancellation
CREATE OR REPLACE FUNCTION restore_stock(
  p_product_id UUID,
  p_size TEXT,
  p_quantity INTEGER
) RETURNS VOID AS $$
BEGIN
  UPDATE inventory
  SET stock = stock + p_quantity,
      updated_at = NOW()
  WHERE product_id = p_product_id
    AND size = p_size;
END;
$$ LANGUAGE plpgsql;

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read products" ON products FOR SELECT USING (true);
CREATE POLICY "Admin manage products" ON products FOR ALL
  USING (auth.uid() IN (SELECT id FROM admin_users));

ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read inventory" ON inventory FOR SELECT USING (true);
CREATE POLICY "Admin manage inventory" ON inventory FOR ALL
  USING (auth.uid() IN (SELECT id FROM admin_users));

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage orders" ON orders FOR ALL
  USING (auth.uid() IN (SELECT id FROM admin_users));

ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read active coupons" ON coupons FOR SELECT USING (is_active = true);
CREATE POLICY "Admin manage coupons" ON coupons FOR ALL
  USING (auth.uid() IN (SELECT id FROM admin_users));

ALTER TABLE shipping_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage shipping" ON shipping_settings FOR ALL
  USING (auth.uid() IN (SELECT id FROM admin_users));

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin read admin_users" ON admin_users FOR SELECT
  USING (auth.uid() = id);

-- =============================================
-- SEED: Default shipping settings row
-- =============================================

INSERT INTO shipping_settings (active_provider, provider_config) VALUES
  ('delhivery', '{"api_key": "", "api_url": "https://track.delhivery.com/api", "pickup_location": ""}');

-- =============================================
-- SEED: Sample product (remove in production)
-- =============================================

INSERT INTO products (name, slug, description, price_paise, images, sizes) VALUES
  (
    'Classic Noir Football Jersey',
    'classic-noir-football-jersey',
    'Official-inspired football jersey designed for match-day comfort and everyday wear. Breathable fabric, athletic fit, and lightweight construction. Perfect for supporters and collectors.',
    129900,
    '[]',
    '["S", "M", "L", "XL", "XXL"]'
  );

-- Add inventory for each size
INSERT INTO inventory (product_id, size, stock)
SELECT p.id, s.size, 10
FROM products p,
  (VALUES ('S'), ('M'), ('L'), ('XL'), ('XXL')) AS s(size)
WHERE p.slug = 'classic-noir-football-jersey';

-- SEED: Sample coupon
INSERT INTO coupons (code, discount_percent) VALUES ('WELCOME10', 10);
