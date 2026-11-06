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

  console.log('Checking orders table for utm_source and tracking_event_id...');
  const { data: cols, error: colErr } = await supabase.from('orders').select('id, utm_source, tracking_event_id').limit(1);
  console.log('Columns test result:', { cols, colErr });
}

run();
