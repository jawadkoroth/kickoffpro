import { createClient } from '@supabase/supabase-js';
import path from 'path';
import fs from 'fs';

// Load env variables manually
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
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
      process.env[key] = value;
    }
  });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase URL or Key not found. Check environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAdmin() {
  console.log('--- Testing Admin Login via Supabase Auth ---');
  const email = process.env.SMTP_HELLO_USER || 'hello@kickoffpro.in';
  const password = process.env.SMTP_HELLO_PASS || 'ET60MsU9XUtp';

  console.log(`Attempting to sign in with: ${email}`);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError) {
    console.error('❌ Auth sign-in failed:', authError.message);
    process.exit(1);
  }

  const user = authData.user;
  console.log('✅ Auth sign-in succeeded. User ID:', user?.id);

  console.log('Checking admin_users table...');
  const { data: adminUser, error: adminError } = await supabase
    .from('admin_users')
    .select('*')
    .eq('id', user?.id)
    .single();

  if (adminError) {
    console.error('❌ Not in admin_users table or read failed:', adminError.message);
    process.exit(1);
  }

  console.log('✅ User is admin! admin_users entry:', adminUser);

  console.log('Testing insert to shipping_settings...');
  const testSettings = {
    provider_name: 'delhivery',
    provider_enabled: true,
    pickup_name: 'KickoffPro Test Pickup',
  };

  const { data: existing, error: selectErr } = await supabase
    .from('shipping_settings')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (selectErr) {
    console.error('❌ Failed to select shipping_settings:', selectErr.message);
    process.exit(1);
  }

  console.log('Existing settings:', existing);

  if (existing?.id) {
    const { error: updateErr } = await supabase
      .from('shipping_settings')
      .update(testSettings)
      .eq('id', existing.id);
    if (updateErr) {
      console.error('❌ Failed to update shipping_settings:', updateErr.message);
    } else {
      console.log('✅ Successfully updated shipping_settings!');
    }
  } else {
    const { error: insertErr } = await supabase
      .from('shipping_settings')
      .insert(testSettings);
    if (insertErr) {
      console.error('❌ Failed to insert shipping_settings:', insertErr.message);
    } else {
      console.log('✅ Successfully inserted shipping_settings!');
    }
  }
}

checkAdmin().catch(err => {
  console.error('Check failed:', err);
  process.exit(1);
});
