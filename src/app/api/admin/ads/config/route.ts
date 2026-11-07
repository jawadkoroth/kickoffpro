import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
  invalidateAdsConfigCache,
  getActiveAdsConfig,
} from '@/lib/tracking/credentials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function verifyAdmin(): Promise<
  | { ok: true; userId: string; supabase: ReturnType<typeof createAdminClient> }
  | { ok: false; response: Response }
> {
  const host = (typeof window === 'undefined' ? '' : window.location.host);
  const isLocalhost =
    host.startsWith('localhost:') ||
    host === 'localhost' ||
    host.startsWith('127.0.0.1:') ||
    host === '127.0.0.1';
  const isLocalDevAdmin = process.env.LOCAL_DEV_ADMIN === 'true' && isLocalhost;

  if (isLocalDevAdmin) {
    return { ok: true, userId: 'local-dev-admin', supabase: createAdminClient() };
  }

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
    .maybeSingle();

  if (!adminUser) {
    return { ok: false, response: apiError(403, 'Forbidden') };
  }

  return { ok: true, userId: user.id, supabase };
}

/**
 * GET /api/admin/ads/config
 * Returns active settings with all sensitive tokens safely masked.
 */
export async function GET() {
  const auth = await verifyAdmin();
  if (!auth.ok) return auth.response;

  try {
    const supabase = auth.supabase;
    const { data: row } = await supabase
      .from('ads_integrations_config')
      .select('*')
      .limit(1)
      .maybeSingle();

    // Active tokens with fallback to process.env
    const metaTokenRaw = decryptSecret(row?.meta_access_token) || process.env.META_CAPI_ACCESS_TOKEN || '';
    const googleSecretRaw = decryptSecret(row?.google_api_secret) || process.env.GA_API_SECRET || '';
    const snapTokenRaw = decryptSecret(row?.snapchat_api_token) || process.env.SNAPCHAT_CAPI_TOKEN || '';

    const metaPixelId = (row?.meta_pixel_id || process.env.NEXT_PUBLIC_META_PIXEL_ID || '').trim();
    const googleTagId = (
      row?.google_tag_id ||
      process.env.NEXT_PUBLIC_GOOGLE_TAG_ID ||
      process.env.NEXT_PUBLIC_GA_ID ||
      ''
    ).trim();
    const snapPixelId = (row?.snapchat_pixel_id || process.env.NEXT_PUBLIC_SNAP_PIXEL_ID || '').trim();

    return apiSuccess({
      meta_pixel_id: metaPixelId,
      meta_access_token_masked: maskSecret(metaTokenRaw),
      meta_access_token_set: Boolean(metaTokenRaw),
      meta_test_event_code: (row?.meta_test_event_code || process.env.META_CAPI_TEST_CODE || '').trim(),
      meta_enabled: row?.meta_enabled !== false,

      google_tag_id: googleTagId,
      google_api_secret_masked: maskSecret(googleSecretRaw),
      google_api_secret_set: Boolean(googleSecretRaw),
      google_enabled: row?.google_enabled !== false,

      snapchat_pixel_id: snapPixelId,
      snapchat_api_token_masked: maskSecret(snapTokenRaw),
      snapchat_api_token_set: Boolean(snapTokenRaw),
      snapchat_enabled: row?.snapchat_enabled !== false,

      updated_at: row?.updated_at || null,
    });
  } catch (err) {
    console.error('[ADMIN_ADS_CONFIG_GET_ERROR]', err);
    return apiError(500, 'Failed to fetch ads configuration');
  }
}

/**
 * POST /api/admin/ads/config
 * Persists updated credentials securely (encrypting tokens with AES-256-GCM).
 */
export async function POST(req: NextRequest) {
  const auth = await verifyAdmin();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return apiError(400, 'Invalid request body');
    }

    const supabase = auth.supabase;

    // Fetch existing row to preserve secrets if masked or unedited
    const { data: existing } = await supabase
      .from('ads_integrations_config')
      .select('*')
      .limit(1)
      .maybeSingle();

    const isMaskedOrBlank = (val?: string) => !val || val.includes('••') || val.trim() === '';

    // Handle Meta
    let metaTokenToSave = existing?.meta_access_token || '';
    if (body.meta_access_token && !isMaskedOrBlank(body.meta_access_token)) {
      metaTokenToSave = encryptSecret(body.meta_access_token.trim());
    }

    // Handle Google
    let googleSecretToSave = existing?.google_api_secret || '';
    if (body.google_api_secret && !isMaskedOrBlank(body.google_api_secret)) {
      googleSecretToSave = encryptSecret(body.google_api_secret.trim());
    }

    // Handle Snapchat
    let snapTokenToSave = existing?.snapchat_api_token || '';
    if (body.snapchat_api_token && !isMaskedOrBlank(body.snapchat_api_token)) {
      snapTokenToSave = encryptSecret(body.snapchat_api_token.trim());
    }

    const updatePayload: Record<string, any> = {
      meta_pixel_id: body.meta_pixel_id !== undefined ? String(body.meta_pixel_id).trim() : existing?.meta_pixel_id ?? '',
      meta_access_token: metaTokenToSave,
      meta_test_event_code: body.meta_test_event_code !== undefined ? String(body.meta_test_event_code).trim() : existing?.meta_test_event_code ?? '',
      meta_enabled: body.meta_enabled !== undefined ? Boolean(body.meta_enabled) : existing?.meta_enabled !== false,

      google_tag_id: body.google_tag_id !== undefined ? String(body.google_tag_id).trim() : existing?.google_tag_id ?? '',
      google_api_secret: googleSecretToSave,
      google_enabled: body.google_enabled !== undefined ? Boolean(body.google_enabled) : existing?.google_enabled !== false,

      snapchat_pixel_id: body.snapchat_pixel_id !== undefined ? String(body.snapchat_pixel_id).trim() : existing?.snapchat_pixel_id ?? '',
      snapchat_api_token: snapTokenToSave,
      snapchat_enabled: body.snapchat_enabled !== undefined ? Boolean(body.snapchat_enabled) : existing?.snapchat_enabled !== false,

      updated_at: new Date().toISOString(),
    };

    const rowId = existing?.id || '00000000-0000-0000-0000-000000000001';

    const { error: upsertErr } = await supabase
      .from('ads_integrations_config')
      .upsert({ id: rowId, ...updatePayload });

    if (upsertErr) {
      console.error('[ADMIN_ADS_CONFIG_UPSERT_ERROR]', upsertErr);
      return apiError(500, 'Failed to save ads configuration');
    }

    // Bust runtime cache immediately so new credentials are live
    invalidateAdsConfigCache();

    // Perform Connection Diagnostics if test_connection requested
    const testResults: Record<string, { ok: boolean; message: string }> = {};

    if (body.test_connection) {
      const active = await getActiveAdsConfig();

      // Test Meta
      if (active.meta_enabled) {
        if (!active.meta_pixel_id || !active.meta_access_token) {
          testResults.meta = { ok: false, message: 'Pixel ID or Access Token is missing' };
        } else {
          try {
            const testUrl = `https://graph.facebook.com/v19.0/${active.meta_pixel_id}?access_token=${encodeURIComponent(active.meta_access_token)}&fields=id,name`;
            const fbRes = await fetch(testUrl);
            const fbJson = await fbRes.json();
            if (fbRes.ok && fbJson.id) {
              testResults.meta = { ok: true, message: `Connected to Meta Pixel (${fbJson.name || fbJson.id})` };
            } else {
              testResults.meta = {
                ok: false,
                message: fbJson.error?.message || 'Meta API rejected credentials',
              };
            }
          } catch (e: any) {
            testResults.meta = { ok: false, message: `Connection error: ${e.message || String(e)}` };
          }
        }
      } else {
        testResults.meta = { ok: true, message: 'Meta disabled' };
      }

      // Test Google
      if (active.google_enabled) {
        if (!active.google_tag_id || !active.google_api_secret) {
          testResults.google = { ok: false, message: 'Measurement ID or API Secret is missing' };
        } else {
          // Send validation hit to GA4 Measurement Protocol debug endpoint
          try {
            const gaDebugUrl = `https://www.google-analytics.com/debug/mp/collect?measurement_id=${active.google_tag_id}&api_secret=${active.google_api_secret}`;
            const gaRes = await fetch(gaDebugUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                client_id: 'test_client_001',
                events: [{ name: 'test_connection' }],
              }),
            });
            const gaJson = await gaRes.json();
            const validationMessages = gaJson?.validationMessages || [];
            if (validationMessages.length === 0) {
              testResults.google = { ok: true, message: 'GA4 Enhanced Conversions credentials verified' };
            } else {
              testResults.google = {
                ok: false,
                message: validationMessages[0]?.description || 'Google validation warning',
              };
            }
          } catch (e: any) {
            testResults.google = { ok: false, message: `Google API test error: ${e.message || String(e)}` };
          }
        }
      } else {
        testResults.google = { ok: true, message: 'Google disabled' };
      }

      // Test Snapchat
      if (active.snapchat_enabled) {
        if (!active.snapchat_pixel_id || !active.snapchat_api_token) {
          testResults.snapchat = { ok: false, message: 'Pixel ID or CAPI Token is missing' };
        } else {
          testResults.snapchat = { ok: true, message: 'Snapchat credentials syntax validated' };
        }
      } else {
        testResults.snapchat = { ok: true, message: 'Snapchat disabled' };
      }
    }

    return apiSuccess({
      saved: true,
      testResults: body.test_connection ? testResults : undefined,
    });
  } catch (err) {
    console.error('[ADMIN_ADS_CONFIG_POST_ERROR]', err);
    return apiError(500, 'Internal server error while saving ads configuration');
  }
}

