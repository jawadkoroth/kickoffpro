import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError } from '@/lib/api-response';
import { syncShipmentTracking } from '@/lib/shipping/syncShipmentTracking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  if (!row) return { ok: false as const, status: 403, message: 'Forbidden' };
  return { ok: true as const };
}

/**
 * POST /api/admin/orders/[id]/sync-tracking
 *
 * Fetches live courier tracking scans from Shiprocket / Delhivery for an order,
 * updates scan history & courier milestone, and executes idempotent Delivered / RTO transitions.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await gateAdmin();
    if (!gate.ok) return apiError(gate.status, gate.message);

    const { id } = await params;
    const result = await syncShipmentTracking(id, 'admin_action');
    if (!result.ok) {
      return apiError(422, result.error || 'Failed to sync tracking');
    }

    return apiSuccess({ sync: result });
  } catch (err) {
    console.error('[ADMIN_SYNC_TRACKING_ERROR]', err);
    return apiError(500, 'Internal server error');
  }
}
