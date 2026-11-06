import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { apiSuccess, apiError } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CampaignRow {
  source: string;
  medium: string;
  campaign: string;
  totalCheckouts: number;
  paidOrders: number;
  abandonedOrders: number;
  conversionRate: number;
  revenuePaise: number;
  aovPaise: number;
  prepaidCount: number;
  codCount: number;
}

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

    // 1. Fetch Orders with Attribution & Payment Details
    const { data: rawOrders, error: ordersError } = await supabase
      .from('orders')
      .select(
        'id, order_number, total_paise, payment_method, payment_status, order_status, created_at, utm_source, utm_medium, utm_campaign, attribution_data, tracking_event_id',
      )
      .order('created_at', { ascending: false })
      .limit(2000);

    if (ordersError) {
      return apiError(500, 'Failed to fetch orders for ad attribution');
    }

    const orders = rawOrders || [];

    // 2. Fetch CAPI Jobs from job_queue
    const { data: rawJobs } = await supabase
      .from('job_queue')
      .select('id, kind, status, attempts, max_attempts, last_error, run_at, created_at, updated_at')
      .eq('kind', 'tracking.capi_purchase')
      .order('created_at', { ascending: false })
      .limit(100);

    const capiJobs = rawJobs || [];

    // 3. Fetch CAPI Logs from app_events
    const { data: rawAppEvents } = await supabase
      .from('app_events')
      .select('id, event, data, severity, created_at')
      .like('event', 'tracking.capi%')
      .order('created_at', { ascending: false })
      .limit(100);

    const appEvents = rawAppEvents || [];

    // 4. Compute High-Level Metrics
    let grossSalesPaise = 0;
    let totalOrders = 0;
    let prepaidCount = 0;
    let codCount = 0;
    let attributedOrdersCount = 0;
    let attributedSalesPaise = 0;

    const campaignBuckets = new Map<string, {
      source: string;
      medium: string;
      campaign: string;
      totalCheckouts: number;
      paidOrders: number;
      abandonedOrders: number;
      revenuePaise: number;
      prepaidCount: number;
      codCount: number;
    }>();

    for (const ord of orders) {
      const isPaid =
        ord.payment_status === 'paid' ||
        (ord.payment_method === 'cod' && ord.order_status !== 'cancelled');

      const isAbandoned =
        (ord.payment_method === 'online' && ord.payment_status === 'pending') ||
        ord.order_status === 'cancelled';

      const attr = (ord.attribution_data as Record<string, any>) || {};
      const source = (ord.utm_source || attr.utm_source || 'organic / direct').toLowerCase().trim();
      const medium = (ord.utm_medium || attr.utm_medium || 'direct').toLowerCase().trim();
      const campaign = (ord.utm_campaign || attr.utm_campaign || 'none').toLowerCase().trim();

      const isAttributed = source !== 'organic / direct' && source !== 'direct';

      if (isPaid) {
        grossSalesPaise += ord.total_paise || 0;
        totalOrders++;

        if (ord.payment_method === 'online') {
          prepaidCount++;
        } else {
          codCount++;
        }

        if (isAttributed) {
          attributedOrdersCount++;
          attributedSalesPaise += ord.total_paise || 0;
        }
      }

      // Group into Campaign Buckets
      const key = `${source}:::${medium}:::${campaign}`;
      let bucket = campaignBuckets.get(key);
      if (!bucket) {
        bucket = {
          source,
          medium,
          campaign,
          totalCheckouts: 0,
          paidOrders: 0,
          abandonedOrders: 0,
          revenuePaise: 0,
          prepaidCount: 0,
          codCount: 0,
        };
        campaignBuckets.set(key, bucket);
      }

      bucket.totalCheckouts++;
      if (isPaid) {
        bucket.paidOrders++;
        bucket.revenuePaise += ord.total_paise || 0;
        if (ord.payment_method === 'online') {
          bucket.prepaidCount++;
        } else {
          bucket.codCount++;
        }
      } else if (isAbandoned) {
        bucket.abandonedOrders++;
      }
    }

    const aovPaise = totalOrders > 0 ? Math.round(grossSalesPaise / totalOrders) : 0;
    const prepaidRatio = totalOrders > 0 ? Math.round((prepaidCount / totalOrders) * 100) : 0;
    const attributionRate = totalOrders > 0 ? Math.round((attributedOrdersCount / totalOrders) * 100) : 0;

    // Build Campaign Performance Table
    const campaigns: CampaignRow[] = Array.from(campaignBuckets.values())
      .map((b) => ({
        source: b.source,
        medium: b.medium,
        campaign: b.campaign,
        totalCheckouts: b.totalCheckouts,
        paidOrders: b.paidOrders,
        abandonedOrders: b.abandonedOrders,
        conversionRate: b.totalCheckouts > 0 ? Math.round((b.paidOrders / b.totalCheckouts) * 100) : 0,
        revenuePaise: b.revenuePaise,
        aovPaise: b.paidOrders > 0 ? Math.round(b.revenuePaise / b.paidOrders) : 0,
        prepaidCount: b.prepaidCount,
        codCount: b.codCount,
      }))
      .sort((a, b) => b.revenuePaise - a.revenuePaise);

    // 5. Compute CAPI Observability & Delivery Health
    const capiTotalJobs = capiJobs.length;
    const capiSucceeded = capiJobs.filter((j) => j.status === 'succeeded').length;
    const capiFailed = capiJobs.filter((j) => j.status === 'failed' || j.status === 'dead').length;
    const capiPending = capiJobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
    const jobSuccessRate = capiTotalJobs > 0 ? Math.round((capiSucceeded / capiTotalJobs) * 100) : 100;

    // Provider Breakdown from app_events
    const metaSuccess = appEvents.filter((e) => e.event === 'tracking.capi_meta_success').length;
    const metaError = appEvents.filter((e) => e.event === 'tracking.capi_meta_error' || e.event === 'tracking.capi_meta_exception').length;
    const metaSkipped = appEvents.filter((e) => e.event === 'tracking.capi_meta_skipped').length;
    const metaTotal = metaSuccess + metaError;
    const metaRate = metaTotal > 0 ? Math.round((metaSuccess / metaTotal) * 100) : (process.env.META_CAPI_ACCESS_TOKEN ? 100 : 0);

    const googleSuccess = appEvents.filter((e) => e.event === 'tracking.capi_google_success').length;
    const googleError = appEvents.filter((e) => e.event === 'tracking.capi_google_error' || e.event === 'tracking.capi_google_exception').length;
    const googleSkipped = appEvents.filter((e) => e.event === 'tracking.capi_google_skipped').length;
    const googleTotal = googleSuccess + googleError;
    const googleRate = googleTotal > 0 ? Math.round((googleSuccess / googleTotal) * 100) : (process.env.GA_API_SECRET ? 100 : 0);

    const snapSuccess = appEvents.filter((e) => e.event === 'tracking.capi_snap_success').length;
    const snapError = appEvents.filter((e) => e.event === 'tracking.capi_snap_error' || e.event === 'tracking.capi_snap_exception').length;
    const snapSkipped = appEvents.filter((e) => e.event === 'tracking.capi_snap_skipped').length;
    const snapTotal = snapSuccess + snapError;
    const snapRate = snapTotal > 0 ? Math.round((snapSuccess / snapTotal) * 100) : (process.env.SNAPCHAT_CAPI_TOKEN ? 100 : 0);

    return apiSuccess({
      overview: {
        grossSalesPaise,
        totalOrders,
        aovPaise,
        prepaidCount,
        codCount,
        prepaidRatio,
        attributedOrdersCount,
        attributedSalesPaise,
        attributionRate,
      },
      capiHealth: {
        queue: {
          total: capiTotalJobs,
          succeeded: capiSucceeded,
          failed: capiFailed,
          pending: capiPending,
          successRate: jobSuccessRate,
        },
        providers: {
          meta: {
            configured: Boolean(process.env.NEXT_PUBLIC_META_PIXEL_ID && process.env.META_CAPI_ACCESS_TOKEN),
            successCount: metaSuccess,
            errorCount: metaError,
            skippedCount: metaSkipped,
            successRate: metaRate,
            lastEventAt: appEvents.find((e) => e.event.startsWith('tracking.capi_meta'))?.created_at || null,
          },
          google: {
            configured: Boolean((process.env.NEXT_PUBLIC_GOOGLE_TAG_ID || process.env.NEXT_PUBLIC_GA_ID) && process.env.GA_API_SECRET),
            successCount: googleSuccess,
            errorCount: googleError,
            skippedCount: googleSkipped,
            successRate: googleRate,
            lastEventAt: appEvents.find((e) => e.event.startsWith('tracking.capi_google'))?.created_at || null,
          },
          snapchat: {
            configured: Boolean(process.env.NEXT_PUBLIC_SNAP_PIXEL_ID && process.env.SNAPCHAT_CAPI_TOKEN),
            successCount: snapSuccess,
            errorCount: snapError,
            skippedCount: snapSkipped,
            successRate: snapRate,
            lastEventAt: appEvents.find((e) => e.event.startsWith('tracking.capi_snap'))?.created_at || null,
          },
        },
        recentLogs: appEvents.slice(0, 15).map((e) => ({
          id: e.id,
          event: e.event,
          severity: e.severity,
          created_at: e.created_at,
          data: e.data,
        })),
      },
      campaigns,
    });
  } catch (err) {
    console.error('[ADMIN_ADS_API_ERROR]', err);
    return apiError(500, 'Internal server error while loading ad metrics');
  }
}

