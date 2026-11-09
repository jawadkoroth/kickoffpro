import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { apiSuccess, apiError } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin-only shipping settings API.
 *
 *   GET   → returns all settings EXCEPT the raw api_key. The client
 *           only sees `api_key_set: boolean` so it can show a
 *           "leave blank to keep existing" affordance without ever
 *           reading the secret back to the browser.
 *   PATCH → admin-verified partial update. An empty/missing api_key
 *           in the payload leaves the stored key untouched.
 *
 * Auth model matches the other admin routes (/api/admin/upload,
 * /api/admin/orders/*): SSR cookie session → `auth.getUser()` →
 * `admin_users` lookup. Service-role client only used for the
 * actual DB read/write.
 */

async function verifyAdmin(): Promise<
  | { ok: true; userId: string; supabase: ReturnType<typeof createAdminClient> }
  | { ok: false; response: Response }
> {
  const serverSupabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await serverSupabase.auth.getUser();

  if (!user) {
    return { ok: false, response: apiError(401, 'Unauthorized') };
  }

  const supabase = createAdminClient();
  const { data: adminUser } = await supabase
    .from('admin_users')
    .select('id')
    .eq('id', user.id)
    .single();

  if (!adminUser) {
    return { ok: false, response: apiError(403, 'Not admin') };
  }

  return { ok: true, userId: user.id, supabase };
}

// Fields safe to read client-side. `api_key` is intentionally omitted.
const READ_COLUMNS = [
  'id',
  'provider_enabled',
  'provider_name',
  'api_url',
  'pickup_name',
  'pickup_phone',
  'pickup_address_line1',
  'pickup_address_line2',
  'pickup_city',
  'pickup_state',
  'pickup_pincode',
  'free_shipping_threshold_paise',
  'default_shipping_charge_paise',
  'cod_enabled',
  'cod_fee_paise',
  'promo_banner_enabled',
  'promo_goal_type',
  'promo_goal_threshold_paise',
  'promo_goal_item_count',
  'promo_progress_template',
  'promo_unlocked_text',
  'promo_nudge_enabled',
  'promo_nudge_title',
  'promo_nudge_badge',
  'promo_nudge_text',
].join(', ');

export async function GET() {
  const auth = await verifyAdmin();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from('shipping_settings')
    .select(`${READ_COLUMNS}, api_key`)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[SHIPPING_SETTINGS_GET]', error);
    return apiError(500, 'Failed to load shipping settings');
  }

  // Strip the raw key before responding; only tell the client
  // whether one is currently set.
  const { api_key, ...rest } = (data ?? {}) as Record<string, unknown>;
  const res = apiSuccess({
    settings: {
      ...rest,
      api_key_set: typeof api_key === 'string' && api_key.trim().length > 0,
    },
  });
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  return res;
}

/* ------------------------------------------------------------------ */
/* PATCH — partial update                                              */
/* ------------------------------------------------------------------ */

interface PatchBody {
  provider_enabled?: boolean;
  provider_name?: string;
  api_url?: string;
  api_key?: string; // empty string / undefined = keep existing
  pickup_name?: string;
  pickup_phone?: string;
  pickup_address_line1?: string;
  pickup_address_line2?: string;
  pickup_city?: string;
  pickup_state?: string;
  pickup_pincode?: string;
  free_shipping_threshold_paise?: number;
  default_shipping_charge_paise?: number;
  cod_enabled?: boolean;
  cod_fee_paise?: number;
}

function toIntOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAdmin();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body || typeof body !== 'object') {
    return apiError(400, 'Invalid request body');
  }

  // Build the update payload field-by-field so that:
  //  - unknown fields from the client are ignored,
  //  - an empty api_key is NOT written (keeps existing value),
  //  - numeric fields coerce safely, negatives reject.
  const update: Record<string, unknown> = {};

  if (typeof body.provider_enabled === 'boolean')
    update.provider_enabled = body.provider_enabled;
  if (typeof body.provider_name === 'string' && body.provider_name.trim())
    update.provider_name = body.provider_name.trim();
  if (typeof body.api_url === 'string')
    update.api_url = toStringOrNull(body.api_url);

  // api_key: only overwrite when a non-empty string is provided.
  if (typeof body.api_key === 'string' && body.api_key.trim().length > 0) {
    update.api_key = body.api_key.trim();
  }

  if (typeof body.pickup_name === 'string')
    update.pickup_name = toStringOrNull(body.pickup_name);
  if (typeof body.pickup_phone === 'string')
    update.pickup_phone = toStringOrNull(body.pickup_phone);
  if (typeof body.pickup_address_line1 === 'string')
    update.pickup_address_line1 = toStringOrNull(body.pickup_address_line1);
  if (typeof body.pickup_address_line2 === 'string')
    update.pickup_address_line2 = toStringOrNull(body.pickup_address_line2);
  if (typeof body.pickup_city === 'string')
    update.pickup_city = toStringOrNull(body.pickup_city);
  if (typeof body.pickup_state === 'string')
    update.pickup_state = toStringOrNull(body.pickup_state);
  if (typeof body.pickup_pincode === 'string')
    update.pickup_pincode = toStringOrNull(body.pickup_pincode);

  if (body.free_shipping_threshold_paise !== undefined) {
    const v = toIntOrNull(body.free_shipping_threshold_paise);
    if (v === null && body.free_shipping_threshold_paise !== 0)
      return apiError(400, 'Invalid free_shipping_threshold_paise');
    update.free_shipping_threshold_paise = v ?? 0;
  }
  if (body.default_shipping_charge_paise !== undefined) {
    const v = toIntOrNull(body.default_shipping_charge_paise);
    if (v === null && body.default_shipping_charge_paise !== 0)
      return apiError(400, 'Invalid default_shipping_charge_paise');
    update.default_shipping_charge_paise = v ?? 0;
  }
  if (typeof body.cod_enabled === 'boolean') update.cod_enabled = body.cod_enabled;
  if (body.cod_fee_paise !== undefined) {
    const v = toIntOrNull(body.cod_fee_paise);
    if (v === null && body.cod_fee_paise !== 0)
      return apiError(400, 'Invalid cod_fee_paise');
    update.cod_fee_paise = v ?? 0;
  }

  // Promotional Drawer & Banner customization
  if (typeof (body as any).promo_banner_enabled === 'boolean') {
    update.promo_banner_enabled = (body as any).promo_banner_enabled;
  }
  if (typeof (body as any).promo_goal_type === 'string') {
    update.promo_goal_type = (body as any).promo_goal_type === 'item_count' ? 'item_count' : 'amount';
  }
  if ((body as any).promo_goal_threshold_paise !== undefined) {
    const v = toIntOrNull((body as any).promo_goal_threshold_paise);
    if (v !== null || (body as any).promo_goal_threshold_paise === 0) {
      update.promo_goal_threshold_paise = v ?? 0;
    }
  }
  if ((body as any).promo_goal_item_count !== undefined) {
    const v = toIntOrNull((body as any).promo_goal_item_count);
    if (v !== null) update.promo_goal_item_count = v;
  }
  if (typeof (body as any).promo_progress_template === 'string') {
    update.promo_progress_template = toStringOrNull((body as any).promo_progress_template) || 'Add {remaining} more to unlock FREE SHIPPING';
  }
  if (typeof (body as any).promo_unlocked_text === 'string') {
    update.promo_unlocked_text = toStringOrNull((body as any).promo_unlocked_text) || 'You unlocked FREE Standard Shipping!';
  }
  if (typeof (body as any).promo_nudge_enabled === 'boolean') {
    update.promo_nudge_enabled = (body as any).promo_nudge_enabled;
  }
  if (typeof (body as any).promo_nudge_title === 'string') {
    update.promo_nudge_title = toStringOrNull((body as any).promo_nudge_title) || 'Pay with UPI & Save {cod_fee}';
  }
  if (typeof (body as any).promo_nudge_badge === 'string') {
    update.promo_nudge_badge = toStringOrNull((body as any).promo_nudge_badge) || 'LOWEST PRICE';
  }
  if (typeof (body as any).promo_nudge_text === 'string') {
    update.promo_nudge_text = toStringOrNull((body as any).promo_nudge_text) || 'Instant UPI avoids the {cod_fee} COD handling charge and guarantees Priority Dispatch within 24 hours.';
  }

  if (Object.keys(update).length === 0) {
    return apiError(400, 'No valid fields to update');
  }

  update.updated_at = new Date().toISOString();

  // The settings table is a singleton. Fetch the one row's id.
  const { data: existing } = await auth.supabase
    .from('shipping_settings')
    .select('id')
    .limit(1)
    .maybeSingle();

  if (!existing?.id) {
    // No row yet — create one with whatever the admin provided.
    const { error: insertErr } = await auth.supabase
      .from('shipping_settings')
      .insert(update);
    if (insertErr) {
      console.error('[SHIPPING_SETTINGS_INSERT]', insertErr);
      return apiError(500, 'Failed to create shipping settings');
    }
  } else {
    const { error: updateErr } = await auth.supabase
      .from('shipping_settings')
      .update(update)
      .eq('id', existing.id);
    if (updateErr) {
      console.error('[SHIPPING_SETTINGS_UPDATE]', updateErr);
      return apiError(500, 'Failed to update shipping settings');
    }
  }

  // Sync state to the new tables to prevent configuration drift
  const { data: finalSettings } = await auth.supabase
    .from('shipping_settings')
    .select('*')
    .limit(1)
    .single();

  if (finalSettings) {
    const providerName = finalSettings.provider_name ?? 'delhivery';
    const providerUpdate: Record<string, any> = {
      name: providerName,
      is_active: finalSettings.provider_enabled ?? false,
      api_url: finalSettings.api_url ?? null,
      pickup_name: finalSettings.pickup_name ?? null,
      pickup_phone: finalSettings.pickup_phone ?? null,
      pickup_line1: finalSettings.pickup_address_line1 ?? null,
      pickup_line2: finalSettings.pickup_address_line2 ?? null,
      pickup_city: finalSettings.pickup_city ?? null,
      pickup_state: finalSettings.pickup_state ?? null,
      pickup_pincode: finalSettings.pickup_pincode ?? null,
      features_cod: finalSettings.cod_enabled ?? true,
    };
    if (finalSettings.api_key) {
      providerUpdate.api_key = finalSettings.api_key;
    }

    const { data: upsertedProvider } = await auth.supabase
      .from('shipping_providers')
      .upsert(providerUpdate, { onConflict: 'name' })
      .select('id')
      .single();

    if (upsertedProvider?.id && finalSettings.provider_enabled) {
      await auth.supabase.rpc('activate_shipping_provider', {
        p_provider_id: upsertedProvider.id,
      });
    }

    // Sync to shipping_pricing_rules
    const pricingUpdate = {
      free_shipping_threshold_paise: finalSettings.free_shipping_threshold_paise ?? 0,
      default_charge_paise: finalSettings.default_shipping_charge_paise ?? 0,
    };
    const { data: existingPricing } = await auth.supabase
      .from('shipping_pricing_rules')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (existingPricing?.id) {
      await auth.supabase
        .from('shipping_pricing_rules')
        .update(pricingUpdate)
        .eq('id', existingPricing.id);
    } else {
      await auth.supabase
        .from('shipping_pricing_rules')
        .insert(pricingUpdate);
    }

    // Sync to cod_rules
    const codUpdate = {
      enabled: finalSettings.cod_enabled ?? true,
      fee_paise: finalSettings.cod_fee_paise ?? 0,
    };
    const { data: existingCod } = await auth.supabase
      .from('cod_rules')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (existingCod?.id) {
      await auth.supabase
        .from('cod_rules')
        .update(codUpdate)
        .eq('id', existingCod.id);
    } else {
      await auth.supabase
        .from('cod_rules')
        .insert(codUpdate);
    }
  }

  return apiSuccess({ updated: true });
}
