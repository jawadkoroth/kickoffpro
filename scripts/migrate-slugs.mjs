import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env.local');
  if (!fs.existsSync(envPath)) return {};
  
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      let value = parts.slice(1).join('=').trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }
      env[key] = value;
    }
  });
  return env;
}

function normalizeSlug(slug) {
  if (typeof slug !== 'string') return '';
  return slug
    .trim()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function run() {
  const localEnv = loadEnv();
  const url = localEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = localEnv.SUPABASE_SERVICE_ROLE_KEY || localEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !serviceKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey);

  console.log('Fetching all products...');
  const { data: products, error: fetchErr } = await supabase
    .from('products')
    .select('id, name, slug')
    .order('created_at', { ascending: true });

  if (fetchErr) {
    console.error('Error fetching products:', fetchErr.message);
    process.exit(1);
  }

  console.log(`Found ${products.length} products. Starting slug normalization...`);

  const updatedSlugs = new Set();

  for (const product of products) {
    const baseSlug = normalizeSlug(product.slug || product.name);
    let finalSlug = baseSlug || 'product';
    let counter = 1;

    // Check for collisions among already processed/allocated slugs in this run
    while (updatedSlugs.has(finalSlug)) {
      counter++;
      finalSlug = `${baseSlug}-${counter}`;
    }

    // Double check database for conflicts not in the initial set (just in case)
    while (true) {
      const { data: collision } = await supabase
        .from('products')
        .select('id')
        .eq('slug', finalSlug)
        .neq('id', product.id)
        .maybeSingle();

      if (!collision) {
        break;
      }
      counter++;
      finalSlug = `${baseSlug}-${counter}`;
    }

    updatedSlugs.add(finalSlug);

    if (product.slug !== finalSlug) {
      console.log(`Updating product [${product.name}] ID: [${product.id}]: "${product.slug}" -> "${finalSlug}"`);
      const { error: updateErr } = await supabase
        .from('products')
        .update({ slug: finalSlug })
        .eq('id', product.id);

      if (updateErr) {
        console.error(`Failed to update product ${product.id}:`, updateErr.message);
      }
    } else {
      console.log(`Product [${product.name}] slug is already normalized: "${product.slug}"`);
    }
  }

  console.log('Migration completed successfully!');
}

run();
