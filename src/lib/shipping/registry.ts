/**
 * KickoffPro — Shipping provider registry.
 *
 * Single read path for the active provider. All shipment-creating
 * code goes through getActiveProvider() — no direct provider imports
 * anywhere else in the codebase.
 *
 * Falls back gracefully to the legacy shipping_settings singleton
 * (read by the feature-flag guard) so PR 2 can dual-write without
 * requiring all callers to be updated atomically.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/log';
import { DelhiveryProvider } from './delhivery';
import { ShiprocketProvider } from './shiprocket';
import type { ShippingProvider, ProviderConfig } from './types';

/**
 * Hydrate a provider class instance from a shipping_providers row.
 * Adding a new provider = one additional case here.
 */
function instantiateProvider(config: ProviderConfig): ShippingProvider {
  switch (config.name) {
    case 'delhivery':
      return new DelhiveryProvider(config);
    case 'shiprocket':
      return new ShiprocketProvider(config);
    default:
      throw new Error(`[shipping/registry] Unknown provider: ${config.name}`);
  }
}

/**
 * Fetch and instantiate the currently active shipping provider.
 *
 * Returns null when:
 *   - No row in shipping_providers with is_active = true.
 *   - The SHIPPING_NEW_PROVIDER_PIPE env flag is not 'on' (PR 2 gate).
 *
 * Callers must handle the null case and fall back to their existing
 * legacy path until the flag is flipped.
 *
 * Not memoised across requests — each invocation does one DB read.
 * Supabase connection pooling keeps this cheap. Caching added in a
 * later PR when the read volume justifies it.
 */
export async function getActiveProvider(): Promise<ShippingProvider | null> {
  if (process.env.SHIPPING_NEW_PROVIDER_PIPE !== 'on') {
    return null;
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('shipping_providers')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      logEvent('shipping.registry.fetch_failed', { error: error.message }, { source: 'system', severity: 'error' });
      return null;
    }

    if (!data) {
      logEvent('shipping.registry.no_active_provider', {}, { source: 'system', severity: 'warn' });
      return null;
    }

    return instantiateProvider(data as ProviderConfig);
  } catch (err) {
    logEvent(
      'shipping.registry.instantiation_failed',
      { error: err instanceof Error ? err.message : String(err) },
      { source: 'system', severity: 'error' },
    );
    return null;
  }
}

/**
 * Fetch the raw config row for the active provider without instantiating.
 * Used by the diagnostics surface and token-refresh job.
 */
export async function getActiveProviderConfig(): Promise<ProviderConfig | null> {
  if (process.env.SHIPPING_NEW_PROVIDER_PIPE !== 'on') {
    return null;
  }
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('shipping_providers')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();

    if (error || !data) return null;
    return data as ProviderConfig;
  } catch {
    return null;
  }
}
