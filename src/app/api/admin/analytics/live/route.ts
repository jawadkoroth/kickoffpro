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

    let authUserId: string | null = null;
    if (!isLocalDevAdmin) {
      const serverSupabase = await createServerSupabaseClient();
      const {
        data: { user },
      } = await serverSupabase.auth.getUser();

      if (!user) return apiError(401, 'Unauthorized');
      authUserId = user.id;

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
    const nowMs = now.getTime();

    // Calculate Indian Standard Time (IST) midnight boundaries
    let startOfTodayISO: string;
    let startOfYesterdayISO: string;
    try {
      const istFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const istTodayStr = istFormatter.format(now);
      startOfTodayISO = new Date(`${istTodayStr}T00:00:00+05:30`).toISOString();

      const yesterday = new Date(nowMs - 24 * 60 * 60 * 1000);
      const istYesterdayStr = istFormatter.format(yesterday);
      startOfYesterdayISO = new Date(`${istYesterdayStr}T00:00:00+05:30`).toISOString();
    } catch {
      startOfTodayISO = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      startOfYesterdayISO = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString();
    }

    // 1. Always fetch direct rows from visitor_sessions as baseline and fallback
    const { data: directSessionsData, error: directSessionsError } = await supabase
      .from('visitor_sessions')
      .select('id, current_path, country, state, city, referrer, last_active_at, created_at')
      .order('last_active_at', { ascending: false })
      .limit(100);

    if (directSessionsError) {
      console.error('[ADMIN_LIVE_ANALYTICS_DB_ERROR] directSessions query error:', directSessionsError);
    }

    const directSessions = directSessionsData || [];

    // Calculate fallback metrics from direct rows
    const liveThresholdMs = 5 * 60 * 1000;
    const fifteenMinThresholdMs = 15 * 60 * 1000;
    const startOfTodayMs = new Date(startOfTodayISO).getTime();
    const startOfYesterdayMs = new Date(startOfYesterdayISO).getTime();

    const fallbackVisitorsRightNow = directSessions.filter((s) => {
      const activeAt = new Date(s.last_active_at).getTime();
      return nowMs - activeAt <= liveThresholdMs;
    }).length;

    const fallbackVisitorsLast15m = directSessions.filter((s) => {
      const activeAt = new Date(s.last_active_at).getTime();
      return nowMs - activeAt <= fifteenMinThresholdMs;
    }).length;

    const fallbackSessionsToday = directSessions.filter((s) => {
      const activeAt = new Date(s.last_active_at).getTime();
      return activeAt >= startOfTodayMs;
    }).length;

    const fallbackSessionsYesterday = directSessions.filter((s) => {
      const activeAt = new Date(s.last_active_at).getTime();
      return activeAt >= startOfYesterdayMs && activeAt < startOfTodayMs;
    }).length;

    const fallbackCheckingOut = directSessions.filter((s) => {
      const activeAt = new Date(s.last_active_at).getTime();
      return nowMs - activeAt <= liveThresholdMs && s.current_path && s.current_path.startsWith('/checkout');
    }).length;

    // 2. Fetch Postgres-native snapshot function
    let snapshot = {
      visitors_right_now: fallbackVisitorsRightNow,
      visitors_last_15m: fallbackVisitorsLast15m,
      sessions_today: fallbackSessionsToday,
      sessions_yesterday: fallbackSessionsYesterday,
      active_carts_count: 0,
      active_carts_total_paise: 0,
      checking_out_count: fallbackCheckingOut,
      orders_today_count: 0,
      orders_today_revenue_paise: 0,
    };

    let snapshotSuccess = false;
    let snapshotErrorMessage: string | null = null;

    try {
      const { data: snapshotData, error: snapshotError } = await supabase.rpc('get_live_analytics_snapshot');
      if (snapshotError) {
        snapshotErrorMessage = snapshotError.message;
        console.warn('[ADMIN_LIVE_ANALYTICS] Snapshot RPC failed, using direct query fallback:', snapshotError.message);
      } else if (snapshotData) {
        snapshotSuccess = true;
        snapshot = {
          visitors_right_now: Math.max(Number(snapshotData.visitors_right_now) || 0, fallbackVisitorsRightNow),
          visitors_last_15m: Math.max(Number(snapshotData.visitors_last_15m) || 0, fallbackVisitorsLast15m),
          sessions_today: Math.max(Number(snapshotData.sessions_today) || 0, fallbackSessionsToday),
          sessions_yesterday: Math.max(Number(snapshotData.sessions_yesterday) || 0, fallbackSessionsYesterday),
          active_carts_count: Number(snapshotData.active_carts_count) || 0,
          active_carts_total_paise: Number(snapshotData.active_carts_total_paise) || 0,
          checking_out_count: Math.max(Number(snapshotData.checking_out_count) || 0, fallbackCheckingOut),
          orders_today_count: Number(snapshotData.orders_today_count) || 0,
          orders_today_revenue_paise: Number(snapshotData.orders_today_revenue_paise) || 0,
        };
      }
    } catch (rpcErr: any) {
      snapshotErrorMessage = rpcErr?.message || 'RPC execution error';
    }

    // 3. Direct active carts query fallback if snapshot returned 0 carts
    if (snapshot.active_carts_count === 0) {
      const fifteenMinAgoISO = new Date(nowMs - fifteenMinThresholdMs).toISOString();
      const { data: directCarts } = await supabase
        .from('active_carts_tracker')
        .select('session_id, product_count, cart_total_paise, updated_at')
        .gt('product_count', 0)
        .gte('updated_at', fifteenMinAgoISO);

      if (directCarts && directCarts.length > 0) {
        snapshot.active_carts_count = directCarts.length;
        snapshot.active_carts_total_paise = directCarts.reduce(
          (sum, c) => sum + (Number(c.cart_total_paise) || 0),
          0
        );
      }
    }

    // 4. Direct paid orders today fallback
    if (snapshot.orders_today_count === 0) {
      const { data: directOrders } = await supabase
        .from('orders')
        .select('id, total_paise')
        .gte('created_at', startOfTodayISO)
        .or('payment_status.eq.paid,payment_status.eq.confirmed,payment_status.eq.cod_confirmed');

      if (directOrders && directOrders.length > 0) {
        snapshot.orders_today_count = directOrders.length;
        snapshot.orders_today_revenue_paise = directOrders.reduce(
          (sum, o) => sum + (Number(o.total_paise) || 0),
          0
        );
      }
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

    // 5. Active pages breakdown
    const activeSessions = directSessions.filter((s) => {
      const activeAt = new Date(s.last_active_at).getTime();
      return nowMs - activeAt <= liveThresholdMs;
    });

    const pageMap = new Map<string, number>();
    (activeSessions.length > 0 ? activeSessions : directSessions.slice(0, 10)).forEach((s) => {
      const path = s.current_path || '/';
      pageMap.set(path, (pageMap.get(path) || 0) + 1);
    });

    const topActivePages = Array.from(pageMap.entries())
      .map(([path, visitors]) => ({ path, visitors }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, 8);

    // 6. Geographic location breakdown
    const locationMap = new Map<string, { country: string; state: string; city: string; count: number }>();
    directSessions.forEach((row) => {
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

    // 7. Recent visitor stream
    const recentVisitors = directSessions.slice(0, 15).map((v) => ({
      id: v.id,
      path: v.current_path,
      location: `${v.city !== 'Unknown' ? v.city + ', ' : ''}${v.state !== 'Unknown' ? v.state + ', ' : ''}${v.country || 'India'}`,
      lastActiveAt: v.last_active_at,
      createdAt: v.created_at,
      referrer: v.referrer,
    }));

    const projectRef = (process.env.NEXT_PUBLIC_SUPABASE_URL || '')
      .replace(/https?:\/\//, '')
      .split('.')[0];

    const hasServiceKey = Boolean(
      process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY.length > 20
    );

    const diagnostic = {
      supabase_project_ref: projectRef,
      has_service_role_key: hasServiceKey,
      total_sessions_in_db: directSessions.length,
      snapshot_rpc_success: snapshotSuccess,
      snapshot_rpc_error: snapshotErrorMessage,
      server_time_iso: now.toISOString(),
      auth_user_id: authUserId,
      most_recent_session: directSessions[0]
        ? {
            id: directSessions[0].id.slice(0, 8) + '...',
            path: directSessions[0].current_path,
            city: directSessions[0].city,
            last_active_at: directSessions[0].last_active_at,
            seconds_ago: Math.round((nowMs - new Date(directSessions[0].last_active_at).getTime()) / 1000),
          }
        : null,
    };

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
      diagnostic,
      timestamp: now.toISOString(),
    });
  } catch (err: any) {
    console.error('[ADMIN_LIVE_ANALYTICS_ERROR]', err?.message || err);
    return apiError(500, err?.message || 'Failed to fetch live analytics');
  }
}
