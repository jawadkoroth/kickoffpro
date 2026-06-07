/**
 * KickoffPro — Media utility for product images.
 *
 * Provides backward-compatible URL resolution:
 *   - Old absolute URLs (https://...) pass through untouched.
 *   - New relative storage paths are resolved to Supabase Storage
 *     public URLs via the `products` bucket.
 *
 * Upload and delete operations proxy through `/api/admin/upload`
 * which handles authentication and service-role storage access.
 */

/* ------------------------------------------------------------------ */
/* URL Resolution                                                      */
/* ------------------------------------------------------------------ */

/**
 * Resolve a product image path to a public URL.
 *
 *  - Absolute URLs (`http://...`, `https://...`) → returned as-is.
 *  - Relative storage paths → resolved to Supabase Storage public URL.
 *  - Empty / null / undefined → returns empty string.
 */
export function getPublicUrl(path: string | null | undefined): string {
  if (!path) return '';
  const trimmed = path.trim();
  if (!trimmed) return '';

  // Absolute URL — already a full URL, return untouched
  if (trimmed.startsWith('http')) return trimmed;

  // Relative path starting with "/" — site-relative asset (e.g. /product-1.png)
  if (trimmed.startsWith('/')) return trimmed;

  // Supabase storage relative path — construct full public URL
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    console.warn('[MEDIA] NEXT_PUBLIC_SUPABASE_URL not set, cannot resolve storage path:', trimmed);
    return trimmed;
  }

  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/products/${trimmed}`;
}

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

export interface UploadResult {
  url: string;
  path: string;
}

/**
 * Upload a file to product media storage via the admin API.
 *
 * The API handles authentication, validation, and storage operations.
 * Returns the public URL and relative storage path.
 */
export async function uploadFile(
  file: File,
  folder?: string,
): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (folder) {
    formData.append('folder', folder);
  }

  const res = await fetch('/api/admin/upload', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(data.error || `Upload failed (${res.status})`);
  }

  const data = await res.json();
  return { url: data.url, path: data.path };
}

/* ------------------------------------------------------------------ */
/* Delete                                                              */
/* ------------------------------------------------------------------ */

/**
 * Delete a file from product media storage via the admin API.
 *
 * Only deletes Supabase storage paths (not external URLs).
 * The API handles authentication and service-role deletion.
 */
export async function deleteFile(path: string): Promise<void> {
  const res = await fetch('/api/admin/upload', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Delete failed' }));
    throw new Error(data.error || `Delete failed (${res.status})`);
  }
}
