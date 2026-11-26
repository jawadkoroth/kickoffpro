import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { apiSuccess, apiError } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/analytics?from=ISO&to=ISO&lowStock=5
 *
 * 100% real SQL-backed D2C executive aggregation for `/admin/dashboard`.
 */

interface OrderRow {
  id: string;
  order_number: string;
  product_id: string | null;
  size: string | null;
  user_id: string | null;
  quantity: number | null;
  subtotal_paise: number | null;
  discount_paise: number | null;
  shipping_paise: number | null;
  cod_fee_paise: number | null;
  total_paise: number;
  coupon_code: string | null;
  payment_method: string;
  payment_status: string;
  order_status: string;
  customer: { name?: string; phone?: string; email?: string } | null;
  created_at: string;
}

interface OrderItemRow {
  order_id: string;
  product_id: string;
  product_name: string;
  size: string;
  quantity: number;
  subtotal_paise: number;
}

function parseRange(req: NextRequest): { from: Date; to: Date } {
  const url = new URL(req.url);
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');

  const now = new Date();
  const defaultTo = now;
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 6);
  defaultFrom.setHours(0, 0, 0, 0);

  const from = fromParam ? new Date(fromParam) : defaultFrom;
  const to = toParam ? new Date(toParam) : defaultTo;

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { from: defaultFrom, to: defaultTo };
  }
  return { from, to };
}

function dayKey(d: Date): string {
  const ist = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return ist;
}

function isRealizedOrder(o: Pick<OrderRow, 'order_status' | 'payment_status' | 'payment_method'>): boolean {
  if (o.order_status === 'cancelled' || o.payment_status === 'failed' || o.payment_status === 'refunded') {
    return false;
  }
  return o.payment_status === 'paid' || o.payment_method === 'cod';
}

export async function GET(req: NextRequest) {
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

    const adminCheck = createAdminClient();
    const { data: adminUser } = await adminCheck
      .from('admin_users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();
    if (!adminUser) return apiError(403, 'Not admin');
  }

  const supabase = createAdminClient();
  const { from, to } = parseRange(req);
  const lowStockThreshold = Math.max(
    0,
    Number(new URL(req.url).searchParams.get('lowStock') ?? 5),
  );

  // Previous window of equal duration for trend % comparison
  const rangeMs = Math.max(1000, to.getTime() - from.getTime());
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - rangeMs);

  const [ordersRes, prevOrdersRes, sessionsRes, lowStockRes] = await Promise.all([
    supabase
      .from('orders')
      .select(
        'id, order_number, product_id, size, user_id, quantity, subtotal_paise, discount_paise, shipping_paise, cod_fee_paise, total_paise, coupon_code, payment_method, payment_status, order_status, customer, created_at',
      )
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())
      .order('created_at', { ascending: false }),
    supabase
      .from('orders')
      .select('total_paise, order_status, payment_status, payment_method')
      .gte('created_at', prevFrom.toISOString())
      .lte('created_at', prevTo.toISOString()),
    supabase
      .from('visitor_sessions')
      .select('id, reached_checkout_at, current_path, last_active_at')
      .gte('last_active_at', from.toISOString())
      .lte('last_active_at', to.toISOString()),
    supabase
      .from('inventory')
      .select('product_id, size, stock, low_stock_alert, products ( name, archived_at, is_active )')
      .or(`stock.lte.${lowStockThreshold},low_stock_alert.eq.true`)
      .order('stock', { ascending: true })
      .limit(40),
  ]);

  if (ordersRes.error) {
    console.error('[ANALYTICS_ORDERS_ERROR]', ordersRes.error);
    return apiError(500, 'Failed to load orders');
  }

  const orders = (ordersRes.data ?? []) as OrderRow[];
  const prevOrders = (prevOrdersRes.data ?? []) as Array<
    Pick<OrderRow, 'total_paise' | 'order_status' | 'payment_status' | 'payment_method'>
  >;
  const prevRevenue = prevOrders
    .filter(isRealizedOrder)
    .reduce((sum, o) => sum + (o.total_paise ?? 0), 0);

  const realizedOrders = orders.filter(isRealizedOrder);
  const cancelledOrders = orders.filter((o) => o.order_status === 'cancelled');

  // Gross vs Net & Discount Spend
  const grossTotal = realizedOrders.reduce(
    (s, o) => s + (o.subtotal_paise ?? (o.total_paise ?? 0) + (o.discount_paise ?? 0)),
    0,
  );
  const discountTotal = realizedOrders.reduce((s, o) => s + (o.discount_paise ?? 0), 0);
  const shippingTotal = realizedOrders.reduce((s, o) => s + (o.shipping_paise ?? 0), 0);
  const codFeeTotal = realizedOrders.reduce((s, o) => s + (o.cod_fee_paise ?? 0), 0);
  const revenueTotal = realizedOrders.reduce((s, o) => s + (o.total_paise ?? 0), 0);
  const revenuePrepaid = realizedOrders
    .filter((o) => o.payment_method === 'online')
    .reduce((s, o) => s + (o.total_paise ?? 0), 0);
  const revenueCod = realizedOrders
    .filter((o) => o.payment_method === 'cod')
    .reduce((s, o) => s + (o.total_paise ?? 0), 0);
  const cancelledPaise = cancelledOrders.reduce((s, o) => s + (o.total_paise ?? 0), 0);

  const trendPct =
    prevRevenue === 0
      ? revenueTotal > 0
        ? 100
        : 0
      : Math.round(((revenueTotal - prevRevenue) / prevRevenue) * 100);

  const byStatus = (status: string) =>
    orders.filter((o) => o.order_status === status).length;

  const onlineRealizedCount = realizedOrders.filter((o) => o.payment_method === 'online').length;
  const codRealizedCount = realizedOrders.filter((o) => o.payment_method === 'cod').length;
  const totalRealizedCount = realizedOrders.length;
  const prepaidPct =
    totalRealizedCount > 0 ? Math.round((onlineRealizedCount / totalRealizedCount) * 100) : 0;
  const codPct = totalRealizedCount > 0 ? 100 - prepaidPct : 0;

  const aov =
    totalRealizedCount > 0 ? Math.round(revenueTotal / totalRealizedCount) : 0;

  const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
  const stuck = orders.filter(
    (o) =>
      o.payment_method === 'online' &&
      o.payment_status === 'pending' &&
      o.order_status === 'pending' &&
      new Date(o.created_at).getTime() < thirtyMinAgo,
  ).length;

  // Funnel & Conversion Rate
  const sessionsRows = (sessionsRes.data ?? []) as Array<{
    id: string;
    reached_checkout_at?: string | null;
    current_path?: string | null;
  }>;
  const sessionsCount = sessionsRows.length;
  const checkoutSessionsCount = sessionsRows.filter(
    (s) => Boolean(s.reached_checkout_at) || Boolean(s.current_path?.startsWith('/checkout')),
  ).length;
  const conversionRatePct =
    sessionsCount > 0
      ? Number(((totalRealizedCount / sessionsCount) * 100).toFixed(2))
      : 0;

  // Coupon / Promo Spend Breakdown
  const couponMap = new Map<
    string,
    { code: string; orders: number; discountPaise: number; revenuePaise: number }
  >();
  let couponOrdersCount = 0;
  for (const o of realizedOrders) {
    if ((o.discount_paise ?? 0) > 0 || (o.coupon_code && o.coupon_code.trim())) {
      const code = (o.coupon_code || 'PREPAID / AUTO').trim();
      if (o.coupon_code && o.coupon_code.trim()) couponOrdersCount += 1;
      const cur = couponMap.get(code) ?? { code, orders: 0, discountPaise: 0, revenuePaise: 0 };
      cur.orders += 1;
      cur.discountPaise += o.discount_paise ?? 0;
      cur.revenuePaise += o.total_paise ?? 0;
      couponMap.set(code, cur);
    }
  }
  const topCoupons = Array.from(couponMap.values())
    .sort((a, b) => b.discountPaise - a.discountPaise)
    .slice(0, 6);

  // Daily trend buckets (IST dates)
  const dayBucket = new Map<string, { revenue: number; orders: number }>();
  for (
    let d = new Date(from);
    d.getTime() <= to.getTime();
    d.setDate(d.getDate() + 1)
  ) {
    dayBucket.set(dayKey(d), { revenue: 0, orders: 0 });
  }
  for (const o of realizedOrders) {
    const k = dayKey(new Date(o.created_at));
    const slot = dayBucket.get(k) ?? { revenue: 0, orders: 0 };
    slot.orders += 1;
    slot.revenue += o.total_paise ?? 0;
    dayBucket.set(k, slot);
  }
  const trend = Array.from(dayBucket.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, v]) => ({ day, revenue: v.revenue, orders: v.orders }));

  // Repeat customers
  const userCounts = new Map<string, number>();
  for (const o of realizedOrders) {
    if (!o.user_id) continue;
    userCounts.set(o.user_id, (userCounts.get(o.user_id) ?? 0) + 1);
  }
  let repeatCustomers = 0;
  userCounts.forEach((c) => {
    if (c >= 2) repeatCustomers += 1;
  });

  // Top Selling Products & Sizes using order_items (multi-line) + legacy order fallback
  const realizedIds = realizedOrders.map((o) => o.id);
  let orderItems: OrderItemRow[] = [];
  if (realizedIds.length > 0) {
    // Chunk if huge, though date ranges are usually <= 5000 orders
    const chunkSize = 500;
    for (let i = 0; i < realizedIds.length; i += chunkSize) {
      const chunk = realizedIds.slice(i, i + chunkSize);
      const { data: oiRows } = await supabase
        .from('order_items')
        .select('order_id, product_id, product_name, size, quantity, subtotal_paise')
        .in('order_id', chunk);
      if (oiRows) orderItems = orderItems.concat(oiRows as OrderItemRow[]);
    }
  }

  const orderIdsWithItems = new Set(orderItems.map((oi) => oi.order_id));
  const productAgg = new Map<string, { name: string; qty: number; revenue: number }>();
  const sizeAgg = new Map<string, { size: string; qty: number; revenue: number }>();

  for (const item of orderItems) {
    const pSlot = productAgg.get(item.product_id) ?? {
      name: item.product_name || 'Product',
      qty: 0,
      revenue: 0,
    };
    pSlot.qty += item.quantity ?? 0;
    pSlot.revenue += item.subtotal_paise ?? 0;
    productAgg.set(item.product_id, pSlot);

    const sz = (item.size || 'OS').toUpperCase();
    const sSlot = sizeAgg.get(sz) ?? { size: sz, qty: 0, revenue: 0 };
    sSlot.qty += item.quantity ?? 0;
    sSlot.revenue += item.subtotal_paise ?? 0;
    sizeAgg.set(sz, sSlot);
  }

  // Fallback for legacy single-line orders without order_items rows
  const legacyProdIds: string[] = [];
  for (const o of realizedOrders) {
    if (orderIdsWithItems.has(o.id)) continue;
    if (o.product_id) {
      legacyProdIds.push(o.product_id);
      const pSlot = productAgg.get(o.product_id) ?? {
        name: 'Product',
        qty: 0,
        revenue: 0,
      };
      pSlot.qty += o.quantity ?? 1;
      pSlot.revenue += o.total_paise ?? 0;
      productAgg.set(o.product_id, pSlot);
    }
    const sz = (o.size || 'M').toUpperCase();
    const sSlot = sizeAgg.get(sz) ?? { size: sz, qty: 0, revenue: 0 };
    sSlot.qty += o.quantity ?? 1;
    sSlot.revenue += o.total_paise ?? 0;
    sizeAgg.set(sz, sSlot);
  }

  if (legacyProdIds.length > 0) {
    const { data: legacyProds } = await supabase
      .from('products')
      .select('id, name')
      .in('id', Array.from(new Set(legacyProdIds)));
    for (const p of legacyProds ?? []) {
      const existing = productAgg.get((p as { id: string }).id);
      if (existing) existing.name = (p as { name: string }).name;
    }
  }

  const topProducts = Array.from(productAgg.entries())
    .map(([product_id, v]) => ({ product_id, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  const totalUnitsSold = Array.from(sizeAgg.values()).reduce((s, r) => s + r.qty, 0);
  const topSizes = Array.from(sizeAgg.values())
    .map((s) => ({
      ...s,
      sharePct: totalUnitsSold > 0 ? Math.round((s.qty / totalUnitsSold) * 100) : 0,
    }))
    .sort((a, b) => b.qty - a.qty);

  // Recent orders & needsAction
  const recentOrders = orders.slice(0, 5).map((o) => ({
    id: o.id,
    order_number: o.order_number,
    total_paise: o.total_paise,
    order_status: o.order_status,
    payment_status: o.payment_status,
    payment_method: o.payment_method,
    customer_name: o.customer?.name ?? '',
    created_at: o.created_at,
  }));

  const needsAction = {
    unconfirmed: orders.filter(
      (o) => o.order_status === 'pending' && o.payment_status === 'paid',
    ).length,
    failed: orders.filter((o) => o.payment_status === 'failed').length,
    stuck,
  };

  // Recent customers
  const seenPhones = new Set<string>();
  const recentCustomers: { name: string; phone: string; last_order_at: string }[] = [];
  for (const o of orders) {
    const phone = o.customer?.phone ?? '';
    if (!phone || seenPhones.has(phone)) continue;
    seenPhones.add(phone);
    recentCustomers.push({
      name: o.customer?.name ?? '',
      phone,
      last_order_at: o.created_at,
    });
    if (recentCustomers.length >= 5) break;
  }

  // Low stock / Out-of-stock / Flagged alerts (excluding archived products)
  const lowStock = (lowStockRes.data ?? [])
    .map((r) => {
      const row = r as {
        product_id: string;
        size: string;
        stock: number;
        low_stock_alert?: boolean | null;
        products?:
          | { name?: string; archived_at?: string | null; is_active?: boolean }
          | { name?: string; archived_at?: string | null; is_active?: boolean }[]
          | null;
      };
      const prod = Array.isArray(row.products) ? row.products[0] : row.products;
      if (prod?.archived_at) return null;
      return {
        product_id: row.product_id,
        name: prod?.name ?? 'Product',
        size: row.size,
        stock: row.stock,
        low_stock_alert: Boolean(row.low_stock_alert),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, 20);

  return apiSuccess({
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
      daysInRange: trend.length,
    },
    revenue: {
      gross: grossTotal,
      discount: discountTotal,
      shipping: shippingTotal,
      codFee: codFeeTotal,
      total: revenueTotal,
      prepaid: revenuePrepaid,
      cod: revenueCod,
      cancelled: cancelledPaise,
      trendPct,
    },
    orders: {
      total: orders.length,
      realized: totalRealizedCount,
      pending: byStatus('pending'),
      confirmed: byStatus('confirmed'),
      shipped: byStatus('shipped'),
      delivered: byStatus('delivered'),
      cancelled: cancelledOrders.length,
      paymentSplit: {
        online: onlineRealizedCount,
        cod: codRealizedCount,
        prepaidPct,
        codPct,
      },
      stuck,
    },
    aov,
    repeatCustomers,
    funnel: {
      sessions: sessionsCount,
      reachedCheckout: checkoutSessionsCount,
      conversionRatePct,
    },
    discounts: {
      totalDiscountPaise: discountTotal,
      couponOrdersCount,
      topCoupons,
    },
    trend,
    recentOrders,
    needsAction,
    topProducts,
    topSizes,
    recentCustomers,
    lowStock,
  });
}
