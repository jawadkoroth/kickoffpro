import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyAdmins, isPushConfigured } from '@/lib/push/webPush';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/push/test
 *
 * Fires a one-shot push to every admin subscription so an operator
 * can verify the full pipeline end-to-end without placing a real
 * order. Returns the fan-out counts from `notifyAdmins` so the
 * caller can confirm that at least one subscription was reached.
 *
 * Admin-only. Returns 404 when web push is not configured on the
 * server so the UI can quietly hide the test button.
 */

async function gateAdmin() {
  const ssr = await createServerSupabaseClient();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  if (!user) return { ok: false as const, status: 401, message: 'Unauthorized' };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('admin_users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();
  if (!row) return { ok: false as const, status: 403, message: 'Not admin' };
  return { ok: true as const, admin };
}

export async function POST(_req: NextRequest) {
  if (!isPushConfigured()) {
    return apiError(404, 'Web push is not configured on this server');
  }
  const gate = await gateAdmin();
  if (!gate.ok) return apiError(gate.status, gate.message);

  const result = await notifyAdmins(gate.admin, {
    title: 'KickoffPro — test notification',
    body: 'If you see this, your push pipeline is live.',
    url: '/admin/dashboard',
    tag: `push-test-${Date.now()}`,
  });

  return apiSuccess({
    sent: result.sent,
    pruned: result.pruned,
    errored: result.errored,
  });
}
