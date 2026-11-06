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
  console.log(`Connecting to: ${url}`);
  console.log(`Using Key (first 15 chars): ${key ? key.substring(0, 15) : 'NONE'}...`);
  
  const supabase = createClient(url, key);

  const { data: counts, error: countError } = await supabase
    .from('job_queue')
    .select('status');
    
  if (countError) {
    console.error('Error fetching jobs:', countError.message);
    return;
  }
  
  const countsByStatus = {};
  counts.forEach(row => {
    countsByStatus[row.status] = (countsByStatus[row.status] || 0) + 1;
  });
  console.log('Job counts by status:', countsByStatus);

  const { data: failedJobs, error: failedError } = await supabase
    .from('job_queue')
    .select('id, kind, status, attempts, last_error, run_at')
    .in('status', ['failed', 'dead'])
    .order('updated_at', { ascending: false })
    .limit(10);
    
  if (failedError) {
    console.error('Error fetching failed jobs:', failedError.message);
  } else {
    console.log('Failed/Dead jobs (last 10):', JSON.stringify(failedJobs, null, 2));
  }
}

run();
