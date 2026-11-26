import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError } from '@/lib/api-response';
import { dispatchOrderNotification } from '@/lib/notifications/orderNotifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/orders/[id]/notify-status
 *
 * Delegates to the shared DB-idempotent order notification dispatcher.
 * Reads authoritative `orders.order_status` + `tracking_id` + `tracking_url`
 * from DB so `"shipped"` never goes out without tracking info and
 * `"shipped"` / `"delivered"` emails are guaranteed single-send.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ssr = await createServerSupabaseClient();
    const {
      data: { user },
    } = await ssr.auth.getUser();

    if (!user) return apiError(401, 'Unauthorized');

    const supabase = createAdminClient();
    const { data: adminUser } = await supabase
      .from('admin_users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (!adminUser) return apiError(403, 'Forbidden');

    const { id } = await params;
    const result = await dispatchOrderNotification({
      orderId: id,
      source: 'notify_status_api',
    });

    if (!result.ok && result.skipped === 'order_not_found') {
      return apiError(404, 'Order not found');
    }

    return apiSuccess({
      notified: result.enqueued,
      skipped: result.skipped ?? null,
    });
  } catch (err) {
    console.error('[notify-status]', err);
    return apiError(500, 'Failed to enqueue notification');
  }
}
