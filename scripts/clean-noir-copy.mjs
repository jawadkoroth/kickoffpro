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

async function run() {
  const localEnv = loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || localEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || localEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error('Error: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set.');
    process.exit(1);
  }

  const supabase = createClient(url, anonKey);
  console.log('Connecting to Supabase at:', url);

  // Fetch all products
  const { data: products, error: fetchError } = await supabase
    .from('products')
    .select('id, name, slug, description');

  if (fetchError) {
    console.error('Error fetching products:', fetchError.message);
    process.exit(1);
  }

  console.log(`Fetched ${products?.length || 0} products. Auditing descriptions...`);

  const footballCopy = 'Official-inspired football jersey designed for match-day comfort and everyday wear. Breathable fabric, athletic fit, and lightweight construction. Perfect for supporters and collectors.';

  for (const p of products || []) {
    const desc = p.description || '';
    const name = p.name || '';
    const needsUpdate = 
      desc.toLowerCase().includes('linen') || 
      desc.toLowerCase().includes('handcrafted') ||
      desc.toLowerCase().includes('aesthetic') ||
      name.toLowerCase().includes('linen');

    if (needsUpdate) {
      console.log(`Product "${name}" (${p.slug}) contains Noir-era copy. Updating...`);
      
      const updates = {
        description: footballCopy
      };
      
      // If the name contains "Linen", let's make it "Jersey" instead
      if (name.toLowerCase().includes('linen')) {
        updates.name = name.replace(/linen/gi, 'Football Jersey');
      }

      const { data, error: updateError } = await supabase
        .from('products')
        .update(updates)
        .eq('id', p.id)
        .select();

      if (updateError) {
        console.error(`Error updating product ${p.id}:`, updateError.message);
      } else {
        console.log(`Successfully updated product "${p.id}" details in database.`);
      }
    }
  }

  console.log('Audit and update complete.');
}

run().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
