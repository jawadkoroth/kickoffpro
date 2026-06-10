-- =============================================
-- Migration 029: Add Homepage Feature Fields
-- =============================================

ALTER TABLE products 
  ADD COLUMN IF NOT EXISTS homepage_feature_image TEXT,
  ADD COLUMN IF NOT EXISTS homepage_feature_enabled BOOLEAN DEFAULT false;
