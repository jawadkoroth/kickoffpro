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
        'free_shipping_threshold_paise, default_shipping_charge_paise, cod_enabled, cod_fee_paise, promo_banner_enabled, promo_goal_type, promo_goal_threshold_paise, promo_goal_item_count, promo_progress_template, promo_unlocked_text, promo_nudge_enabled, promo_nudge_title, promo_nudge_badge, promo_nudge_text, promo_reward_type, reward_percentage, reward_product_id, buy_x_quantity, get_y_quantity',
      )
      .limit(1)
      .maybeSingle();

    const res = apiSuccess({
      free_shipping_threshold_paise: settings?.free_shipping_threshold_paise ?? 99900,
      default_shipping_charge_paise: settings?.default_shipping_charge_paise ?? 9900,
      cod_enabled: settings?.cod_enabled !== false,
      cod_fee_paise: settings?.cod_fee_paise ?? 5000,
      promo_banner_enabled: settings?.promo_banner_enabled !== false,
      promo_goal_type: settings?.promo_goal_type || 'amount',
      promo_goal_threshold_paise: settings?.promo_goal_threshold_paise ?? settings?.free_shipping_threshold_paise ?? 99900,
      promo_goal_item_count: settings?.promo_goal_item_count ?? 2,
      promo_progress_template: settings?.promo_progress_template || 'Add {remaining} more to unlock FREE SHIPPING',
      promo_unlocked_text: settings?.promo_unlocked_text || 'You unlocked FREE Standard Shipping!',
      promo_nudge_enabled: settings?.promo_nudge_enabled !== false,
      promo_nudge_title: settings?.promo_nudge_title || 'Pay with UPI & Save {cod_fee}',
      promo_nudge_badge: settings?.promo_nudge_badge || 'LOWEST PRICE',
      promo_nudge_text: settings?.promo_nudge_text || 'Instant UPI avoids the {cod_fee} COD handling charge and guarantees Priority Dispatch within 24 hours.',
      promo_reward_type: settings?.promo_reward_type || 'free_shipping',
      reward_percentage: Number(settings?.reward_percentage) || 0,
      reward_product_id: settings?.reward_product_id ?? null,
      buy_x_quantity: settings?.buy_x_quantity ?? 2,
      get_y_quantity: settings?.get_y_quantity ?? 1,
    });
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    return res;
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
        'free_shipping_threshold_paise, default_shipping_charge_paise, cod_enabled, cod_fee_paise, promo_banner_enabled, promo_goal_type, promo_goal_threshold_paise, promo_goal_item_count, promo_progress_template, promo_unlocked_text, promo_nudge_enabled, promo_nudge_title, promo_nudge_badge, promo_nudge_text, promo_reward_type, reward_percentage, reward_product_id, buy_x_quantity, get_y_quantity',
      )
      .limit(1)
      .maybeSingle();

    const result = calcShipping({
      subtotalPaise,
      paymentMethod,
      shippingSettings: settings ?? null,
    });

    const res = apiSuccess({
      shippingPaise: result.shippingPaise,
      codFeePaise: result.codFeePaise,
      totalPaise: result.totalPaise,
      codAllowed: result.codAllowed,
      codEnabled: settings?.cod_enabled !== false,
      freeShippingThresholdPaise: settings?.free_shipping_threshold_paise ?? 99900,
      defaultShippingChargePaise: settings?.default_shipping_charge_paise ?? 9900,
      codFeePaiseSetting: settings?.cod_fee_paise ?? 5000,
      promo_banner_enabled: settings?.promo_banner_enabled !== false,
      promo_goal_type: settings?.promo_goal_type || 'amount',
      promo_goal_threshold_paise: settings?.promo_goal_threshold_paise ?? settings?.free_shipping_threshold_paise ?? 99900,
      promo_goal_item_count: settings?.promo_goal_item_count ?? 2,
      promo_progress_template: settings?.promo_progress_template || 'Add {remaining} more to unlock FREE SHIPPING',
      promo_unlocked_text: settings?.promo_unlocked_text || 'You unlocked FREE Standard Shipping!',
      promo_nudge_enabled: settings?.promo_nudge_enabled !== false,
      promo_nudge_title: settings?.promo_nudge_title || 'Pay with UPI & Save {cod_fee}',
      promo_nudge_badge: settings?.promo_nudge_badge || 'LOWEST PRICE',
      promo_nudge_text: settings?.promo_nudge_text || 'Instant UPI avoids the {cod_fee} COD handling charge and guarantees Priority Dispatch within 24 hours.',
      promo_reward_type: settings?.promo_reward_type || 'free_shipping',
      reward_percentage: Number(settings?.reward_percentage) || 0,
      reward_product_id: settings?.reward_product_id ?? null,
      buy_x_quantity: settings?.buy_x_quantity ?? 2,
      get_y_quantity: settings?.get_y_quantity ?? 1,
    });
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    return res;
  } catch (err) {
    console.error('[SHIPPING_QUOTE_ERROR]', err);
    return apiError(500, 'Failed to compute shipping quote');
  }
}
