import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError } from '@/lib/api-response';
import { calcShipping, type PaymentMethod } from '@/lib/shipping/calcShipping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/shipping/quote
 *
 * Expose public shipping settings (threshold, default charge, cod fee)
 * so storefront components (Cart Drawer, Banner, PDP) can dynamically
 * track free shipping thresholds and calculate savings without requiring
 * hardcoded values.
 */
export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data: settings } = await supabase
      .from('shipping_settings')
      .select(
        'free_shipping_threshold_paise, default_shipping_charge_paise, cod_enabled, cod_fee_paise',
      )
      .limit(1)
      .maybeSingle();

    return apiSuccess({
      free_shipping_threshold_paise: settings?.free_shipping_threshold_paise ?? 99900,
      default_shipping_charge_paise: settings?.default_shipping_charge_paise ?? 9900,
      cod_enabled: settings?.cod_enabled !== false,
      cod_fee_paise: settings?.cod_fee_paise ?? 5000,
    });
  } catch (err) {
    console.error('[SHIPPING_SETTINGS_GET_ERROR]', err);
    return apiError(500, 'Failed to fetch shipping settings');
  }
}

/**
 * POST /api/shipping/quote
 *
 * Estimate shipping + COD fee + total for the checkout & cart UI.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const subtotalPaise = Number(body?.subtotalPaise);
    const paymentMethodRaw = body?.paymentMethod;

    if (!Number.isFinite(subtotalPaise) || subtotalPaise < 0) {
      return apiError(400, 'Invalid subtotalPaise');
    }

    const paymentMethod: PaymentMethod =
      paymentMethodRaw === 'cod' ? 'cod' : 'online';

    const supabase = createAdminClient();
    const { data: settings } = await supabase
      .from('shipping_settings')
      .select(
        'free_shipping_threshold_paise, default_shipping_charge_paise, cod_enabled, cod_fee_paise',
      )
      .limit(1)
      .maybeSingle();

    const result = calcShipping({
      subtotalPaise,
      paymentMethod,
      shippingSettings: settings ?? null,
    });

    return apiSuccess({
      shippingPaise: result.shippingPaise,
      codFeePaise: result.codFeePaise,
      totalPaise: result.totalPaise,
      codAllowed: result.codAllowed,
      codEnabled: settings?.cod_enabled !== false,
      freeShippingThresholdPaise: settings?.free_shipping_threshold_paise ?? 99900,
      defaultShippingChargePaise: settings?.default_shipping_charge_paise ?? 9900,
      codFeePaiseSetting: settings?.cod_fee_paise ?? 5000,
    });
  } catch (err) {
    console.error('[SHIPPING_QUOTE_ERROR]', err);
    return apiError(500, 'Failed to compute shipping quote');
  }
}
