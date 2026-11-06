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
  const key = localEnv.SUPABASE_SERVICE_ROLE_KEY || localEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = createClient(url, key);

  console.log('--- SHIPPING SETTINGS ---');
  const { data: settings, error: err1 } = await supabase.from('shipping_settings').select('*');
  if (err1) console.error('Error settings:', err1.message);
  else console.log(JSON.stringify(settings, null, 2));

  console.log('\n--- SHIPPING PROVIDERS ---');
  const { data: providers, error: err2 } = await supabase.from('shipping_providers').select('*');
  if (err2) console.error('Error providers:', err2.message);
  else console.log(JSON.stringify(providers, null, 2));
}

run();
