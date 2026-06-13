/**
 * KickoffPro — POST /api/admin/shipping/test
 *
 * Performs a live operational test of the configured shipping provider.
 * Returns structured diagnostics for the admin diagnostics panel.
 *
 * Auth: Admin-only (via middleware or session validation)
 * Response: ConnectionTestResult JSON
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActiveProvider } from '@/lib/shipping/registry';
import { ConnectionTestResult } from '@/lib/shipping/types';
import { logEvent } from '@/lib/log';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(_req: NextRequest): Promise<NextResponse> {
  const t0 = Date.now();

  try {
    // Auth check — require admin role
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: adminUser } = await supabase
      .from('admin_users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (!adminUser) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Try NEW PIPE first (if enabled), otherwise fall back to LEGACY
    let provider = await getActiveProvider();
    let isLegacy = false;

    if (!provider) {
      // Fall back to legacy system using shipping_settings
      const supabase = createAdminClient();
      const { data: settings } = await supabase
        .from('shipping_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (!settings || !settings.provider_enabled) {
        logEvent('shipping.test.no_active_provider', {}, { source: 'api', severity: 'warn' });
        return NextResponse.json<ConnectionTestResult>({
          success: false,
          provider: 'delhivery',
          checks: {
            auth: { ok: false, latency_ms: 0, message: 'No active provider configured' },
            api: { ok: false, message: 'Provider not enabled' },
            pickup: { ok: false, message: 'No provider' },
          },
          errors: ['No active shipping provider configured — enable a provider in settings'],
          warnings: ['Shipping system is currently disabled'],
          timestamp: new Date().toISOString(),
        }, { status: 503 });
      }

      // Create legacy provider instance
      const { DelhiveryProvider } = await import('@/lib/shipping/delhivery');
      const legacyConfig = {
        id: '',
        name: settings.provider_name ?? 'delhivery',
        environment: 'sandbox' as const,
        api_url: settings.api_url,
        api_key: settings.api_key,
        api_secret: null,
        webhook_secret: null,
        token: null,
        token_expires_at: null,
        auth_email: null,
        auth_password_encrypted: null,
        pickup_name: settings.pickup_name,
        pickup_phone: settings.pickup_phone,
        pickup_gstin: null,
        pickup_line1: settings.pickup_address_line1,
        pickup_line2: settings.pickup_address_line2,
        pickup_city: settings.pickup_city,
        pickup_state: settings.pickup_state,
        pickup_pincode: settings.pickup_pincode,
        features_cod: settings.cod_enabled ?? true,
        features_reverse: false,
        features_insurance: false,
      };
      provider = new DelhiveryProvider(legacyConfig);
      isLegacy = true;
    }

    // Run the connection test
    const result = await provider.testConnection();
    const latency = Date.now() - t0;

    logEvent('shipping.test.completed', {
      provider: result.provider,
      success: result.success,
      latency_ms: latency,
      error_count: result.errors.length,
      legacy: isLegacy,
    }, { source: 'api', severity: result.success ? 'info' : 'warn' });

    // Add warning if using legacy system
    if (isLegacy && result.success) {
      result.warnings.push('Using legacy shipping system — consider migrating to new provider system');
    }

    return NextResponse.json<ConnectionTestResult>(result);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logEvent('shipping.test.failed', { error: msg }, { source: 'api', severity: 'error' });

    return NextResponse.json<ConnectionTestResult>({
      success: false,
      provider: 'delhivery',
      checks: {
        auth: { ok: false, latency_ms: Date.now() - t0, message: 'Internal error' },
        api: { ok: false, message: msg },
        pickup: { ok: false, message: 'Unknown' },
      },
      errors: [`Internal error: ${msg}`],
      warnings: [],
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
