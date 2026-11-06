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
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase URL or Key not found. Check environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function seed() {
  console.log('--- Seeding Mock Shipping Settings & Providers ---');

  // 1. Seed shipping_settings
  const settingsRow = {
    provider_name: 'delhivery',
    provider_enabled: true,
    api_url: 'https://track.delhivery.com',
    api_key: 'mock_delhivery_api_key_1234567890',
    pickup_name: 'KickoffPro Warehouse Delhi',
    pickup_phone: '9876543210',
    pickup_address_line1: '123 Warehouse Lane',
    pickup_address_line2: 'Okhla Phase 3',
    pickup_city: 'New Delhi',
    pickup_state: 'Delhi',
    pickup_pincode: '110020',
    free_shipping_threshold_paise: 99900,
    default_shipping_charge_paise: 9900,
    cod_enabled: true,
    cod_fee_paise: 5000,
  };

  console.log('Upserting shipping_settings singleton...');
  const { data: existingSettings } = await supabase
    .from('shipping_settings')
    .select('id')
    .limit(1)
    .maybeSingle();

  let settingsId = '';
  if (existingSettings?.id) {
    settingsId = existingSettings.id;
    await supabase.from('shipping_settings').update(settingsRow).eq('id', settingsId);
  } else {
    const { data: newSettings } = await supabase
      .from('shipping_settings')
      .insert(settingsRow)
      .select('id')
      .single();
    settingsId = newSettings?.id || '';
  }
  console.log('✓ shipping_settings upserted successfully.');

  // 2. Seed shipping_providers
  const providers = [
    {
      name: 'delhivery',
      is_active: true,
      environment: 'sandbox',
      api_url: 'https://track.delhivery.com',
      api_key: 'mock_delhivery_api_key_1234567890',
      pickup_name: 'KickoffPro Warehouse Delhi',
      pickup_phone: '9876543210',
      pickup_line1: '123 Warehouse Lane',
      pickup_line2: 'Okhla Phase 3',
      pickup_city: 'New Delhi',
      pickup_state: 'Delhi',
      pickup_pincode: '110020',
      features_cod: true,
      features_reverse: false,
      features_insurance: false,
    },
    {
      name: 'shiprocket',
      is_active: false,
      environment: 'sandbox',
      api_url: 'https://apiv2.shiprocket.in/v1/external',
      auth_email: 'mock-admin@kickoffpro.in',
      auth_password_encrypted: 'mock-password-123456',
      pickup_name: 'KickoffPro Warehouse Delhi',
      pickup_phone: '9876543210',
      pickup_line1: '123 Warehouse Lane',
      pickup_line2: 'Okhla Phase 3',
      pickup_city: 'New Delhi',
      pickup_state: 'Delhi',
      pickup_pincode: '110020',
      features_cod: true,
      features_reverse: false,
      features_insurance: false,
    }
  ];

  console.log('Upserting shipping_providers...');
  for (const provider of providers) {
    const { data: existingProv } = await supabase
      .from('shipping_providers')
      .select('id')
      .eq('name', provider.name)
      .maybeSingle();

    if (existingProv?.id) {
      const { is_active, ...rest } = provider;
      await supabase.from('shipping_providers').update(rest).eq('id', existingProv.id);
    } else {
      await supabase.from('shipping_providers').insert(provider);
    }
  }

  // Activate delhivery provider via RPC
  const { data: delhiveryProv } = await supabase
    .from('shipping_providers')
    .select('id')
    .eq('name', 'delhivery')
    .single();

  if (delhiveryProv?.id) {
    await supabase.rpc('activate_shipping_provider', {
      p_provider_id: delhiveryProv.id,
    });
  }
  console.log('✓ shipping_providers seeded and activated successfully.');

  // 3. Seed shipping_pricing_rules
  console.log('Upserting shipping_pricing_rules...');
  const pricingRule = {
    free_shipping_threshold_paise: 99900,
    default_charge_paise: 9900,
    default_weight_grams: 500,
    express_enabled: false,
    express_charge_paise: 0,
  };
  const { data: existingPricing } = await supabase
    .from('shipping_pricing_rules')
    .select('id')
    .limit(1)
    .maybeSingle();

  if (existingPricing?.id) {
    await supabase.from('shipping_pricing_rules').update(pricingRule).eq('id', existingPricing.id);
  } else {
    await supabase.from('shipping_pricing_rules').insert(pricingRule);
  }
  console.log('✓ shipping_pricing_rules upserted successfully.');

  // 4. Seed cod_rules
  console.log('Upserting cod_rules...');
  const codRule = {
    enabled: true,
    fee_paise: 5000,
    min_order_paise: 0,
  };
  const { data: existingCod } = await supabase
    .from('cod_rules')
    .select('id')
    .limit(1)
    .maybeSingle();

  if (existingCod?.id) {
    await supabase.from('cod_rules').update(codRule).eq('id', existingCod.id);
  } else {
    await supabase.from('cod_rules').insert(codRule);
  }
  console.log('✓ cod_rules upserted successfully.');

  console.log('--- Seeding Completed Successfully ---');
}

seed().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
