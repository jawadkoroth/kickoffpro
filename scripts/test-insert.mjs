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
  const url = localEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = localEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = createClient(url, anonKey);

  console.log('Testing INSERT on orders table...');
  const { data, error } = await supabase.from('orders').insert({
    order_number: `KP-TEST-${Math.floor(Math.random() * 100000)}`,
    product_id: '420cdaf7-7a3f-45b1-bf37-517fbf0b9d07', // Brazil jersey
    size: 'S',
    quantity: 1,
    unit_price_paise: 54900,
    subtotal_paise: 54900,
    total_paise: 54900,
    payment_method: 'cod',
    payment_status: 'pending',
    order_status: 'pending',
    customer: { name: 'Test', phone: '+919999999999' },
    shipping_address: { line1: 'Test', city: 'Delhi', state: 'Delhi', pincode: '110001' }
  }).select();

  if (error) {
    console.error('Insert Error:', error);
  } else {
    console.log('Insert Success! Created Order:', data);
    // Cleanup
    await supabase.from('orders').delete().eq('id', data[0].id);
    console.log('Cleaned up.');
  }
}

run();
