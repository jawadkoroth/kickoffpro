'use client';

import { useEffect, useState, useMemo, useCallback, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { ADMIN_ORDER_CREATED_EVENT } from '@/components/admin/AdminRealtimeProvider';
import DownloadReportControl from '@/components/admin/DownloadReportControl';

/**
 * Admin Orders list — server-driven filters, search, pagination,
 * and bulk actions. Mirrors the dashboard aesthetic: pill filters,
 * gold-accent active state, premium dark/glass cards.
 */

interface OrderRow {
  id: string;
  order_number: string;
  total_paise: number;
  order_status: string;
  payment_status: string;
  payment_method: string;
  customer_name: string;
  customer_phone: string;
  created_at: string;
}

const STATUS_FILTERS = [
  { key: '', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'stuck', label: '⚠ Stuck' },
] as const;

const PAYMENT_FILTERS = [
  { key: '', label: 'Any' },
  { key: 'online', label: 'Online' },
  { key: 'cod', label: 'COD' },
] as const;

const formatPrice = (paise: number) =>
  '₹' + (paise / 100).toLocaleString('en-IN');
const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

function OrdersList() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [status, setStatus] = useState<string>(searchParams.get('filter') ?? searchParams.get('status') ?? '');
  const [payment, setPayment] = useState<string>(searchParams.get('payment') ?? '');
  const [from, setFrom] = useState<string>(searchParams.get('from') ?? '');
  const [to, setTo] = useState<string>(searchParams.get('to') ?? '');
  const [q, setQ] = useState<string>(searchParams.get('q') ?? '');
  const [debouncedQ, setDebouncedQ] = useState<string>(q);

  const [page, setPage] = useState<number>(1);
  const pageSize = 20;

  const [rows, setRows] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [bulkBusy, setBulkBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Debounce search input (250 ms).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Reset to page 1 whenever filters change.
  useEffect(() => {
    setPage(1);
  }, [status, payment, from, to, debouncedQ]);

  // Mirror filters into the URL so refreshes preserve state.
  useEffect(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (payment) params.set('payment', payment);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (debouncedQ) params.set('q', debouncedQ);
    const qs = params.toString();
    router.replace(qs ? `/admin/orders?${qs}` : '/admin/orders', { scroll: false });
  }, [status, payment, from, to, debouncedQ, router]);

  const inFlight = useRef<AbortController | null>(null);

  const fetchOrders = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    setError('');

    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (payment) params.set('payment', payment);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (debouncedQ) params.set('q', debouncedQ);
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));

    try {
      const res = await fetch(`/api/admin/orders?${params.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Failed to load orders');
        return;
      }
      setRows(json.orders ?? []);
      setTotal(json.total ?? 0);
      // Drop selections that are no longer visible.
      setSelected((prev) => {
        if (prev.size === 0) return prev;
        const visible = new Set((json.orders ?? []).map((r: OrderRow) => r.id));
        const next = new Set<string>();
        prev.forEach((id) => {
          if (visible.has(id)) next.add(id);
        });
        return next;
      });
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      console.error('[ADMIN_ORDERS_FETCH]', err);
      setError('Failed to load orders');
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      setLoading(false);
    }
  }, [status, payment, from, to, debouncedQ, page]);

  useEffect(() => {
    fetchOrders();
    return () => {
      inFlight.current?.abort();
    };
  }, [fetchOrders]);

  // Realtime: refetch on new-order event so the list stays live.
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null;
    const onOrder = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => fetchOrders(), 600);
    };
    window.addEventListener(ADMIN_ORDER_CREATED_EVENT, onOrder);
    return () => {
      window.removeEventListener(ADMIN_ORDER_CREATED_EVENT, onOrder);
      if (pending) clearTimeout(pending);
    };
  }, [fetchOrders]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total, pageSize],
  );

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === rows.length && rows.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.id)));
    }
  }

  async function runBulk(action: 'cancel' | 'mark_shipped' | 'mark_delivered') {
    if (selected.size === 0 || bulkBusy) return;
    const verbs: Record<typeof action, string> = {
      cancel: 'cancel',
      mark_shipped: 'mark as shipped',
      mark_delivered: 'mark as delivered',
    };
    if (!confirm(`${selected.size === 1 ? '1 order' : `${selected.size} orders`} will be ${verbs[action]}d. Proceed?`)) {
      return;
    }
    setBulkBusy(true);
    try {
      const res = await fetch('/api/admin/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, order_ids: Array.from(selected) }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Bulk action failed');
      } else {
        setSelected(new Set());
        fetchOrders();
      }
    } catch (err) {
      console.error('[ADMIN_ORDERS_BULK_FAIL]', err);
      setError('Bulk action failed');
    } finally {
      setBulkBusy(false);
    }
  }

  const allOnPageSelected =
    rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-4)',
          gap: 'var(--space-2)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Orders</h1>
          <span className="text-xs text-muted">
            {loading ? 'Loading…' : `${total.toLocaleString('en-IN')} match${total === 1 ? '' : 'es'}`}
          </span>
        </div>
        <DownloadReportControl
          defaultFrom={from}
          defaultTo={to}
          statusFilter={status}
          paymentFilter={payment}
        />
      </div>

      {/* Status pills */}
      <div
        role="tablist"
        aria-label="Filter by status"
        style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          marginBottom: 'var(--space-3)',
        }}
      >
        {STATUS_FILTERS.map((f) => {
          const active = status === f.key;
          return (
            <button
              key={f.key || 'all'}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setStatus(f.key)}
              style={{
                border: '1px solid',
                borderColor: active ? 'rgba(212,175,55,0.55)' : 'var(--border-color)',
                background: active ? 'rgba(212,175,55,0.10)' : 'transparent',
                color: active ? 'var(--gold, #D4AF37)' : 'var(--text-primary)',
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: '0.75rem',
                fontWeight: 600,
                letterSpacing: '0.04em',
                cursor: 'pointer',
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Other filters */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <input
          type="search"
          placeholder="Search order # or customer"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="input-field"
          style={{ minHeight: 38 }}
        />
        <select
          value={payment}
          onChange={(e) => setPayment(e.target.value)}
          className="input-field"
          aria-label="Payment method"
          style={{ minHeight: 38 }}
        >
          {PAYMENT_FILTERS.map((p) => (
            <option key={p.key || 'any'} value={p.key}>
              Payment: {p.label}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label="From date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="input-field"
          style={{ minHeight: 38, colorScheme: 'dark' }}
        />
        <input
          type="date"
          aria-label="To date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="input-field"
          style={{ minHeight: 38, colorScheme: 'dark' }}
        />
      </div>

      {error && (
        <div className="warning-banner" style={{ marginBottom: 'var(--space-3)' }}>
          ⚠ {error}
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div
          role="region"
          aria-label="Bulk actions"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-3)',
            border: '1px solid rgba(212,175,55,0.40)',
            background: 'rgba(212,175,55,0.06)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 'var(--space-3)',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
            {selected.size} selected
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={bulkBusy}
            onClick={() => runBulk('mark_shipped')}
          >
            Mark shipped
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={bulkBusy}
            onClick={() => runBulk('mark_delivered')}
          >
            Mark delivered
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={bulkBusy}
            onClick={() => runBulk('cancel')}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setSelected(new Set())}
            disabled={bulkBusy}
          >
            Clear
          </button>
        </div>
      )}

      {/* Select-all helper */}
      {rows.length > 0 && (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            marginBottom: 'var(--space-2)',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={allOnPageSelected}
            onChange={toggleSelectAll}
            aria-label="Select all on this page"
          />
          Select all on this page
        </label>
      )}

      {loading && rows.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 76, borderRadius: 'var(--radius-md)' }} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-muted" style={{ textAlign: 'center', padding: 'var(--space-8) 0' }}>
          {status === 'stuck' ? 'No stuck orders 👍' : 'No orders match these filters'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {rows.map((order) => {
            const checked = selected.has(order.id);
            return (
              <div
                key={order.id}
                className="order-card"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: 'var(--space-3)',
                  alignItems: 'center',
                  padding: 'var(--space-4)',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSelect(order.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select ${order.order_number}`}
                  style={{ marginTop: 4 }}
                />
                <Link
                  href={`/admin/orders/${order.id}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    color: 'inherit',
                    textDecoration: 'none',
                  }}
                >
                  <div className="order-card-header">
                    <span style={{ fontWeight: 600, fontSize: '0.8125rem', fontFamily: 'monospace' }}>
                      {order.order_number}
                    </span>
                    <span className={`badge badge-${order.order_status}`}>{order.order_status}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                    <span>
                      {order.customer_name || '—'} · {order.payment_method.toUpperCase()}
                    </span>
                    <span>{formatPrice(order.total_paise)}</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {formatDate(order.created_at)}
                    {order.payment_status === 'paid' && (
                      <span className="badge badge-paid" style={{ marginLeft: 'var(--space-2)' }}>
                        Paid
                      </span>
                    )}
                    {order.payment_status === 'failed' && (
                      <span className="badge badge-cancelled" style={{ marginLeft: 'var(--space-2)' }}>
                        Failed
                      </span>
                    )}
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 'var(--space-4)',
            gap: 'var(--space-2)',
          }}
        >
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← Prev
          </button>
          <span className="text-xs text-muted">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

export default function AdminOrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="animate-pulse text-muted" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
          Loading...
        </div>
      }
    >
      <OrdersList />
    </Suspense>
  );
}
