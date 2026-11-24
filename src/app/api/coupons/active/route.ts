import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * GET /api/coupons/active
 *
 * Returns currently active, non-expired public coupons so the Cart Drawer
 * can render one-click "Apply" chips without exposing private/single-use codes.
 */
export async function GET() {
  try {
    const supabase = createAdminClient();
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from('coupons')
      .select('id, code, discount_percent, min_cart_paise, max_discount_paise, starts_at, expires_at, new_users_only')
      .eq('is_active', true)
      .order('discount_percent', { ascending: false })
      .limit(10);

    if (error) {
      return apiError(500, 'Failed to fetch active coupons');
    }

    const activeCoupons = (data ?? []).filter((c) => {
      if (c.new_users_only) return false;
      if (c.starts_at && c.starts_at > nowIso) return false;
      if (c.expires_at && c.expires_at <= nowIso) return false;
      return true;
    }).slice(0, 4);

    return NextResponse.json(
      { success: true, coupons: activeCoupons },
      {
        status: 200,
        headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
      },
    );
  } catch (err) {
    console.error('[ACTIVE_COUPONS_ERROR]', err);
    return apiError(500, 'Internal server error');
  }
}
