import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { apiSuccess, apiError } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/reports?from=ISO&to=ISO&status=...&payment=...
 *
 * Strictly admin-gated accounting report payload for CSV, Excel (.xlsx),
 * PDF, and Word (.docx) business exports across `/admin/dashboard` & `/admin/orders`.
 */

interface ReportOrderRow {
  id: string;
  order_number: string;
  product_id: string | null;
  size: string | null;
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
  shipping_address: {
    city?: string;
    state?: string;
    pincode?: string;
    line1?: string;
  } | null;
  shipping_provider?: string | null;
  tracking_id?: string | null;
  return_type?: string | null;
  return_status?: string | null;
  rto_reason?: string | null;
  refund_status?: string | null;
  refund_reference?: string | null;
  created_at: string;
}

interface ReportOrderItemRow {
  order_id: string;
  product_id: string;
  product_name: string;
  size: string;
  quantity: number;
  unit_price_paise: number;
  subtotal_paise: number;
}

function paiseToRupeesNum(paise: number | null | undefined): number {
  return Number(((paise ?? 0) / 100).toFixed(2));
}

async function verifyAdmin(req: NextRequest) {
  const host = req.headers.get('host') || '';
  const isLocalhost =
    host.startsWith('localhost:') ||
    host === 'localhost' ||
    host.startsWith('127.0.0.1:') ||
    host === '127.0.0.1';
  if (process.env.LOCAL_DEV_ADMIN === 'true' && isLocalhost) {
    return { ok: true as const };
  }

  const ssr = await createServerSupabaseClient();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  if (!user) return { ok: false as const, status: 401, message: 'Unauthorized' };

  const admin = createAdminClient();
  const { data: adminUser } = await admin
    .from('admin_users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();
  if (!adminUser) return { ok: false as const, status: 403, message: 'Forbidden' };
  return { ok: true as const };
}

export async function GET(req: NextRequest) {
  const gate = await verifyAdmin(req);
  if (!gate.ok) return apiError(gate.status, gate.message);

  const url = new URL(req.url);
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 29);
  defaultFrom.setHours(0, 0, 0, 0);

  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const fromDate = fromParam ? new Date(fromParam) : defaultFrom;
  const toDate = toParam ? new Date(toParam) : now;

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return apiError(400, 'Invalid date range');
  }

  fromDate.setHours(0, 0, 0, 0);
  toDate.setHours(23, 59, 59, 999);

  const statusFilter = url.searchParams.get('status')?.trim().toLowerCase() || '';
  const paymentFilter = url.searchParams.get('payment')?.trim().toLowerCase() || '';
  const reportType = url.searchParams.get('type')?.trim().toLowerCase() === 'orders' ? 'orders' : 'dashboard';

  const supabase = createAdminClient();
  let query = supabase
    .from('orders')
    .select(
      'id, order_number, product_id, size, quantity, subtotal_paise, discount_paise, shipping_paise, cod_fee_paise, total_paise, coupon_code, payment_method, payment_status, order_status, customer, shipping_address, shipping_provider, tracking_id, return_type, return_status, rto_reason, refund_status, refund_reference, created_at',
    )
    .gte('created_at', fromDate.toISOString())
    .lte('created_at', toDate.toISOString())
    .order('created_at', { ascending: false })
    .limit(5000);

  if (statusFilter === 'refund_pending') {
    query = query.eq('refund_status', 'pending');
  } else if (statusFilter) {
    const allowed = new Set([
      'pending',
      'confirmed',
      'shipped',
      'delivered',
      'cancelled',
      'return_requested',
      'returned',
      'rto',
    ]);
    const list = statusFilter
      .split(',')
      .map((s) => s.trim())
      .filter((s) => allowed.has(s));
    if (list.length === 1) {
      query = query.eq('order_status', list[0]);
    } else if (list.length > 1) {
      query = query.in('order_status', list);
    }
  }
  if (paymentFilter && ['online', 'cod'].includes(paymentFilter)) {
    query = query.eq('payment_method', paymentFilter);
  }

  const { data: ordersData, error } = await query;
  if (error) {
    console.error('[ADMIN_REPORT_ORDERS_ERR]', error);
    return apiError(500, 'Failed to load orders for report');
  }

  const orders = (ordersData ?? []) as ReportOrderRow[];
  const orderIds = orders.map((o) => o.id);

  let items: ReportOrderItemRow[] = [];
  if (orderIds.length > 0) {
    const chunkSize = 500;
    for (let i = 0; i < orderIds.length; i += chunkSize) {
      const { data: itemChunk } = await supabase
        .from('order_items')
        .select('order_id, product_id, product_name, size, quantity, unit_price_paise, subtotal_paise')
        .in('order_id', orderIds.slice(i, i + chunkSize));
      if (itemChunk) items = items.concat(itemChunk as ReportOrderItemRow[]);
    }
  }

  // Group items by order_id
  const itemsByOrder = new Map<string, ReportOrderItemRow[]>();
  for (const it of items) {
    const list = itemsByOrder.get(it.order_id) ?? [];
    list.push(it);
    itemsByOrder.set(it.order_id, list);
  }

  // Legacy single-item product name lookup
  const missingProductIds = Array.from(
    new Set(
      orders
        .filter((o) => !itemsByOrder.has(o.id) && o.product_id)
        .map((o) => o.product_id as string),
    ),
  );
  const legacyNames = new Map<string, string>();
  if (missingProductIds.length > 0) {
    const { data: prods } = await supabase
      .from('products')
      .select('id, name')
      .in('id', missingProductIds);
    for (const p of prods ?? []) {
      legacyNames.set((p as { id: string }).id, (p as { name: string }).name);
    }
  }

  const isRealized = (o: ReportOrderRow) =>
    o.order_status !== 'cancelled' &&
    o.payment_status !== 'failed' &&
    o.payment_status !== 'refunded' &&
    (o.payment_status === 'paid' || o.payment_method === 'cod');

  let grossSubtotalPaise = 0;
  let discountTotalPaise = 0;
  let shippingTotalPaise = 0;
  let codFeeTotalPaise = 0;
  let netRevenuePaise = 0;
  let prepaidOrders = 0;
  let prepaidRevenuePaise = 0;
  let codOrders = 0;
  let codRevenuePaise = 0;
  let realizedOrders = 0;
  let cancelledOrders = 0;

  const skuMap = new Map<
    string,
    { productName: string; size: string; quantitySold: number; grossRevenuePaise: number }
  >();

  const exportRows = orders.map((o) => {
    const orderItems = itemsByOrder.get(o.id) ?? [];
    const realized = isRealized(o);
    if (o.order_status === 'cancelled') cancelledOrders += 1;

    const gross = o.subtotal_paise ?? (o.total_paise ?? 0) + (o.discount_paise ?? 0);
    const disc = o.discount_paise ?? 0;
    const ship = o.shipping_paise ?? 0;
    const codFee = o.cod_fee_paise ?? 0;
    const net = o.total_paise ?? 0;

    if (realized) {
      realizedOrders += 1;
      grossSubtotalPaise += gross;
      discountTotalPaise += disc;
      shippingTotalPaise += ship;
      codFeeTotalPaise += codFee;
      netRevenuePaise += net;
      if (o.payment_method === 'online') {
        prepaidOrders += 1;
        prepaidRevenuePaise += net;
      } else {
        codOrders += 1;
        codRevenuePaise += net;
      }
    }

    let itemsSummary = '';
    let totalQty = 0;
    if (orderItems.length > 0) {
      itemsSummary = orderItems
        .map((li) => `${li.product_name} (${li.size}) x${li.quantity}`)
        .join('; ');
      totalQty = orderItems.reduce((sum, li) => sum + (li.quantity ?? 1), 0);
      if (realized) {
        for (const li of orderItems) {
          const key = `${li.product_name}::${li.size}`;
          const cur = skuMap.get(key) ?? {
            productName: li.product_name,
            size: li.size,
            quantitySold: 0,
            grossRevenuePaise: 0,
          };
          cur.quantitySold += li.quantity;
          cur.grossRevenuePaise += li.subtotal_paise;
          skuMap.set(key, cur);
        }
      }
    } else if (o.product_id) {
      const pName = legacyNames.get(o.product_id) ?? 'Product';
      const sz = o.size || 'M';
      const q = o.quantity ?? 1;
      totalQty = q;
      itemsSummary = `${pName} (${sz}) x${q}`;
      if (realized) {
        const key = `${pName}::${sz}`;
        const cur = skuMap.get(key) ?? {
          productName: pName,
          size: sz,
          quantitySold: 0,
          grossRevenuePaise: 0,
        };
        cur.quantitySold += q;
        cur.grossRevenuePaise += gross;
        skuMap.set(key, cur);
      }
    }

    const returnRtoStatus =
      o.order_status === 'rto'
        ? `RTO${o.rto_reason ? `: ${o.rto_reason}` : ''}`
        : o.return_type
          ? `${o.return_type.toUpperCase()} (${o.return_status || 'requested'})`
          : 'None';

    const refundStatusRef =
      o.refund_status && o.refund_status !== 'none'
        ? `${o.refund_status.toUpperCase()}${o.refund_reference ? ` (${o.refund_reference})` : ''}`
        : o.payment_status === 'refunded'
          ? 'COMPLETED'
          : 'None';

    return {
      orderNumber: o.order_number,
      date: new Date(o.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      customerName: o.customer?.name || 'Guest',
      customerPhone: o.customer?.phone || '',
      customerEmail: o.customer?.email || '',
      location: [o.shipping_address?.city, o.shipping_address?.state, o.shipping_address?.pincode]
        .filter(Boolean)
        .join(', '),
      paymentMethod: o.payment_method === 'cod' ? 'COD' : 'Prepaid',
      paymentStatus: o.payment_status,
      orderStatus: o.order_status,
      couponCode: o.coupon_code || '',
      subtotalRupees: paiseToRupeesNum(gross),
      discountRupees: paiseToRupeesNum(disc),
      shippingRupees: paiseToRupeesNum(ship),
      codFeeRupees: paiseToRupeesNum(codFee),
      netTotalRupees: paiseToRupeesNum(net),
      itemsSummary,
      totalQty,
      courierPartner: o.shipping_provider || '',
      trackingId: o.tracking_id || '',
      returnRtoStatus,
      refundStatusRef,
    };
  });

  const skuBreakdown = Array.from(skuMap.values())
    .map((s) => ({
      productName: s.productName,
      size: s.size,
      quantitySold: s.quantitySold,
      grossRevenueRupees: paiseToRupeesNum(s.grossRevenuePaise),
    }))
    .sort((a, b) => b.quantitySold - a.quantitySold || b.grossRevenueRupees - a.grossRevenueRupees);

  const aovPaise = realizedOrders > 0 ? Math.round(netRevenuePaise / realizedOrders) : 0;

  return apiSuccess({
    reportType,
    summary: {
      generatedAt: now.toISOString(),
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      totalOrders: orders.length,
      realizedOrders,
      cancelledOrders,
      grossSubtotalRupees: paiseToRupeesNum(grossSubtotalPaise),
      discountTotalRupees: paiseToRupeesNum(discountTotalPaise),
      shippingTotalRupees: paiseToRupeesNum(shippingTotalPaise),
      codFeeTotalRupees: paiseToRupeesNum(codFeeTotalPaise),
      netRevenueRupees: paiseToRupeesNum(netRevenuePaise),
      prepaidOrders,
      prepaidRevenueRupees: paiseToRupeesNum(prepaidRevenuePaise),
      codOrders,
      codRevenueRupees: paiseToRupeesNum(codRevenuePaise),
      aovRupees: paiseToRupeesNum(aovPaise),
    },
    orders: exportRows,
    skuBreakdown,
  });
}
