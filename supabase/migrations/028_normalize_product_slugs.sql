-- =============================================
-- Migration 028: Global Product Slug Normalization
-- =============================================

-- 1. Normalize all existing slugs and resolve conflicts by appending numeric suffixes
DO $$
DECLARE
    r RECORD;
    v_base_slug TEXT;
    v_new_slug TEXT;
    v_counter INT;
    v_exists BOOLEAN;
BEGIN
    FOR r IN SELECT id, slug, name FROM products ORDER BY created_at ASC LOOP
        -- Generate base normalized slug from existing slug or name
        v_base_slug := regexp_replace(
                         regexp_replace(
                           regexp_replace(
                             lower(
                               replace(
                                 replace(
                                   trim(COALESCE(r.slug, r.name)),
                                   '–', '-' -- en-dash (U+2013)
                                 ),
                                 '—', '-' -- em-dash (U+2014)
                               )
                             ),
                             '[^a-z0-9-]+', '-', 'g'
                           ),
                           '-+', '-', 'g'
                         ),
                         '(^-|-$)', '', 'g'
                       );
        
        -- Fallback if empty
        IF v_base_slug = '' THEN
            v_base_slug := 'product-' || r.id::text;
        END IF;

        v_new_slug := v_base_slug;
        v_counter := 1;

        -- Loop to ensure slug is unique
        LOOP
            SELECT EXISTS (
                SELECT 1 
                FROM products 
                WHERE slug = v_new_slug AND id <> r.id
            ) INTO v_exists;

            IF NOT v_exists THEN
                EXIT;
            END IF;

            v_counter := v_counter + 1;
            v_new_slug := v_base_slug || '-' || v_counter;
        END LOOP;

        -- Update the product with normalized unique slug
        UPDATE products 
        SET slug = v_new_slug 
        WHERE id = r.id;
    END LOOP;
END;
$$;

-- 2. Ensure constraints exist on the products table
-- Force not null constraint on the slug column
ALTER TABLE products ALTER COLUMN slug SET NOT NULL;

-- Ensure unique constraint exists (in case it was dropped or needs to be re-asserted)
-- We check first to avoid errors since 001_initial.sql already defined it.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'products_slug_key' AND conrelid = 'products'::regclass
    ) THEN
        ALTER TABLE products ADD CONSTRAINT products_slug_key UNIQUE (slug);
    END IF;
END;
$$;
