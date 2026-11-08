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

    // 1. Fetch Postgres-native snapshot using NOW() and Indian Standard Time (IST)
    let snapshot = {
      visitors_right_now: 0,
      visitors_last_15m: 0,
      sessions_today: 0,
      sessions_yesterday: 0,
      active_carts_count: 0,
      active_carts_total_paise: 0,
      checking_out_count: 0,
      orders_today_count: 0,
      orders_today_revenue_paise: 0,
    };

    const { data: snapshotData, error: snapshotError } = await supabase.rpc('get_live_analytics_snapshot');
    if (snapshotError) {
      console.error('[ADMIN_LIVE_ANALYTICS_DB_ERROR] snapshot error:', snapshotError);
    } else if (snapshotData) {
      snapshot = {
        visitors_right_now: Number(snapshotData.visitors_right_now) || 0,
        visitors_last_15m: Number(snapshotData.visitors_last_15m) || 0,
        sessions_today: Number(snapshotData.sessions_today) || 0,
        sessions_yesterday: Number(snapshotData.sessions_yesterday) || 0,
        active_carts_count: Number(snapshotData.active_carts_count) || 0,
        active_carts_total_paise: Number(snapshotData.active_carts_total_paise) || 0,
        checking_out_count: Number(snapshotData.checking_out_count) || 0,
        orders_today_count: Number(snapshotData.orders_today_count) || 0,
        orders_today_revenue_paise: Number(snapshotData.orders_today_revenue_paise) || 0,
      };
    }

    // Comparison against yesterday
    let sessionsVsYesterdayPercent = 0;
    if (snapshot.sessions_yesterday > 0) {
      sessionsVsYesterdayPercent = Math.round(
        ((snapshot.sessions_today - snapshot.sessions_yesterday) / snapshot.sessions_yesterday) * 100
      );
    } else if (snapshot.sessions_today > 0) {
      sessionsVsYesterdayPercent = 100;
    }

    // 2. Fetch recent active sessions for active pages and live stream
    const { data: recentSessionsData, error: recentSessionsError } = await supabase
      .from('visitor_sessions')
      .select('id, current_path, country, state, city, referrer, last_active_at, created_at')
      .order('last_active_at', { ascending: false })
      .limit(60);

    if (recentSessionsError) {
      console.error('[ADMIN_LIVE_ANALYTICS_DB_ERROR] recentSessions query error:', recentSessionsError);
    }

    const recentSessions = recentSessionsData || [];

    // Filter sessions active within the last 5 minutes for active page breakdown
    const nowMs = Date.now();
    const liveThresholdMs = 5 * 60 * 1000;
    const activeSessions = recentSessions.filter((s) => {
      const activeAt = new Date(s.last_active_at).getTime();
      return nowMs - activeAt <= liveThresholdMs;
    });

    // Active pages breakdown
    const pageMap = new Map<string, number>();
    (activeSessions.length > 0 ? activeSessions : recentSessions.slice(0, 10)).forEach((s) => {
      const path = s.current_path || '/';
      pageMap.set(path, (pageMap.get(path) || 0) + 1);
    });

    const topActivePages = Array.from(pageMap.entries())
      .map(([path, visitors]) => ({ path, visitors }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, 8);

    // 3. Geographic location breakdown
    const locationMap = new Map<string, { country: string; state: string; city: string; count: number }>();
    recentSessions.forEach((row) => {
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

    // 4. Recent visitor stream
    const recentVisitors = recentSessions.slice(0, 15).map((v) => ({
      id: v.id,
      path: v.current_path,
      location: `${v.city !== 'Unknown' ? v.city + ', ' : ''}${v.state !== 'Unknown' ? v.state + ', ' : ''}${v.country || 'India'}`,
      lastActiveAt: v.last_active_at,
      createdAt: v.created_at,
      referrer: v.referrer,
    }));

    return apiSuccess({
      visitors_right_now: snapshot.visitors_right_now,
      visitors_last_15m: snapshot.visitors_last_15m,
      sessions_today: snapshot.sessions_today,
      sessions_yesterday: snapshot.sessions_yesterday,
      sessions_vs_yesterday_pct: sessionsVsYesterdayPercent,
      customer_behavior: {
        active_carts_count: snapshot.active_carts_count,
        active_carts_total_paise: snapshot.active_carts_total_paise,
        checking_out_count: snapshot.checking_out_count,
        orders_today_count: snapshot.orders_today_count,
        orders_today_revenue_paise: snapshot.orders_today_revenue_paise,
      },
      sessions_by_location: sessionsByLocationWithBars,
      top_active_pages: topActivePages,
      recent_visitors: recentVisitors,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[ADMIN_LIVE_ANALYTICS_ERROR]', err?.message || err);
    return apiError(500, 'Failed to fetch live analytics');
  }
}
