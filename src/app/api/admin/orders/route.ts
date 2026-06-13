import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { apiSuccess, apiError } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/orders
 *
 * Server-side filtering / search / pagination for the admin
 * orders list. Designed to scale to the full lifetime of orders
 * without dragging the browser through every row.
 *
 * Query params (all optional):
 *
 *   status     comma list: pending,confirmed,shipped,delivered,cancelled
 *              Special pseudo-status: `stuck` (online + pending +
 *              older than 30 minutes; cannot be combined with the
 *              real statuses).
 *   payment    online | cod
 *   from       ISO date (inclusive, start of day)
 *   to         ISO date (inclusive, end of day)
 *   q          free-text search; matches order_number prefix or
 *              substring against customer.name / customer.phone.
 *   page       1-based; defaults to 1.
 *   pageSize   default 20, max 100.
 *
 * Response:
 *   { orders: [...], total, page, pageSize, hasMore }
 *
 * POST /api/admin/orders
 *   Bulk action endpoint, dispatched on body.action:
 *     { action: 'cancel'  | 'mark_shipped' | 'mark_delivered',
 *       order_ids: string[] }
 *   Bulk shipping / cancellation calls run in a single batched
 *   UPDATE; failures bubble per-row.
 */

interface Customer {
  name?: string;
  phone?: string;
  email?: string;
}

const VALID_STATUSES = new Set([
  'pending',
  'confirmed',
  'shipped',
  'delivered',
  'cancelled',
]);

const VALID_PAYMENT_METHODS = new Set(['online', 'cod']);

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

export async function GET(req: NextRequest) {
  const gate = await gateAdmin();
  if (!gate.ok) return apiError(gate.status, gate.message);
  const { admin } = gate;

  const url = new URL(req.url);

  const statusParam = url.searchParams.get('status') || '';
  const paymentParam = url.searchParams.get('payment') || '';
  const q = url.searchParams.get('q')?.trim() ?? '';
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');

  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '20', 10) || 20),
  );
  const offset = (page - 1) * pageSize;

  // Normalise status list. `stuck` is the only pseudo value and
  // is not combinable with real statuses.
  const statuses = statusParam
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const stuckOnly = statuses.length === 1 && statuses[0] === 'stuck';
  const realStatuses = stuckOnly
    ? []
    : statuses.filter((s) => VALID_STATUSES.has(s));

  let query = admin
    .from('orders')
    .select(
      'id, order_number, total_paise, order_status, payment_status, payment_method, customer, created_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false });

  if (stuckOnly) {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    query = query
      .eq('payment_method', 'online')
      .eq('payment_status', 'pending')
      .eq('order_status', 'pending')
      .lt('created_at', thirtyMinAgo);
  } else if (realStatuses.length === 1) {
    query = query.eq('order_status', realStatuses[0]);
  } else if (realStatuses.length > 1) {
    query = query.in('order_status', realStatuses);
  }

  if (paymentParam && VALID_PAYMENT_METHODS.has(paymentParam)) {
    query = query.eq('payment_method', paymentParam);
  }

  if (fromParam) {
    const d = new Date(fromParam);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(0, 0, 0, 0);
      query = query.gte('created_at', d.toISOString());
    }
  }
  if (toParam) {
    const d = new Date(toParam);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      query = query.lte('created_at', d.toISOString());
    }
  }

  // Free text: order_number is a clean SQL ilike target. Customer
  // name/phone live inside the JSONB `customer` column; we use
  // ilike on the JSON-cast text. Fast enough for an admin page;
  // a GIN index would be the next escalation if it ever isn't.
  if (q) {
    const escaped = q.replace(/[%_]/g, '\\$&');
    query = query.or(
      [
        `order_number.ilike.%${escaped}%`,
        `customer->>name.ilike.%${escaped}%`,
        `customer->>phone.ilike.%${escaped}%`,
      ].join(','),
    );
  }

  query = query.range(offset, offset + pageSize - 1);

  const { data, count, error } = await query;
  if (error) {
    console.error('[ADMIN_ORDERS_LIST]', error);
    return apiError(500, 'Failed to load orders');
  }

  const orders = (data ?? []).map((o) => {
    const row = o as {
      id: string;
      order_number: string;
      total_paise: number;
      order_status: string;
      payment_status: string;
      payment_method: string;
      customer: Customer | null;
      created_at: string;
    };
    return {
      id: row.id,
      order_number: row.order_number,
      total_paise: row.total_paise,
      order_status: row.order_status,
      payment_status: row.payment_status,
      payment_method: row.payment_method,
      customer_name: row.customer?.name ?? '',
      customer_phone: row.customer?.phone ?? '',
      created_at: row.created_at,
    };
  });

  const total = count ?? 0;
  return apiSuccess({
    orders,
    total,
    page,
    pageSize,
    hasMore: offset + orders.length < total,
  });
}

const VALID_BULK_ACTIONS = new Set([
  'cancel',
  'mark_shipped',
  'mark_delivered',
]);

export async function POST(req: NextRequest) {
  const gate = await gateAdmin();
  if (!gate.ok) return apiError(gate.status, gate.message);
  const { admin } = gate;

  const body = await req.json().catch(() => ({}));
  const action: string = (body as { action?: string }).action ?? '';
  const orderIds: unknown = (body as { order_ids?: unknown }).order_ids;

  if (!VALID_BULK_ACTIONS.has(action)) {
    return apiError(400, 'Invalid bulk action');
  }
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return apiError(400, 'order_ids must be a non-empty array');
  }
  if (orderIds.length > 100) {
    return apiError(400, 'A single bulk action is limited to 100 orders');
  }
  // Filter to UUID strings — defence-in-depth against type abuse.
  const ids = orderIds.filter(
    (v): v is string => typeof v === 'string' && /^[0-9a-f-]{8,}$/i.test(v),
  );
  if (ids.length === 0) return apiError(400, 'No valid order ids supplied');

  let update: Record<string, unknown>;
  let allowedFromStatus: string[];
  switch (action) {
    case 'cancel':
      update = { order_status: 'cancelled', cancel_reason: 'admin_bulk' };
      allowedFromStatus = ['pending', 'confirmed'];
      break;
    case 'mark_shipped':
      update = { order_status: 'shipped' };
      allowedFromStatus = ['confirmed'];
      break;
    case 'mark_delivered':
      update = { order_status: 'delivered' };
      allowedFromStatus = ['shipped'];
      break;
    default:
      return apiError(400, 'Unsupported action');
  }

  // Fetch previous order states to verify transition safety
  const { data: previousOrders, error: fetchError } = await admin
    .from('orders')
    .select('id, order_status, payment_status')
    .in('id', ids);

  if (fetchError) {
    console.error('[ADMIN_ORDERS_BULK_FETCH]', fetchError);
    return apiError(500, 'Failed to fetch order states');
  }

  const previousMap = new Map(
    (previousOrders ?? []).map((o) => [o.id, o as { id: string; order_status: string; payment_status: string }])
  );

  // Constrain by `allowedFromStatus` to avoid stomping rows that
  // are already past this stage (e.g. cancel after shipped).
  const { data, error } = await admin
    .from('orders')
    .update(update)
    .in('id', ids)
    .in('order_status', allowedFromStatus)
    .select('id');

  if (error) {
    console.error('[ADMIN_ORDERS_BULK]', error);
    return apiError(500, 'Bulk action failed');
  }

  if (action === 'cancel' && data && data.length > 0) {
    for (const item of data) {
      const prev = previousMap.get(item.id);
      if (prev && prev.order_status !== 'cancelled' && prev.payment_status !== 'failed') {
        await admin.rpc('restore_order_stock', { p_order_id: item.id });
      }
    }
  }

  return apiSuccess({
    updated: (data ?? []).length,
    skipped: ids.length - (data ?? []).length,
  });
}
