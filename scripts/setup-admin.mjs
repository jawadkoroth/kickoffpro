#!/usr/bin/env node
/**
 * KickoffPro — One-time admin setup script.
 * 
 * Creates the first admin user and seeds initial shipping settings.
 * Requires SUPABASE_SERVICE_ROLE_KEY to be set in .env.local.
 * 
 * Usage: node scripts/setup-admin.mjs <email>
 * Example: node scripts/setup-admin.mjs jawad@kickoffpro.in
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Load .env.local manually ─────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(process.cwd(), '.env.local');
  try {
    const content = readFileSync(envPath, 'utf-8');
    const vars = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }
    return vars;
  } catch {
    console.error('❌ Cannot read .env.local');
    process.exit(1);
  }
}

const env = loadEnv();
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL not set in .env.local');
  process.exit(1);
}
if (!serviceKey || serviceKey.length < 20) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY is empty or too short in .env.local');
  console.error('   Get it from: https://supabase.com/dashboard/project/tyebhmerllfvmmfeliws/settings/api');
  console.error('   Paste it into .env.local line 7');
  process.exit(1);
}

const email = process.argv[2];
if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/setup-admin.mjs <email>');
  console.error('Example: node scripts/setup-admin.mjs jawad@kickoffpro.in');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  KickoffPro — Admin Setup');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

// ── Step 1: Find user by email ──────────────────────────────────────
console.log(`🔍 Looking up auth user: ${email}`);
const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();

if (listError) {
  console.error('❌ Failed to list users:', listError.message);
  process.exit(1);
}

const authUser = users?.find(u => u.email === email);

if (!authUser) {
  console.log(`⚠️  No auth user found for ${email}`);
  console.log('   Creating one...');
  
  // Create the auth user
  const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password: 'KickoffAdmin2024!', // Temporary password
    email_confirm: true,
  });
  
  if (createErr) {
    console.error('❌ Failed to create user:', createErr.message);
    process.exit(1);
  }
  
  console.log(`✅ Auth user created: ${newUser.user.id}`);
  
  // Insert as admin
  const { error: adminErr } = await supabase
    .from('admin_users')
    .upsert({ id: newUser.user.id, email, role: 'super_admin' }, { onConflict: 'id' });
  
  if (adminErr) {
    console.error('❌ Failed to insert admin_users row:', adminErr.message);
    process.exit(1);
  }
  
  console.log(`✅ Admin user created for ${email}`);
  console.log(`   Temporary password: KickoffAdmin2024!`);
  console.log(`   ⚠️  Change this password immediately after first login!`);
} else {
  console.log(`✅ Found auth user: ${authUser.id}`);
  
  // Check if already admin
  const { data: existing } = await supabase
    .from('admin_users')
    .select('id')
    .eq('id', authUser.id)
    .maybeSingle();
  
  if (existing) {
    console.log('✅ Already an admin — no changes needed');
  } else {
    const { error: adminErr } = await supabase
      .from('admin_users')
      .insert({ id: authUser.id, email, role: 'super_admin' });
    
    if (adminErr) {
      console.error('❌ Failed to insert admin_users row:', adminErr.message);
      process.exit(1);
    }
    console.log(`✅ Admin role granted to ${email}`);
  }
}

// ── Step 2: Check shipping tables ───────────────────────────────────
console.log('');
console.log('📋 Checking shipping configuration...');

const { count: settingsCount } = await supabase
  .from('shipping_settings')
  .select('*', { count: 'exact', head: true });

const { count: providersCount } = await supabase
  .from('shipping_providers')
  .select('*', { count: 'exact', head: true });

console.log(`   shipping_settings: ${settingsCount ?? 0} rows`);
console.log(`   shipping_providers: ${providersCount ?? 0} rows`);

if ((settingsCount ?? 0) === 0) {
  console.log('   → No shipping settings found. Configure via Admin UI → Shipping');
}

// ── Step 3: Check orders ────────────────────────────────────────────
const { count: orderCount } = await supabase
  .from('orders')
  .select('*', { count: 'exact', head: true });

console.log(`   orders: ${orderCount ?? 0} rows`);

// ── Summary ─────────────────────────────────────────────────────────
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Next Steps:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('  1. Start dev server:  npm run dev');
console.log('  2. Go to:             http://localhost:3000/admin');
console.log('  3. Log in with your email');
console.log('  4. Go to Shipping → Configure Delhivery provider');
console.log('  5. Place a test order through the storefront');
console.log('  6. Ship the order from Admin → Orders');
console.log('');
