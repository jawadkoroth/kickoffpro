'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  RevenueTrendChart,
  OrderTrendChart,
  PaymentSplitBar,
} from '@/components/admin/DashboardCharts';
import { ADMIN_ORDER_CREATED_EVENT } from '@/components/admin/AdminRealtimeProvider';
import AdminWelcome from '@/components/admin/AdminWelcome';

/**
 * KickoffPro Admin — operations dashboard.
 *
 * Server-side aggregation only: this page fetches a single
 * `/api/admin/analytics` endpoint that returns every metric / list
 * in one bounded query. Filters narrow the date range; the chart,
 * cards and operational widgets all derive from the same payload
 * → no fan-out queries, no client-side scan over the orders table.
 *
 * Realtime: the global `AdminRealtimeProvider` dispatches a
 * `admin:order-created` window event whenever a new order arrives.
 * We listen here and softly refetch (debounced) so revenue / counts
 * / recent orders update without a full reload.
 */

type Preset = 'today' | 'yesterday' | '7d' | 'month' | 'custom';

interface Analytics {
  range: { from: string; to: string; daysInRange: number };
  revenue: { total: number; prepaid: number; cod: number; trendPct: number };
  orders: {
    total: number;
    pending: number;
    confirmed: number;
    shipped: number;
    delivered: number;
    cancelled: number;
    paymentSplit: { online: number; cod: number };
    stuck: number;
  };
  aov: number;
  repeatCustomers: number;
  trend: { day: string; revenue: number; orders: number }[];
  recentOrders: {
    id: string;
    order_number: string;
    total_paise: number;
    order_status: string;
    payment_status: string;
    payment_method: string;
    customer_name: string;
    created_at: string;
  }[];
  needsAction: { unconfirmed: number; failed: number; stuck: number };
  topProducts: {
    product_id: string;
    name: string;
    qty: number;
    revenue: number;
  }[];
  recentCustomers: {
    name: string;
    phone: string;
    last_order_at: string;
  }[];
  lowStock: {
    product_id: string;
    name: string;
    size: string;
    stock: number;
  }[];
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function presetRange(preset: Preset, customFrom?: string, customTo?: string) {
  const now = new Date();
  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) };
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case '7d': {
      const f = new Date(now);
      f.setDate(f.getDate() - 6);
      return { from: startOfDay(f), to: endOfDay(now) };
    }
    case 'month': {
      const f = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: startOfDay(f), to: endOfDay(now) };
    }
    case 'custom': {
      const f = customFrom ? new Date(customFrom) : startOfDay(now);
      const t = customTo ? new Date(customTo) : endOfDay(now);
      return { from: startOfDay(f), to: endOfDay(t) };
    }
  }
}

const formatPrice = (paise: number) =>
  '₹' + (paise / 100).toLocaleString('en-IN');

const formatRelative = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

export default function AdminDashboard() {
  const [preset, setPreset] = useState<Preset>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const range = useMemo(
    () => presetRange(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );

  const fetchAnalytics = useCallback(async () => {
    setError(null);
    try {
      const url = new URL('/api/admin/analytics', window.location.origin);
      url.searchParams.set('from', range.from.toISOString());
      url.searchParams.set('to', range.to.toISOString());
      const res = await fetch(url.toString(), { cache: 'no-store' });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Failed to load analytics');
        return;
      }
      setData(json as Analytics);
    } catch (err) {
      console.error('[ANALYTICS_FETCH]', err);
      setError('Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  // Initial + filter-change fetch (debounced for custom range typing).
  useEffect(() => {
    setLoading(true);
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(fetchAnalytics, 200);
    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    };
  }, [fetchAnalytics]);

  // Realtime: refetch on new-order event (debounced so a burst of
  // inserts doesn't hammer the API).
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null;
    const onOrder = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        fetchAnalytics();
      }, 800);
    };
    window.addEventListener(ADMIN_ORDER_CREATED_EVENT, onOrder);
    return () => {
      window.removeEventListener(ADMIN_ORDER_CREATED_EVENT, onOrder);
      if (pending) clearTimeout(pending);
    };
  }, [fetchAnalytics]);

  return (
    <div>
      {/* Personalized Admin Welcome */}
      <AdminWelcome />

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
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Dashboard</h1>
        <FilterPills
          preset={preset}
          onChange={(p) => setPreset(p)}
          customFrom={customFrom}
          customTo={customTo}
          setCustomFrom={setCustomFrom}
          setCustomTo={setCustomTo}
        />
      </div>

      {error && (
        <div className="warning-banner" style={{ marginBottom: 'var(--space-4)' }}>
          ⚠ {error}
        </div>
      )}

      {/* Stuck orders banner */}
      {data && data.orders.stuck > 0 && (
        <div className="warning-banner" style={{ marginBottom: 'var(--space-4)' }}>
          ⚠ {data.orders.stuck} online order{data.orders.stuck > 1 ? 's' : ''}{' '}
          pending payment &gt; 30 min
          <Link
            href="/admin/orders?filter=stuck"
            style={{
              marginLeft: 'auto',
              textDecoration: 'underline',
              fontSize: '0.8125rem',
            }}
          >
            Review →
          </Link>
        </div>
      )}

      {/* Metric cards */}
      <div className="stats-grid" style={{ marginBottom: 'var(--space-5)' }}>
        <MetricCard
          label="Revenue"
          value={loading || !data ? '—' : formatPrice(data.revenue.total)}
          accent="success"
          trend={
            data
              ? { pct: data.revenue.trendPct, label: 'vs prev period' }
              : undefined
          }
          loading={loading}
        />
        <MetricCard
          label="Orders"
          value={loading || !data ? '—' : String(data.orders.total)}
          loading={loading}
        />
        <MetricCard
          label="AOV"
          value={loading || !data ? '—' : formatPrice(data.aov)}
          loading={loading}
        />
        <MetricCard
          label="Repeat customers"
          value={loading || !data ? '—' : String(data.repeatCustomers)}
          loading={loading}
        />
      </div>

      {/* Status row */}
      <div className="stats-grid" style={{ marginBottom: 'var(--space-5)' }}>
        <MetricCard
          label="Pending"
          value={data ? String(data.orders.pending) : '—'}
          accent="warning"
          loading={loading}
        />
        <MetricCard
          label="Confirmed"
          value={data ? String(data.orders.confirmed) : '—'}
          accent="info"
          loading={loading}
        />
        <MetricCard
          label="Shipped"
          value={data ? String(data.orders.shipped) : '—'}
          loading={loading}
        />
        <MetricCard
          label="Delivered"
          value={data ? String(data.orders.delivered) : '—'}
          accent="success"
          loading={loading}
        />
      </div>

      {/* Charts */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-5)',
        }}
      >
        <ChartCard title="Revenue trend">
          {data ? <RevenueTrendChart data={data.trend} /> : <ChartSkeleton />}
        </ChartCard>
        <ChartCard title="Orders trend">
          {data ? <OrderTrendChart data={data.trend} /> : <ChartSkeleton />}
        </ChartCard>
        <ChartCard title="Payment split">
          {data ? (
            <div style={{ paddingTop: 8 }}>
              <PaymentSplitBar
                online={data.orders.paymentSplit.online}
                cod={data.orders.paymentSplit.cod}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 'var(--space-3)',
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                }}
              >
                <span>Online revenue: {formatPrice(data.revenue.prepaid)}</span>
                <span>COD revenue: {formatPrice(data.revenue.cod)}</span>
              </div>
            </div>
          ) : (
            <ChartSkeleton />
          )}
        </ChartCard>
      </div>

      {/* Two-col widgets */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-5)',
        }}
      >
        <SectionCard
          title="Needs action"
          empty={
            data &&
              data.needsAction.unconfirmed === 0 &&
              data.needsAction.failed === 0 &&
              data.needsAction.stuck === 0
              ? 'All clear ✓'
              : null
          }
        >
          {data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.needsAction.unconfirmed > 0 && (
                <ActionRow
                  label="Paid but unconfirmed"
                  count={data.needsAction.unconfirmed}
                  href="/admin/orders?filter=unconfirmed"
                />
              )}
              {data.needsAction.failed > 0 && (
                <ActionRow
                  label="Failed payment"
                  count={data.needsAction.failed}
                  href="/admin/orders?filter=failed"
                  tone="error"
                />
              )}
              {data.needsAction.stuck > 0 && (
                <ActionRow
                  label="Stuck (online > 30 min)"
                  count={data.needsAction.stuck}
                  href="/admin/orders?filter=stuck"
                  tone="warning"
                />
              )}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Low stock"
          empty={data && data.lowStock.length === 0 ? 'No low-stock items' : null}
        >
          {data && data.lowStock.length > 0 && (
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {data.lowStock.slice(0, 8).map((row, i) => (
                <li
                  key={`${row.product_id}-${row.size}-${i}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.8125rem',
                    paddingBottom: 6,
                    borderBottom:
                      i < Math.min(7, data.lowStock.length - 1)
                        ? '1px solid var(--border-color)'
                        : 'none',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                    {row.name}{' '}
                    <span className="text-muted">· {row.size}</span>
                  </span>
                  <span
                    style={{
                      color: row.stock === 0 ? 'var(--error)' : 'var(--warning)',
                      fontWeight: 600,
                      fontFamily: 'var(--font-mono, ui-monospace), monospace',
                    }}
                  >
                    {row.stock}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Top products + Recent customers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-5)',
        }}
      >
        <SectionCard
          title="Top products"
          empty={data && data.topProducts.length === 0 ? 'No sales yet' : null}
        >
          {data && data.topProducts.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.topProducts.map((p) => (
                <li
                  key={p.product_id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.8125rem',
                    gap: 12,
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {p.name}
                  </span>
                  <span className="text-muted">×{p.qty}</span>
                  <span style={{ fontWeight: 600 }}>{formatPrice(p.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Recent customers"
          empty={data && data.recentCustomers.length === 0 ? 'No customers yet' : null}
        >
          {data && data.recentCustomers.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.recentCustomers.map((c, i) => (
                <li
                  key={`${c.phone}-${i}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.8125rem',
                  }}
                >
                  <span>
                    {c.name || '—'}{' '}
                    <span className="text-muted" style={{ fontFamily: 'var(--font-mono, ui-monospace), monospace' }}>
                      {c.phone}
                    </span>
                  </span>
                  <span className="text-muted">{formatRelative(c.last_order_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Recent orders */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-3)',
        }}
      >
        <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>Recent orders</h2>
        <Link
          href="/admin/orders"
          style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}
        >
          View all →
        </Link>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {loading && !data && (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        )}
        {data?.recentOrders.map((o) => (
          <Link key={o.id} href={`/admin/orders/${o.id}`} className="order-card">
            <div className="order-card-header">
              <span style={{ fontWeight: 600, fontSize: '0.875rem', fontFamily: 'monospace' }}>
                {o.order_number}
              </span>
              <span className={`badge badge-${o.order_status}`}>{o.order_status}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.8125rem',
                color: 'var(--text-muted)',
              }}
            >
              <span>{o.customer_name || '—'} · {o.payment_method === 'cod' ? 'COD' : 'Online'}</span>
              <span>{formatPrice(o.total_paise)}</span>
            </div>
          </Link>
        ))}
        {data?.recentOrders.length === 0 && (
          <p className="text-muted" style={{ textAlign: 'center', padding: 'var(--space-6) 0' }}>
            No orders in this range
          </p>
        )}
      </div>
    </div>
  );
}

/* ─────────────── small presentational helpers ─────────────── */

function FilterPills({
  preset,
  onChange,
  customFrom,
  customTo,
  setCustomFrom,
  setCustomTo,
}: {
  preset: Preset;
  onChange: (p: Preset) => void;
  customFrom: string;
  customTo: string;
  setCustomFrom: (v: string) => void;
  setCustomTo: (v: string) => void;
}) {
  const opts: { id: Preset; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'yesterday', label: 'Yesterday' },
    { id: '7d', label: '7d' },
    { id: 'month', label: 'Month' },
    { id: 'custom', label: 'Custom' },
  ];
  return (
    <div
      role="tablist"
      aria-label="Date range filter"
      style={{
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      {opts.map((o) => {
        const active = preset === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.id)}
            style={{
              border: '1px solid',
              borderColor: active ? 'rgba(212,175,55,0.55)' : 'var(--border-color)',
              background: active ? 'rgba(212,175,55,0.10)' : 'transparent',
              color: active ? 'var(--gold, #D4AF37)' : 'var(--text)',
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: '0.75rem',
              fontWeight: 600,
              letterSpacing: '0.04em',
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        );
      })}
      {preset === 'custom' && (
        <span style={{ display: 'inline-flex', gap: 6, marginLeft: 6 }}>
          <input
            type="date"
            aria-label="From date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            style={dateInput}
          />
          <input
            type="date"
            aria-label="To date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            style={dateInput}
          />
        </span>
      )}
    </div>
  );
}

const dateInput: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-color)',
  borderRadius: 6,
  color: 'var(--text)',
  padding: '4px 6px',
  fontSize: '0.75rem',
  colorScheme: 'dark',
};

function MetricCard({
  label,
  value,
  accent,
  trend,
  loading,
}: {
  label: string;
  value: string;
  accent?: 'success' | 'warning' | 'info' | 'error';
  trend?: { pct: number; label: string };
  loading?: boolean;
}) {
  const colorMap: Record<string, string> = {
    success: 'var(--success)',
    warning: 'var(--warning)',
    info: 'var(--info)',
    error: 'var(--error)',
  };
  return (
    <div className="stat-card">
      <div
        className="stat-value"
        style={{ color: accent ? colorMap[accent] : undefined }}
      >
        {loading ? <span className="animate-pulse" style={{ opacity: 0.5 }}>—</span> : value}
      </div>
      <div className="stat-label">{label}</div>
      {trend && (
        <div
          style={{
            marginTop: 4,
            fontSize: '0.7rem',
            color:
              trend.pct > 0
                ? 'var(--success)'
                : trend.pct < 0
                  ? 'var(--error)'
                  : 'var(--text-muted)',
            letterSpacing: '0.04em',
          }}
        >
          {trend.pct > 0 ? '▲ ' : trend.pct < 0 ? '▼ ' : ''}
          {Math.abs(trend.pct)}% {trend.label}
        </div>
      )}
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="card"
      style={{
        padding: 'var(--space-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
    >
      <p
        className="input-label"
        style={{ margin: 0, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em' }}
      >
        {title}
      </p>
      {children}
    </div>
  );
}

function SectionCard({
  title,
  children,
  empty,
}: {
  title: string;
  children: React.ReactNode;
  empty: string | null;
}) {
  return (
    <div className="card" style={{ padding: 'var(--space-3)' }}>
      <p
        className="input-label"
        style={{ marginBottom: 'var(--space-3)', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em' }}
      >
        {title}
      </p>
      {empty ? (
        <p className="text-muted" style={{ fontSize: '0.8125rem' }}>{empty}</p>
      ) : (
        children
      )}
    </div>
  );
}

function ActionRow({
  label,
  count,
  href,
  tone,
}: {
  label: string;
  count: number;
  href: string;
  tone?: 'warning' | 'error';
}) {
  const c =
    tone === 'error'
      ? 'var(--error)'
      : tone === 'warning'
        ? 'var(--warning)'
        : 'var(--text)';
  return (
    <Link
      href={href}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 10px',
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        textDecoration: 'none',
        color: 'var(--text)',
        fontSize: '0.8125rem',
      }}
    >
      <span>{label}</span>
      <span style={{ color: c, fontWeight: 700 }}>{count}</span>
    </Link>
  );
}

function SkeletonRow() {
  return (
    <div
      className="skeleton"
      style={{
        height: 56,
        borderRadius: 10,
      }}
    />
  );
}

function ChartSkeleton() {
  return (
    <div
      className="skeleton"
      style={{ height: 120, borderRadius: 8 }}
    />
  );
}
