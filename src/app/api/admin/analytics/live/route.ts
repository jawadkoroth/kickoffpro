import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { apiSuccess, apiError } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const host = req.headers.get('host') || '';
    const isLocalhost =
      host.startsWith('localhost:') ||
      host === 'localhost' ||
      host.startsWith('127.0.0.1:') ||
      host === '127.0.0.1';
    const isLocalDevAdmin = process.env.LOCAL_DEV_ADMIN === 'true' && isLocalhost;

    if (!isLocalDevAdmin) {
      const serverSupabase = await createServerSupabaseClient();
      const {
        data: { user },
      } = await serverSupabase.auth.getUser();

      if (!user) return apiError(401, 'Unauthorized');

      const supabaseAdmin = createAdminClient();
      const { data: adminUser } = await supabaseAdmin
        .from('admin_users')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();

      if (!adminUser) return apiError(403, 'Forbidden');
    }

    const supabase = createAdminClient();
    const now = new Date();
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString();

    // 1. Visitors right now (active within last 5 minutes)
    const { data: liveSessionsData } = await supabase
      .from('visitor_sessions')
      .select('id, current_path, country, state, city, referrer, last_active_at, created_at')
      .gte('last_active_at', fiveMinutesAgo)
      .order('last_active_at', { ascending: false });

    const liveSessions = liveSessionsData || [];
    const visitorsRightNow = liveSessions.length;
    const checkingOutCount = liveSessions.filter((s) => s.current_path && s.current_path.startsWith('/checkout')).length;

    // 2. Sessions today and yesterday
    const { count: sessionsTodayCount } = await supabase
      .from('visitor_sessions')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfToday);

    const { count: sessionsYesterdayCount } = await supabase
      .from('visitor_sessions')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfYesterday)
      .lt('created_at', startOfToday);

    const todaySessions = sessionsTodayCount || 0;
    const yesterdaySessions = sessionsYesterdayCount || 0;
    let sessionsVsYesterdayPercent = 0;
    if (yesterdaySessions > 0) {
      sessionsVsYesterdayPercent = Math.round(((todaySessions - yesterdaySessions) / yesterdaySessions) * 100);
    } else if (todaySessions > 0) {
      sessionsVsYesterdayPercent = 100;
    }

    // 3. Active carts tracker (updated in last 15 min with items)
    const { data: activeCartsData } = await supabase
      .from('active_carts_tracker')
      .select('session_id, product_count, cart_total_paise, updated_at')
      .gt('product_count', 0)
      .gte('updated_at', fifteenMinutesAgo);

    const activeCarts = activeCartsData || [];
    const activeCartsCount = activeCarts.length;
    const activeCartsTotalPaise = activeCarts.reduce((sum, c) => sum + (Number(c.cart_total_paise) || 0), 0);

    // 4. Paid orders today
    const { data: ordersTodayData } = await supabase
      .from('orders')
      .select('id, order_number, total_paise, payment_status, created_at')
      .gte('created_at', startOfToday)
      .or('payment_status.eq.paid,payment_status.eq.confirmed,payment_status.eq.cod_confirmed');

    const ordersToday = ordersTodayData || [];
    const ordersTodayCount = ordersToday.length;
    const ordersTodayRevenuePaise = ordersToday.reduce((sum, o) => sum + (Number(o.total_paise) || 0), 0);

    // 5. Geographic location breakdown (last 24 hours)
    const { data: locationSessionsData } = await supabase
      .from('visitor_sessions')
      .select('country, state, city')
      .gte('last_active_at', last24Hours)
      .limit(3000);

    const locationMap = new Map<string, { country: string; state: string; city: string; count: number }>();
    (locationSessionsData || []).forEach((row) => {
      const country = row.country || 'India';
      const state = row.state && row.state !== 'Unknown' ? row.state : 'Other';
      const city = row.city && row.city !== 'Unknown' ? row.city : 'General';
      const key = `${country}|${state}|${city}`;

      const existing = locationMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        locationMap.set(key, { country, state, city, count: 1 });
      }
    });

    const sessionsByLocation = Array.from(locationMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const maxLocationCount = sessionsByLocation[0]?.count || 1;
    const sessionsByLocationWithBars = sessionsByLocation.map((loc) => ({
      ...loc,
      percentage: Math.min(100, Math.round((loc.count / maxLocationCount) * 100)),
    }));

    // 6. Active pages breakdown (from live sessions)
    const pageMap = new Map<string, number>();
    liveSessions.forEach((s) => {
      const path = s.current_path || '/';
      pageMap.set(path, (pageMap.get(path) || 0) + 1);
    });

    const topActivePages = Array.from(pageMap.entries())
      .map(([path, visitors]) => ({ path, visitors }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, 8);

    // 7. Recent visitor stream
    const { data: recentVisitorsData } = await supabase
      .from('visitor_sessions')
      .select('id, current_path, country, state, city, referrer, last_active_at, created_at')
      .order('last_active_at', { ascending: false })
      .limit(15);

    const recentVisitors = (recentVisitorsData || []).map((v) => ({
      id: v.id,
      path: v.current_path,
      location: `${v.city !== 'Unknown' ? v.city + ', ' : ''}${v.state !== 'Unknown' ? v.state + ', ' : ''}${v.country || 'India'}`,
      lastActiveAt: v.last_active_at,
      createdAt: v.created_at,
      referrer: v.referrer,
    }));

    return apiSuccess({
      visitors_right_now: visitorsRightNow,
      sessions_today: todaySessions,
      sessions_yesterday: yesterdaySessions,
      sessions_vs_yesterday_pct: sessionsVsYesterdayPercent,
      customer_behavior: {
        active_carts_count: activeCartsCount,
        active_carts_total_paise: activeCartsTotalPaise,
        checking_out_count: checkingOutCount,
        orders_today_count: ordersTodayCount,
        orders_today_revenue_paise: ordersTodayRevenuePaise,
      },
      sessions_by_location: sessionsByLocationWithBars,
      top_active_pages: topActivePages,
      recent_visitors: recentVisitors,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[ADMIN_LIVE_ANALYTICS_ERROR]', err);
    return apiError(500, 'Failed to fetch live analytics');
  }
}
