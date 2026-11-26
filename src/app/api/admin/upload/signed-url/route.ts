import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { apiSuccess, apiError } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

const MAX_VIDEO_SIZE_BYTES = 35 * 1024 * 1024; // 35 MB direct-to-storage cap

function videoExtFor(mime: string): string {
  if (mime === 'video/webm') return 'webm';
  if (mime === 'video/quicktime') return 'mov';
  return 'mp4';
}

export async function POST(req: NextRequest) {
  try {
    const serverSupabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await serverSupabase.auth.getUser();

    if (!user) return apiError(401, 'Unauthorized');

    const supabase = createAdminClient();
    const { data: adminUser } = await supabase
      .from('admin_users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (!adminUser) return apiError(403, 'Not admin');

    const body = (await req.json().catch(() => null)) as {
      contentType?: string;
      fileSize?: number;
      folder?: string;
    } | null;

    const contentType = (body?.contentType || '').toLowerCase();
    const fileSize = Number(body?.fileSize || 0);
    const rawFolder = body?.folder || 'videos';
    const folder = rawFolder.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'videos';

    if (!ALLOWED_VIDEO_TYPES.has(contentType)) {
      return apiError(400, 'Invalid video format. Allowed: MP4, WebM, MOV');
    }

    if (fileSize <= 0 || fileSize > MAX_VIDEO_SIZE_BYTES) {
      return apiError(400, 'Video size must be between 1 byte and 35 MB');
    }

    const storagePath = `${folder}/${crypto.randomUUID()}.${videoExtFor(contentType)}`;
    const { data, error } = await supabase.storage
      .from('products')
      .createSignedUploadUrl(storagePath);

    if (error || !data?.signedUrl) {
      console.error('[SIGNED_UPLOAD_ERR]', error);
      return apiError(500, error?.message || 'Failed to create signed upload URL');
    }

    const { data: pub } = supabase.storage.from('products').getPublicUrl(storagePath);

    return apiSuccess({
      signedUrl: data.signedUrl,
      token: data.token,
      path: storagePath,
      publicUrl: pub.publicUrl,
    });
  } catch (err) {
    console.error('[SIGNED_UPLOAD_INTERNAL_ERR]', err);
    return apiError(500, 'Internal server error');
  }
}
