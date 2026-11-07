import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

export interface AdsIntegrationsConfig {
  meta_pixel_id: string;
  meta_access_token: string;
  meta_test_event_code: string;
  meta_enabled: boolean;

  google_tag_id: string;
  google_api_secret: string;
  google_enabled: boolean;

  snapchat_pixel_id: string;
  snapchat_api_token: string;
  snapchat_enabled: boolean;
}

export interface MaskedAdsConfig {
  meta_pixel_id: string;
  meta_access_token_masked: string;
  meta_access_token_set: boolean;
  meta_test_event_code: string;
  meta_enabled: boolean;

  google_tag_id: string;
  google_api_secret_masked: string;
  google_api_secret_set: boolean;
  google_enabled: boolean;

  snapchat_pixel_id: string;
  snapchat_api_token_masked: string;
  snapchat_api_token_set: boolean;
  snapchat_enabled: boolean;
}

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

function getEncryptionKey(): Buffer {
  const seed =
    process.env.APP_ENCRYPTION_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'kickoffpro-ads-integrations-secret-salt-2026';
  return crypto.createHash('sha256').update(seed).digest();
}

/**
 * Encrypt a plaintext secret string using AES-256-GCM.
 */
export function encryptSecret(plain: string): string {
  if (!plain || plain.startsWith(PREFIX)) return plain;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plain, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt an AES-256-GCM encrypted secret. Falls back to raw string if not encrypted.
 */
export function decryptSecret(cipherText: string | null | undefined): string {
  if (!cipherText) return '';
  if (!cipherText.startsWith(PREFIX)) return cipherText;

  try {
    const parts = cipherText.slice(PREFIX.length).split(':');
    if (parts.length !== 3) return cipherText;

    const [ivHex, tagHex, encryptedHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[DECRYPT_SECRET_FAILED]', err);
    return '';
  }
}

/**
 * Mask sensitive credentials for secure frontend display (e.g. "EAAB••••••••cdef")
 */
export function maskSecret(secret: string | null | undefined): string {
  if (!secret) return '';
  const s = secret.trim();
  if (s.length <= 8) return '••••••••';
  if (s.length <= 16) return `${s.slice(0, 3)}••••••••${s.slice(-3)}`;
  return `${s.slice(0, 5)}••••••••••••${s.slice(-4)}`;
}

// In-memory cache for high-throughput runtime execution (30-second TTL)
let cachedConfig: AdsIntegrationsConfig | null = null;
let cacheExpiry = 0;

export function invalidateAdsConfigCache(): void {
  cachedConfig = null;
  cacheExpiry = 0;
}

/**
 * Retrieve active ad credentials with automatic fallback to environment variables.
 * Used by server-side CAPI execution handlers.
 */
export async function getActiveAdsConfig(): Promise<AdsIntegrationsConfig> {
  const now = Date.now();
  if (cachedConfig && now < cacheExpiry) {
    return cachedConfig;
  }

  let dbRow: Record<string, any> | null = null;

  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from('ads_integrations_config')
      .select('*')
      .limit(1)
      .maybeSingle();
    dbRow = data;
  } catch (err) {
    console.error('[GET_ADS_CONFIG_DB_ERROR]', err);
  }

  const decryptedMetaToken = decryptSecret(dbRow?.meta_access_token);
  const decryptedGoogleSecret = decryptSecret(dbRow?.google_api_secret);
  const decryptedSnapToken = decryptSecret(dbRow?.snapchat_api_token);

  const config: AdsIntegrationsConfig = {
    // Meta
    meta_pixel_id: (dbRow?.meta_pixel_id || process.env.NEXT_PUBLIC_META_PIXEL_ID || '').trim(),
    meta_access_token: (decryptedMetaToken || process.env.META_CAPI_ACCESS_TOKEN || '').trim(),
    meta_test_event_code: (dbRow?.meta_test_event_code || process.env.META_CAPI_TEST_CODE || '').trim(),
    meta_enabled: dbRow?.meta_enabled !== false,

    // Google
    google_tag_id: (
      dbRow?.google_tag_id ||
      process.env.NEXT_PUBLIC_GOOGLE_TAG_ID ||
      process.env.NEXT_PUBLIC_GA_ID ||
      ''
    ).trim(),
    google_api_secret: (decryptedGoogleSecret || process.env.GA_API_SECRET || '').trim(),
    google_enabled: dbRow?.google_enabled !== false,

    // Snapchat
    snapchat_pixel_id: (dbRow?.snapchat_pixel_id || process.env.NEXT_PUBLIC_SNAP_PIXEL_ID || '').trim(),
    snapchat_api_token: (decryptedSnapToken || process.env.SNAPCHAT_CAPI_TOKEN || '').trim(),
    snapchat_enabled: dbRow?.snapchat_enabled !== false,
  };

  cachedConfig = config;
  cacheExpiry = now + 30_000; // 30s cache

  return config;
}

