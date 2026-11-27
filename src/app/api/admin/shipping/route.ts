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
  | {
      ok: true;
      userId: string;
      supabase: ReturnType<typeof createAdminClient>;
      serverSupabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
    }
  | { ok: false; response: Response }
> {
  const serverSupabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await serverSupabase.auth.getUser();

  if (!user) {
    return { ok: false, response: apiError(401, 'Unauthorized') };
  }

  // 1. Check admin_users via user session (respects RLS auth.uid() = id)
  const { data: adminFromSession } = await serverSupabase
    .from('admin_users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  let isAdmin = Boolean(adminFromSession?.id);

  // 2. Fallback to service role client check if available
  const adminClient = createAdminClient();
  if (!isAdmin) {
    const { data: adminFromService } = await adminClient
      .from('admin_users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();
    if (adminFromService?.id) {
      isAdmin = true;
    }
  }

  if (!isAdmin) {
    return { ok: false, response: apiError(403, 'Not admin') };
  }

  return { ok: true, userId: user.id, supabase: adminClient, serverSupabase };
}

// Fields safe to read client-side. `api_key` is intentionally omitted.
const READ_COLUMNS = [
  'id',
  'provider_enabled',
  'provider_name',
  'api_url',
  'auth_email',
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
  'magic_cart_mode',
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
  'promo_reward_type',
  'promo_manual_coupon_code',
  'reward_percentage',
  'reward_product_id',
  'buy_x_quantity',
  'get_y_quantity',
].join(', ');

export async function GET() {
  const auth = await verifyAdmin();
  if (!auth.ok) return auth.response;

  let data: Record<string, unknown> | null = null;
  let error: { code?: string; message?: string } | null = null;

  // 1. Try service role client
  const res1 = await auth.supabase
    .from('shipping_settings')
    .select(`${READ_COLUMNS}, api_key, auth_password, webhook_secret` as '*')
    .limit(1)
    .maybeSingle();

  data = (res1.data as Record<string, unknown> | null) ?? null;
  error = res1.error;

  // 2. If blocked by RLS or error, try serverSupabase (session client with admin credentials)
  if (error || !data) {
    const res2 = await auth.serverSupabase
      .from('shipping_settings')
      .select(`${READ_COLUMNS}, api_key, auth_password, webhook_secret` as '*')
      .limit(1)
      .maybeSingle();
    if (res2.data) {
      data = (res2.data as Record<string, unknown> | null) ?? null;
      error = null;
    } else if (res2.error && !data) {
      error = res2.error;
    }
  }

  // 3. Fallback to SELECT * if a newly deployed column isn't migrated yet so the admin UI stays usable
  if (error && (error.code === '42703' || error.code === 'PGRST204')) {
    console.warn('[SHIPPING_SETTINGS_GET_SCHEMA_FALLBACK]', error.message);
    const fallback = await auth.supabase
      .from('shipping_settings')
      .select('*')
      .limit(1)
      .maybeSingle();
    data = (fallback.data as Record<string, unknown> | null) ?? null;
    error = fallback.error;

    if (error || !data) {
      const fallbackSession = await auth.serverSupabase
        .from('shipping_settings')
        .select('*')
        .limit(1)
        .maybeSingle();
      if (fallbackSession.data) {
        data = (fallbackSession.data as Record<string, unknown> | null) ?? null;
        error = null;
      }
    }
  }

  if (error && !data) {
    console.error('[SHIPPING_SETTINGS_GET]', error);
    return apiError(500, `Failed to load shipping settings: ${error.message}`);
  }

  // Also load per-provider rows so Delhivery & Shiprocket keep separate API URLs,
  // pickup names, and credentials without overwriting each other.
  const { data: providerRows } = await (auth.supabase || auth.serverSupabase)
    .from('shipping_providers')
    .select('name, is_active, api_url, api_key, auth_email, auth_password_encrypted, webhook_secret, pickup_name')
    .in('name', ['delhivery', 'shiprocket']);

  const providers: Record<string, Record<string, unknown>> = {};
  for (const row of providerRows ?? []) {
    providers[row.name] = {
      is_active: Boolean(row.is_active),
      api_url: row.api_url ?? '',
      api_key_set: typeof row.api_key === 'string' && row.api_key.trim().length > 0,
      auth_email: row.auth_email ?? '',
      auth_password_set: typeof row.auth_password_encrypted === 'string' && row.auth_password_encrypted.trim().length > 0,
      webhook_secret_set: typeof row.webhook_secret === 'string' && row.webhook_secret.trim().length > 0,
      pickup_name: row.pickup_name ?? '',
    };
  }

  // Strip raw secrets before responding; only tell the client
  // whether each credential is currently set.
  const { api_key, auth_password, webhook_secret, ...rest } = (data ?? {}) as Record<string, unknown>;
  const res = apiSuccess({
    providers,
    settings: {
      free_shipping_threshold_paise: 99900,
      default_shipping_charge_paise: 9900,
      cod_enabled: true,
      cod_fee_paise: 5000,
      promo_banner_enabled: true,
      promo_goal_type: 'amount',
      promo_goal_threshold_paise: 99900,
      promo_goal_item_count: 2,
      promo_progress_template: 'Add {remaining} more to unlock FREE SHIPPING',
      promo_unlocked_text: 'You unlocked FREE Standard Shipping!',
      promo_nudge_enabled: true,
      promo_nudge_title: 'Pay with UPI & Save {cod_fee}',
      promo_nudge_badge: 'LOWEST PRICE',
      promo_nudge_text: 'Instant UPI avoids the {cod_fee} COD handling charge and guarantees Priority Dispatch within 24 hours.',
      promo_reward_type: 'free_shipping',
      reward_percentage: 10,
      reward_product_id: null,
      buy_x_quantity: 2,
      get_y_quantity: 1,
      ...rest,
      api_key_set: typeof api_key === 'string' && api_key.trim().length > 0,
      auth_password_set: typeof auth_password === 'string' && auth_password.trim().length > 0,
      webhook_secret_set: typeof webhook_secret === 'string' && webhook_secret.trim().length > 0,
    },
  });
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  return res;
}

/* ------------------------------------------------------------------ */
/* PATCH — partial update                                              */
/* ------------------------------------------------------------------ */

interface PatchBody {
  target_provider?: string;
  provider_enabled?: boolean;
  provider_name?: string;
  api_url?: string;
  api_key?: string; // empty string / undefined = keep existing
  auth_email?: string;
  auth_password?: string; // empty string / undefined = keep existing
  webhook_secret?: string; // empty string / undefined = keep existing
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

  // api_key / auth_password / webhook_secret: only overwrite when a non-empty string is provided.
  if (typeof body.api_key === 'string' && body.api_key.trim().length > 0) {
    update.api_key = body.api_key.trim();
  }
  if (typeof body.auth_email === 'string') {
    update.auth_email = toStringOrNull(body.auth_email);
  }
  if (typeof body.auth_password === 'string' && body.auth_password.trim().length > 0) {
    update.auth_password = body.auth_password.trim();
  }
  if (typeof body.webhook_secret === 'string' && body.webhook_secret.trim().length > 0) {
    update.webhook_secret = body.webhook_secret.trim();
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
  if (typeof (body as any).magic_cart_mode === 'string') {
    const mode = (body as any).magic_cart_mode;
    if (mode === 'off' || mode === 'free_shipping' || mode === 'coupon_goal') {
      update.magic_cart_mode = mode;
      update.promo_banner_enabled = mode !== 'off';
      update.promo_reward_type = 'free_shipping';
    }
  }
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
    update.promo_progress_template = toStringOrNull((body as any).promo_progress_template);
  }
  if (typeof (body as any).promo_unlocked_text === 'string') {
    update.promo_unlocked_text = toStringOrNull((body as any).promo_unlocked_text);
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

  // Advanced Multi-Rule Cart Rewards
  if (typeof (body as any).promo_reward_type === 'string') {
    const validRewards = [
      'free_shipping',
      'threshold_percentage',
      'buy_x_get_specific_free',
      'buy_x_get_cheapest_free',
      'manual_coupon_only',
    ];
    const rType = (body as any).promo_reward_type;
    update.promo_reward_type = validRewards.includes(rType) ? rType : 'free_shipping';
  }
  if ((body as any).promo_manual_coupon_code !== undefined) {
    const rawCode = toStringOrNull((body as any).promo_manual_coupon_code);
    update.promo_manual_coupon_code = rawCode ? rawCode.toUpperCase() : null;
  }
  if ((body as any).reward_percentage !== undefined) {
    const p = Number((body as any).reward_percentage);
    update.reward_percentage = Number.isFinite(p) && p >= 0 && p <= 100 ? p : 0;
  }
  if ((body as any).reward_product_id !== undefined) {
    update.reward_product_id = toStringOrNull((body as any).reward_product_id);
  }
  if ((body as any).buy_x_quantity !== undefined) {
    const bx = toIntOrNull((body as any).buy_x_quantity);
    if (bx !== null) update.buy_x_quantity = Math.max(1, bx);
  }
  if ((body as any).get_y_quantity !== undefined) {
    const gy = toIntOrNull((body as any).get_y_quantity);
    if (gy !== null) update.get_y_quantity = Math.max(1, gy);
  }

  if (Object.keys(update).length === 0) {
    return apiError(400, 'No valid fields to update');
  }

  update.updated_at = new Date().toISOString();

  // The settings table is a singleton. Fetch the one row's id.
  let existingId: string | null = null;
  const { data: existingService } = await auth.supabase
    .from('shipping_settings')
    .select('id')
    .limit(1)
    .maybeSingle();

  if (existingService?.id) {
    existingId = existingService.id;
  } else {
    const { data: existingSession } = await auth.serverSupabase
      .from('shipping_settings')
      .select('id')
      .limit(1)
      .maybeSingle();
    if (existingSession?.id) {
      existingId = existingSession.id;
    }
  }

  let writeError: { message?: string; code?: string } | null = null;

  if (!existingId) {
    // No row yet — create one with whatever the admin provided.
    let res = await auth.supabase
      .from('shipping_settings')
      .insert(update);
    if (res.error) {
      res = await auth.serverSupabase
        .from('shipping_settings')
        .insert(update);
    }
    if (res.error) {
      writeError = res.error;
    }
  } else {
    let res = await auth.supabase
      .from('shipping_settings')
      .update(update)
      .eq('id', existingId);
    if (res.error) {
      res = await auth.serverSupabase
        .from('shipping_settings')
        .update(update)
        .eq('id', existingId);
    }
    if (res.error) {
      writeError = res.error;
    }
  }

  if (writeError) {
    console.error('[SHIPPING_SETTINGS_SAVE_ERROR]', writeError);
    return apiError(500, `Failed to update shipping settings: ${writeError.message || 'Database write error'}`);
  }

  // Best-effort sync to secondary/legacy tables (shipping_providers, shipping_pricing_rules, cod_rules)
  try {
    const { data: finalSettings } = await (auth.supabase || auth.serverSupabase)
      .from('shipping_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (finalSettings) {
      const targetProvider =
        typeof body.target_provider === 'string' && body.target_provider.trim()
          ? body.target_provider.trim().toLowerCase()
          : (finalSettings.provider_name ?? 'delhivery');
      const providerUpdate: Record<string, any> = {
        name: targetProvider,
        is_active: Boolean(finalSettings.provider_enabled) && finalSettings.provider_name === targetProvider,
        environment: 'live',
        api_url: (typeof body.api_url === 'string' ? body.api_url.trim() : finalSettings.api_url) ?? null,
        auth_email: (typeof body.auth_email === 'string' ? body.auth_email.trim() : finalSettings.auth_email) ?? null,
        pickup_name: (typeof body.pickup_name === 'string' ? body.pickup_name.trim() : finalSettings.pickup_name) ?? null,
        pickup_phone: finalSettings.pickup_phone ?? null,
        pickup_line1: finalSettings.pickup_address_line1 ?? null,
        pickup_line2: finalSettings.pickup_address_line2 ?? null,
        pickup_city: finalSettings.pickup_city ?? null,
        pickup_state: finalSettings.pickup_state ?? null,
        pickup_pincode: finalSettings.pickup_pincode ?? null,
        features_cod: finalSettings.cod_enabled ?? true,
      };
      if (typeof body.api_key === 'string' && body.api_key.trim().length > 0) {
        providerUpdate.api_key = body.api_key.trim();
      } else if (targetProvider === finalSettings.provider_name && finalSettings.api_key) {
        providerUpdate.api_key = finalSettings.api_key;
      }
      if (typeof body.auth_password === 'string' && body.auth_password.trim().length > 0) {
        providerUpdate.auth_password_encrypted = body.auth_password.trim();
      } else if (targetProvider === finalSettings.provider_name && finalSettings.auth_password) {
        providerUpdate.auth_password_encrypted = finalSettings.auth_password;
      }
      if (typeof body.webhook_secret === 'string' && body.webhook_secret.trim().length > 0) {
        providerUpdate.webhook_secret = body.webhook_secret.trim();
      } else if (targetProvider === finalSettings.provider_name && finalSettings.webhook_secret) {
        providerUpdate.webhook_secret = finalSettings.webhook_secret;
      }
      // If Shiprocket auth credentials changed, clear cached JWT so next call logs in cleanly
      if (targetProvider === 'shiprocket' && (body.auth_email !== undefined || body.auth_password)) {
        providerUpdate.token = null;
        providerUpdate.token_expires_at = null;
      }

      const { data: upsertedProvider } = await (auth.supabase || auth.serverSupabase)
        .from('shipping_providers')
        .upsert(providerUpdate, { onConflict: 'name' })
        .select('id')
        .maybeSingle();

      if (upsertedProvider?.id && finalSettings.provider_enabled && finalSettings.provider_name === targetProvider) {
        try {
          await (auth.supabase || auth.serverSupabase).rpc('activate_shipping_provider', {
            p_provider_id: upsertedProvider.id,
          });
        } catch (rpcErr) {
          console.warn('[ACTIVATE_SHIPPING_PROVIDER_RPC_WARN]', rpcErr);
        }
      }

      // Sync to shipping_pricing_rules
      const pricingUpdate = {
        free_shipping_threshold_paise: finalSettings.free_shipping_threshold_paise ?? 0,
        default_charge_paise: finalSettings.default_shipping_charge_paise ?? 0,
      };
      const { data: existingPricing } = await (auth.supabase || auth.serverSupabase)
        .from('shipping_pricing_rules')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (existingPricing?.id) {
        await (auth.supabase || auth.serverSupabase)
          .from('shipping_pricing_rules')
          .update(pricingUpdate)
          .eq('id', existingPricing.id);
      } else {
        await (auth.supabase || auth.serverSupabase)
          .from('shipping_pricing_rules')
          .insert(pricingUpdate);
      }

      // Sync to cod_rules
      const codUpdate = {
        enabled: finalSettings.cod_enabled ?? true,
        fee_paise: finalSettings.cod_fee_paise ?? 0,
      };
      const { data: existingCod } = await (auth.supabase || auth.serverSupabase)
        .from('cod_rules')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (existingCod?.id) {
        await (auth.supabase || auth.serverSupabase)
          .from('cod_rules')
          .update(codUpdate)
          .eq('id', existingCod.id);
      } else {
        await (auth.supabase || auth.serverSupabase)
          .from('cod_rules')
          .insert(codUpdate);
      }
    }
  } catch (syncErr) {
    console.warn('[SHIPPING_SECONDARY_SYNC_WARN]', syncErr);
  }

  return apiSuccess({ updated: true });
}
