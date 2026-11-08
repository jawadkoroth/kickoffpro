'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { formatPaise } from '@/lib/format';
import styles from './analytics.module.css';

interface LocationStat {
  country: string;
  state: string;
  city: string;
  count: number;
  percentage: number;
}

interface ActivePageStat {
  path: string;
  visitors: number;
}

interface RecentVisitor {
  id: string;
  path: string;
  location: string;
  lastActiveAt: string;
  createdAt: string;
  referrer: string | null;
}

interface LiveAnalyticsResponse {
  visitors_right_now: number;
  visitors_last_15m?: number;
  sessions_today: number;
  sessions_yesterday: number;
  sessions_vs_yesterday_pct: number;
  customer_behavior: {
    active_carts_count: number;
    active_carts_total_paise: number;
    checking_out_count: number;
    orders_today_count: number;
    orders_today_revenue_paise: number;
  };
  sessions_by_location: LocationStat[];
  top_active_pages: ActivePageStat[];
  recent_visitors: RecentVisitor[];
  timestamp: string;
}

function formatRelativeTime(dateString: string): string {
  const then = new Date(dateString).getTime();
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 15) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  return `${diffHour}h ago`;
}

export default function LiveAnalyticsPage() {
  const [data, setData] = useState<LiveAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLiveAnalytics = useCallback(async (isManual = false) => {
    try {
      if (isManual) setRefreshing(true);
      const res = await fetch('/api/admin/analytics/live', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to fetch live analytics');
      }
      setData(json.data);
      setLastSynced(new Date());
      setError(null);
    } catch (err: any) {
      console.error('[LIVE_ANALYTICS_FETCH_ERR]', err);
      setError(err.message || 'Error fetching real-time data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchLiveAnalytics();
  }, [fetchLiveAnalytics]);

  // Auto-polling every 12 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchLiveAnalytics();
    }, 12000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLiveAnalytics]);

  const behavior = data?.customer_behavior;

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.titleArea}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>Live View</h1>
            <div className={styles.livePill}>
              <span className={styles.pulsingDot} />
              <span>Live · Just now</span>
            </div>
          </div>
          <p className={styles.subtitle}>
            Real-time storefront visitors, sessions, active carts, and customer checkout flow.
          </p>
        </div>

        <div className={styles.actions}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: 'var(--live-text-secondary)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              style={{ accentColor: 'var(--live-blue)', cursor: 'pointer' }}
            />
            Auto-refresh (12s)
          </label>

          {lastSynced && (
            <span className={styles.syncBadge}>
              Synced {lastSynced.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}

          <button
            className={styles.refreshBtn}
            onClick={() => fetchLiveAnalytics(true)}
            disabled={refreshing}
          >
            <span>{refreshing ? '🔄 Syncing...' : '🔄 Refresh'}</span>
          </button>
        </div>
      </header>

      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: 'rgba(239, 68, 68, 0.1)', color: '#dc2626', fontSize: '0.875rem' }}>
          ⚠️ {error}
        </div>
      )}

      {/* KPI Top Cards */}
      <div className={styles.kpiGrid}>
        {/* Visitors Right Now */}
        <div className={`${styles.kpiCard} ${styles.kpiCardHighlight}`}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Visitors Right Now</span>
            <span className={styles.kpiIcon}>👀</span>
          </div>
          <div className={styles.kpiValueRow}>
            <span className={styles.kpiValue}>{loading ? '—' : data?.visitors_right_now ?? 0}</span>
          </div>
          <span className={styles.kpiSub}>
            Active in last 5m {data?.visitors_last_15m !== undefined ? `(${data.visitors_last_15m} in last 15m)` : ''}
          </span>
        </div>

        {/* Sessions Today */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Sessions Today</span>
            <span className={styles.kpiIcon}>📱</span>
          </div>
          <div className={styles.kpiValueRow}>
            <span className={styles.kpiValue}>{loading ? '—' : data?.sessions_today ?? 0}</span>
            {data && (
              <span
                className={
                  data.sessions_vs_yesterday_pct > 0
                    ? styles.trendBadgePositive
                    : data.sessions_vs_yesterday_pct < 0
                    ? styles.trendBadgeNegative
                    : styles.trendBadgeNeutral
                }
              >
                {data.sessions_vs_yesterday_pct >= 0 ? `+${data.sessions_vs_yesterday_pct}%` : `${data.sessions_vs_yesterday_pct}%`}
              </span>
            )}
          </div>
          <span className={styles.kpiSub}>
            Yesterday: {loading ? '—' : data?.sessions_yesterday ?? 0}
          </span>
        </div>

        {/* Active Carts */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Active Carts</span>
            <span className={styles.kpiIcon}>🛒</span>
          </div>
          <div className={styles.kpiValueRow}>
            <span className={styles.kpiValue}>{loading ? '—' : behavior?.active_carts_count ?? 0}</span>
          </div>
          <span className={styles.kpiSub}>
            Total value: {loading ? '—' : formatPaise(behavior?.active_carts_total_paise ?? 0)}
          </span>
        </div>

        {/* Checking Out */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Checking Out</span>
            <span className={styles.kpiIcon}>💳</span>
          </div>
          <div className={styles.kpiValueRow}>
            <span className={styles.kpiValue}>{loading ? '—' : behavior?.checking_out_count ?? 0}</span>
          </div>
          <span className={styles.kpiSub}>Visitors currently on /checkout</span>
        </div>

        {/* Orders Today */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Orders Today</span>
            <span className={styles.kpiIcon}>⚡</span>
          </div>
          <div className={styles.kpiValueRow}>
            <span className={styles.kpiValue}>{loading ? '—' : behavior?.orders_today_count ?? 0}</span>
          </div>
          <span className={styles.kpiSub}>
            Sales: {loading ? '—' : formatPaise(behavior?.orders_today_revenue_paise ?? 0)}
          </span>
        </div>
      </div>

      {/* Real-Time Conversion Funnel Breakdown */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span>⚡</span>
            <span>Today&apos;s Storefront Funnel</span>
          </h2>
          <span className={styles.cardMeta}>Aggregated conversion velocity</span>
        </div>
        <div className={styles.funnelGrid}>
          <div className={styles.funnelStep}>
            <span className={styles.funnelStepLabel}>1. Sessions</span>
            <span className={styles.funnelStepVal}>{loading ? '—' : data?.sessions_today ?? 0}</span>
          </div>
          <div className={styles.funnelStep}>
            <span className={styles.funnelStepLabel}>2. Added to Cart</span>
            <span className={styles.funnelStepVal}>{loading ? '—' : behavior?.active_carts_count ?? 0}</span>
          </div>
          <div className={styles.funnelStep}>
            <span className={styles.funnelStepLabel}>3. Reached Checkout</span>
            <span className={styles.funnelStepVal}>{loading ? '—' : behavior?.checking_out_count ?? 0}</span>
          </div>
          <div className={styles.funnelStep}>
            <span className={styles.funnelStepLabel}>4. Purchased Today</span>
            <span className={styles.funnelStepVal} style={{ color: '#16a34a' }}>
              {loading ? '—' : behavior?.orders_today_count ?? 0}
            </span>
          </div>
        </div>
      </div>

      {/* 2-Column Split: Geographic Location & Top Active Pages */}
      <div className={styles.layoutGrid}>
        {/* Sessions by Location */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>
              <span>🗺️</span>
              <span>Sessions by Location</span>
            </h2>
            <span className={styles.cardMeta}>Last 24 hours</span>
          </div>

          {loading && !data ? (
            <div className={styles.emptyState}>Loading location data...</div>
          ) : data?.sessions_by_location && data.sessions_by_location.length > 0 ? (
            <div className={styles.locationList}>
              {data.sessions_by_location.map((loc, idx) => (
                <div key={idx} className={styles.locationItem}>
                  <div className={styles.locationTopRow}>
                    <span className={styles.locationName}>
                      <span>📍</span>
                      <span>
                        {loc.country}
                        {loc.state !== 'Other' && loc.state !== 'Unknown' ? ` › ${loc.state}` : ''}
                        {loc.city !== 'General' && loc.city !== 'Unknown' ? ` › ${loc.city}` : ''}
                      </span>
                    </span>
                    <span className={styles.locationCount}>
                      {loc.count} session{loc.count === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className={styles.barTrack}>
                    <div className={styles.barFill} style={{ width: `${loc.percentage}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <span>📡</span>
              <span>No visitor sessions detected yet today.</span>
              <span style={{ fontSize: '0.75rem' }}>Storefront visitor locations will populate here in real-time.</span>
            </div>
          )}
        </div>

        {/* Top Active Pages */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>
              <span>📄</span>
              <span>Pages Active Right Now</span>
            </h2>
            <span className={styles.cardMeta}>Active visitors</span>
          </div>

          {loading && !data ? (
            <div className={styles.emptyState}>Loading active pages...</div>
          ) : data?.top_active_pages && data.top_active_pages.length > 0 ? (
            <table className={styles.pagesTable}>
              <thead>
                <tr>
                  <th>Page</th>
                  <th style={{ textAlign: 'right' }}>Active</th>
                </tr>
              </thead>
              <tbody>
                {data.top_active_pages.map((p, idx) => (
                  <tr key={idx}>
                    <td className={styles.pagePath}>{p.path}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span className={styles.visitorBadge}>
                        <span>👤</span>
                        <span>{p.visitors}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={styles.emptyState}>
              <span>⏳</span>
              <span>Waiting for active visitors...</span>
            </div>
          )}
        </div>
      </div>

      {/* Recent Visitor Activity Stream */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span>⚡</span>
            <span>Real-Time Visitor Activity Stream</span>
          </h2>
          <span className={styles.cardMeta}>Live stream</span>
        </div>

        {loading && !data ? (
          <div className={styles.emptyState}>Loading visitor activity...</div>
        ) : data?.recent_visitors && data.recent_visitors.length > 0 ? (
          <div className={styles.streamList}>
            {data.recent_visitors.map((visitor) => (
              <div key={visitor.id} className={styles.streamItem}>
                <div className={styles.streamLeft}>
                  <span className={styles.streamLocation}>
                    📍 {visitor.location}
                  </span>
                  <span className={styles.streamPath}>
                    Visiting: {visitor.path}
                    {visitor.referrer ? ` · via ${visitor.referrer}` : ''}
                  </span>
                </div>
                <span className={styles.streamTime}>
                  {formatRelativeTime(visitor.lastActiveAt)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <span>🕒</span>
            <span>No recent activity stream. Heartbeats from visitors will show up here as they browse.</span>
          </div>
        )}
      </div>
    </div>
  );
}

