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

  const { data: settings, error: errSettings } = await supabase.from('shipping_settings').select('*').limit(1).maybeSingle();
  if (errSettings) {
    console.error('Error fetching shipping_settings:', errSettings.message);
  } else {
    console.log('--- SHIPPING SETTINGS ---');
    console.log(JSON.stringify(settings, null, 2));
  }

  const { data: providers, error: errProviders } = await supabase.from('shipping_providers').select('*');
  if (errProviders) {
    console.error('Error fetching shipping_providers:', errProviders.message);
  } else {
    console.log('--- SHIPPING PROVIDERS ---');
    console.log(JSON.stringify(providers, null, 2));
  }
}

run();
