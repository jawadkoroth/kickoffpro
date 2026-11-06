'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { formatPaise } from '@/lib/format';
import styles from './ads.module.css';

interface ProviderHealth {
  configured: boolean;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  successRate: number;
  lastEventAt: string | null;
}

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

interface AdsData {
  overview: {
    grossSalesPaise: number;
    totalOrders: number;
    aovPaise: number;
    prepaidCount: number;
    codCount: number;
    prepaidRatio: number;
    attributedOrdersCount: number;
    attributedSalesPaise: number;
    attributionRate: number;
  };
  capiHealth: {
    queue: {
      total: number;
      succeeded: number;
      failed: number;
      pending: number;
      successRate: number;
    };
    providers: {
      meta: ProviderHealth;
      google: ProviderHealth;
      snapchat: ProviderHealth;
    };
    recentLogs: Array<{
      id: string;
      event: string;
      severity: string;
      created_at: string;
      data: Record<string, any>;
    }>;
  };
  campaigns: CampaignRow[];
}

type SortField = 'revenue' | 'orders' | 'checkouts' | 'conversionRate';
type SourceFilter = 'all' | 'meta' | 'google' | 'snapchat' | 'organic';

export default function AdminAdsPage() {
  const [data, setData] = useState<AdsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // Table filtering and sorting
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('revenue');
  const [sortAsc, setSortAsc] = useState(false);

  // Observability Log view toggle
  const [showLogs, setShowLogs] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  async function loadData(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/ads', {
        headers: { 'Cache-Control': 'no-cache' },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to load ads and attribution data');
      }

      setData(json.data);
      setLastRefreshed(new Date());
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // Filtered & Sorted campaigns
  const filteredCampaigns = useMemo(() => {
    if (!data?.campaigns) return [];

    let list = [...data.campaigns];

    // Source Filter
    if (sourceFilter !== 'all') {
      list = list.filter((c) => {
        const src = c.source.toLowerCase();
        if (sourceFilter === 'meta') {
          return src.includes('meta') || src.includes('fb') || src.includes('facebook') || src.includes('ig') || src.includes('instagram');
        }
        if (sourceFilter === 'google') {
          return src.includes('google') || src.includes('gads') || src.includes('youtube');
        }
        if (sourceFilter === 'snapchat') {
          return src.includes('snap') || src.includes('snapchat');
        }
        if (sourceFilter === 'organic') {
          return src.includes('organic') || src.includes('direct') || src === 'none';
        }
        return true;
      });
    }

    // Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (c) =>
          c.campaign.toLowerCase().includes(q) ||
          c.source.toLowerCase().includes(q) ||
          c.medium.toLowerCase().includes(q),
      );
    }

    // Sort
    list.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'revenue':
          comparison = b.revenuePaise - a.revenuePaise;
          break;
        case 'orders':
          comparison = b.paidOrders - a.paidOrders;
          break;
        case 'checkouts':
          comparison = b.totalCheckouts - a.totalCheckouts;
          break;
        case 'conversionRate':
          comparison = b.conversionRate - a.conversionRate;
          break;
      }
      return sortAsc ? -comparison : comparison;
    });

    return list;
  }, [data?.campaigns, sourceFilter, searchQuery, sortField, sortAsc]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  }

  function getSourceBadgeClass(source: string) {
    const s = source.toLowerCase();
    if (s.includes('meta') || s.includes('fb') || s.includes('facebook') || s.includes('ig') || s.includes('instagram')) {
      return styles.sourceMeta;
    }
    if (s.includes('google') || s.includes('gads') || s.includes('youtube')) {
      return styles.sourceGoogle;
    }
    if (s.includes('snap') || s.includes('snapchat')) {
      return styles.sourceSnap;
    }
    return styles.sourceOrganic;
  }

  function formatTimeAgo(dateStr: string | null) {
    if (!dateStr) return 'Never';
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.titleArea}>
          <h1 className={styles.title}>
            <span>🎯</span> Ads Management & Observability
          </h1>
          <p className={styles.subtitle}>
            Monitor server-side Meta CAPI, Google Enhanced Conversions, and paid campaign performance.
          </p>
        </div>

        <div className={styles.headerActions}>
          {lastRefreshed && (
            <span className={styles.lastUpdated}>
              Updated {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            className={styles.refreshButton}
            onClick={() => loadData(true)}
            disabled={loading || refreshing}
          >
            <span style={{ display: 'inline-block', transform: refreshing ? 'rotate(180deg)' : 'none', transition: 'transform 300ms' }}>
              🔄
            </span>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div
          style={{
            padding: '12px 16px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: '8px',
            color: 'var(--ads-error)',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>⚠️ {error}</span>
          <button
            onClick={() => loadData()}
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              fontWeight: 700,
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* 1. Dashboard Overview */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>
            <span>📊</span> Performance Overview
          </h2>
          <span className={styles.sectionDesc}>High-level e-commerce metrics synced directly with database orders</span>
        </div>

        <div className={styles.overviewGrid}>
          {/* Gross Sales */}
          <div className={styles.kpiCard}>
            <div className={styles.kpiCardTop}>
              <span className={styles.kpiLabel}>Gross Sales</span>
              <span className={styles.kpiIcon}>💰</span>
            </div>
            <div className={styles.kpiValue}>
              {loading ? <div className={styles.skeleton} style={{ width: 120, height: 32 }} /> : formatPaise(data?.overview.grossSalesPaise)}
            </div>
            <div className={styles.kpiSubtext}>
              {loading ? (
                <div className={styles.skeleton} style={{ width: 80, height: 16 }} />
              ) : (
                <>
                  <span className={styles.badgeHighlight}>{data?.overview.totalOrders || 0}</span> total orders placed
                </>
              )}
            </div>
          </div>

          {/* Average Order Value (AOV) */}
          <div className={styles.kpiCard}>
            <div className={styles.kpiCardTop}>
              <span className={styles.kpiLabel}>Average Order Value</span>
              <span className={styles.kpiIcon}>🏷️</span>
            </div>
            <div className={styles.kpiValue}>
              {loading ? <div className={styles.skeleton} style={{ width: 100, height: 32 }} /> : formatPaise(data?.overview.aovPaise)}
            </div>
            <div className={styles.kpiSubtext}>
              <span>Per paid transaction</span>
            </div>
          </div>

          {/* Prepaid vs COD Ratio */}
          <div className={styles.kpiCard}>
            <div className={styles.kpiCardTop}>
              <span className={styles.kpiLabel}>Prepaid Ratio</span>
              <span className={styles.kpiIcon}>⚡</span>
            </div>
            <div className={styles.kpiValue}>
              {loading ? <div className={styles.skeleton} style={{ width: 80, height: 32 }} /> : `${data?.overview.prepaidRatio || 0}%`}
            </div>
            <div className={styles.kpiSubtext}>
              {loading ? (
                <div className={styles.skeleton} style={{ width: 120, height: 16 }} />
              ) : (
                <>
                  <span className={styles.badgeSuccess}>{data?.overview.prepaidCount || 0} Online</span>
                  <span>vs {data?.overview.codCount || 0} COD</span>
                </>
              )}
            </div>
          </div>

          {/* Marketing Attributed Orders */}
          <div className={styles.kpiCard}>
            <div className={styles.kpiCardTop}>
              <span className={styles.kpiLabel}>Attributed Sales</span>
              <span className={styles.kpiIcon}>🎯</span>
            </div>
            <div className={styles.kpiValue}>
              {loading ? <div className={styles.skeleton} style={{ width: 120, height: 32 }} /> : formatPaise(data?.overview.attributedSalesPaise)}
            </div>
            <div className={styles.kpiSubtext}>
              {loading ? (
                <div className={styles.skeleton} style={{ width: 100, height: 16 }} />
              ) : (
                <>
                  <span className={styles.badgeHighlight}>{data?.overview.attributedOrdersCount || 0} orders</span>
                  <span>({data?.overview.attributionRate || 0}% of volume)</span>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 2. Ad Attribution & CAPI Observability Widget */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>
            <span>📡</span> Server-Side CAPI & Tracking Health
          </h2>
          <span className={styles.sectionDesc}>Real-time delivery verification for Meta, Google Ads, and background job queue</span>
        </div>

        <div className={styles.capiGrid}>
          {/* Meta CAPI */}
          <div className={styles.capiProviderCard}>
            <div className={styles.capiProviderHeader}>
              <div className={styles.providerBrand}>
                <div className={`${styles.providerLogo} ${styles.metaLogo}`}>f</div>
                <div>
                  <div className={styles.providerName}>Meta Conversions API</div>
                  <div className={styles.providerSub}>Facebook & Instagram Pixel CAPI</div>
                </div>
              </div>
              <div>
                {data?.capiHealth.providers.meta.configured ? (
                  <span className={`${styles.statusPill} ${styles.statusPillOnline}`}>
                    <span className={styles.pulseDot} /> Online
                  </span>
                ) : (
                  <span className={`${styles.statusPill} ${styles.statusPillOffline}`}>
                    <span className={styles.pulseDot} /> Token Missing
                  </span>
                )}
              </div>
            </div>

            <div className={styles.capiStatsRow}>
              <div className={styles.capiStatItem}>
                <span className={styles.capiStatVal} style={{ color: 'var(--ads-success)' }}>
                  {data?.capiHealth.providers.meta.successCount || 0}
                </span>
                <span className={styles.capiStatLbl}>Delivered</span>
              </div>
              <div className={styles.capiStatItem}>
                <span className={styles.capiStatVal} style={{ color: 'var(--ads-error)' }}>
                  {data?.capiHealth.providers.meta.errorCount || 0}
                </span>
                <span className={styles.capiStatLbl}>Errors</span>
              </div>
              <div className={styles.capiStatItem}>
                <span className={styles.capiStatVal} style={{ color: 'var(--ads-text-muted)' }}>
                  {data?.capiHealth.providers.meta.skippedCount || 0}
                </span>
                <span className={styles.capiStatLbl}>Skipped</span>
              </div>
            </div>

            <div className={styles.rateBarWrapper}>
              <div className={styles.rateBarLabels}>
                <span>Delivery Success Rate</span>
                <span>{data?.capiHealth.providers.meta.successRate || 0}%</span>
              </div>
              <div className={styles.rateTrack}>
                <div
                  className={`${styles.rateFill} ${(data?.capiHealth.providers.meta.successRate || 0) < 90 ? styles.rateFillWarning : ''}`}
                  style={{ width: `${data?.capiHealth.providers.meta.successRate || 0}%` }}
                />
              </div>
            </div>

            <div className={styles.lastEventText}>
              Last transmission: {formatTimeAgo(data?.capiHealth.providers.meta.lastEventAt || null)}
            </div>
          </div>

          {/* Google Enhanced Conversions */}
          <div className={styles.capiProviderCard}>
            <div className={styles.capiProviderHeader}>
              <div className={styles.providerBrand}>
                <div className={`${styles.providerLogo} ${styles.googleLogo}`}>G</div>
                <div>
                  <div className={styles.providerName}>Google Enhanced Conversions</div>
                  <div className={styles.providerSub}>Measurement Protocol & GA4 API</div>
                </div>
              </div>
              <div>
                {data?.capiHealth.providers.google.configured ? (
                  <span className={`${styles.statusPill} ${styles.statusPillOnline}`}>
                    <span className={styles.pulseDot} /> Online
                  </span>
                ) : (
                  <span className={`${styles.statusPill} ${styles.statusPillOffline}`}>
                    <span className={styles.pulseDot} /> Secret Missing
                  </span>
                )}
              </div>
            </div>

            <div className={styles.capiStatsRow}>
              <div className={styles.capiStatItem}>
                <span className={styles.capiStatVal} style={{ color: 'var(--ads-success)' }}>
                  {data?.capiHealth.providers.google.successCount || 0}
                </span>
                <span className={styles.capiStatLbl}>Delivered</span>
              </div>
              <div className={styles.capiStatItem}>
                <span className={styles.capiStatVal} style={{ color: 'var(--ads-error)' }}>
                  {data?.capiHealth.providers.google.errorCount || 0}
                </span>
                <span className={styles.capiStatLbl}>Errors</span>
              </div>
              <div className={styles.capiStatItem}>
                <span className={styles.capiStatVal} style={{ color: 'var(--ads-text-muted)' }}>
                  {data?.capiHealth.providers.google.skippedCount || 0}
                </span>
                <span className={styles.capiStatLbl}>Skipped</span>
              </div>
            </div>

            <div className={styles.rateBarWrapper}>
              <div className={styles.rateBarLabels}>
                <span>Delivery Success Rate</span>
                <span>{data?.capiHealth.providers.google.successRate || 0}%</span>
              </div>
              <div className={styles.rateTrack}>
                <div
                  className={`${styles.rateFill} ${(data?.capiHealth.providers.google.successRate || 0) < 90 ? styles.rateFillWarning : ''}`}
                  style={{ width: `${data?.capiHealth.providers.google.successRate || 0}%` }}
                />
              </div>
            </div>

            <div className={styles.lastEventText}>
              Last transmission: {formatTimeAgo(data?.capiHealth.providers.google.lastEventAt || null)}
            </div>
          </div>

          {/* Snapchat CAPI */}
          <div className={styles.capiProviderCard}>
            <div className={styles.capiProviderHeader}>
              <div className={styles.providerBrand}>
                <div className={`${styles.providerLogo} ${styles.snapLogo}`}>👻</div>
                <div>
                  <div className={styles.providerName}>Snapchat CAPI</div>
                  <div className={styles.providerSub}>Conversion API v3</div>
                </div>
              </div>
              <div>
                {data?.capiHealth.providers.snapchat.configured ? (
                  <span className={`${styles.statusPill} ${styles.statusPillOnline}`}>
                    <span className={styles.pulseDot} /> Online
                  </span>
                ) : (
                  <span className={`${styles.statusPill} ${styles.statusPillOffline}`}>
                    <span className={styles.pulseDot} /> Not Configured
                  </span>
                )}
              </div>
            </div>

            <div className={styles.capiStatsRow}>
              <div className={styles.capiStatItem}>
                <span className={styles.capiStatVal} style={{ color: 'var(--ads-success)' }}>
                  {data?.capiHealth.providers.snapchat.successCount || 0}
                </span>
                <span className={styles.capiStatLbl}>Delivered</span>
              </div>
              <div className={styles.capiStatItem}>
                <span className={styles.capiStatVal} style={{ color: 'var(--ads-error)' }}>
                  {data?.capiHealth.providers.snapchat.errorCount || 0}
                </span>
                <span className={styles.capiStatLbl}>Errors</span>
              </div>
              <div className={styles.capiStatItem}>
                <span className={styles.capiStatVal} style={{ color: 'var(--ads-text-muted)' }}>
                  {data?.capiHealth.providers.snapchat.skippedCount || 0}
                </span>
                <span className={styles.capiStatLbl}>Skipped</span>
              </div>
            </div>

            <div className={styles.rateBarWrapper}>
              <div className={styles.rateBarLabels}>
                <span>Delivery Success Rate</span>
                <span>{data?.capiHealth.providers.snapchat.successRate || 0}%</span>
              </div>
              <div className={styles.rateTrack}>
                <div
                  className={`${styles.rateFill} ${(data?.capiHealth.providers.snapchat.successRate || 0) < 90 ? styles.rateFillWarning : ''}`}
                  style={{ width: `${data?.capiHealth.providers.snapchat.successRate || 0}%` }}
                />
              </div>
            </div>

            <div className={styles.lastEventText}>
              Last transmission: {formatTimeAgo(data?.capiHealth.providers.snapchat.lastEventAt || null)}
            </div>
          </div>

          {/* Job Queue Health */}
          <div className={styles.capiProviderCard}>
            <div className={styles.capiProviderHeader}>
              <div className={styles.providerBrand}>
                <div className={`${styles.providerLogo} ${styles.queueLogo}`}>⚙️</div>
                <div>
                  <div className={styles.providerName}>Job Queue Pipeline</div>
                  <div className={styles.providerSub}>tracking.capi_purchase background workers</div>
                </div>
              </div>
              <div>
                {(data?.capiHealth.queue.failed || 0) === 0 ? (
                  <span className={`${styles.statusPill} ${styles.statusPillOnline}`}>
                    <span className={styles.pulseDot} /> Healthy
                  </span>
                ) : (
                  <span className={`${styles.statusPill} ${styles.statusPillPending}`}>
                    <span className={styles.pulseDot} /> Attention
                  </span>
                )}
              </div>
            </div>

            <div className={styles.capiStatsRow}>
              <div className={styles.capiStatItem}>
                <span className={styles.capiStatVal} style={{ color: 'var(--ads-success)' }}>
                  {data?.capiHealth.queue.succeeded || 0}
                </span>
                <span className={styles.capiStatLbl}>Succeeded</span>
              </div>
              <div className={styles.capiStatItem}>
                <span className={styles.capiStatVal} style={{ color: 'var(--ads-error)' }}>
                  {data?.capiHealth.queue.failed || 0}
                </span>
                <span className={styles.capiStatLbl}>Failed</span>
              </div>
              <div className={styles.capiStatItem}>
                <span className={styles.capiStatVal} style={{ color: 'var(--ads-info)' }}>
                  {data?.capiHealth.queue.pending || 0}
                </span>
                <span className={styles.capiStatLbl}>Pending</span>
              </div>
            </div>

            <div className={styles.rateBarWrapper}>
              <div className={styles.rateBarLabels}>
                <span>Pipeline Health Rate</span>
                <span>{data?.capiHealth.queue.successRate || 100}%</span>
              </div>
              <div className={styles.rateTrack}>
                <div
                  className={`${styles.rateFill} ${(data?.capiHealth.queue.successRate || 100) < 90 ? styles.rateFillError : ''}`}
                  style={{ width: `${data?.capiHealth.queue.successRate || 100}%` }}
                />
              </div>
            </div>

            <div className={styles.lastEventText}>
              Total processed jobs: {data?.capiHealth.queue.total || 0}
            </div>
          </div>
        </div>

        {/* Collapsible Recent Logs Drawer */}
        <div style={{ marginTop: '8px' }}>
          <button
            onClick={() => setShowLogs(!showLogs)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--ads-primary)',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>{showLogs ? '▼' : '▶'}</span>
            <span>{showLogs ? 'Hide Live Transmission Logs' : 'View Live CAPI Transmission Logs (app_events)'}</span>
          </button>

          {showLogs && (
            <div className={styles.cardContainer} style={{ marginTop: 12 }}>
              <div className={styles.tableWrapper}>
                <table className={styles.logsTable}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Time</th>
                      <th className={styles.th}>Event</th>
                      <th className={styles.th}>Severity</th>
                      <th className={styles.th}>Payload / Metadata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.capiHealth.recentLogs || []).length === 0 ? (
                      <tr>
                        <td colSpan={4} className={styles.emptyState}>
                          No recent CAPI events logged yet. Place an order or trigger CAPI test to see activity.
                        </td>
                      </tr>
                    ) : (
                      (data?.capiHealth.recentLogs || []).map((log) => {
                        const isExpanded = expandedLogId === log.id;
                        const isSuccess = log.event.includes('success');
                        const isErr = log.event.includes('error') || log.event.includes('exception');
                        return (
                          <React.Fragment key={log.id}>
                            <tr className={styles.tr}>
                              <td className={styles.td} style={{ whiteSpace: 'nowrap', color: 'var(--ads-text-muted)' }}>
                                {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </td>
                              <td className={styles.td}>
                                <span className={`${styles.logEventTag} ${isSuccess ? styles.logSuccess : isErr ? styles.logError : styles.logInfo}`}>
                                  {log.event}
                                </span>
                              </td>
                              <td className={styles.td}>
                                <span style={{ textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 700 }}>
                                  {log.severity}
                                </span>
                              </td>
                              <td className={styles.td}>
                                <button
                                  onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                                  style={{
                                    background: 'var(--ads-card-secondary)',
                                    border: '1px solid var(--ads-border)',
                                    borderRadius: '4px',
                                    padding: '2px 8px',
                                    fontSize: '0.7rem',
                                    cursor: 'pointer',
                                    color: 'var(--ads-text-secondary)',
                                  }}
                                >
                                  {isExpanded ? 'Hide JSON' : 'Inspect JSON'}
                                </button>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr>
                                <td colSpan={4} style={{ padding: '0 16px 14px 16px', background: 'rgba(15, 23, 42, 0.02)' }}>
                                  <pre className={styles.logPayloadJson}>
                                    {JSON.stringify(log.data, null, 2)}
                                  </pre>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 3. UTM & Campaign Performance Table */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>
            <span>🎯</span> UTM & Campaign Attribution Table
          </h2>
          <span className={styles.sectionDesc}>
            Grouped by Source, Medium, and Campaign to isolate paid ROAS vs abandoned carts
          </span>
        </div>

        <div className={styles.cardContainer}>
          {/* Toolbar */}
          <div className={styles.toolbar}>
            {/* Filter Chips */}
            <div className={styles.filterChips}>
              {(['all', 'meta', 'google', 'snapchat', 'organic'] as SourceFilter[]).map((f) => (
                <button
                  key={f}
                  className={`${styles.chip} ${sourceFilter === f ? styles.chipActive : ''}`}
                  onClick={() => setSourceFilter(f)}
                >
                  {f === 'all'
                    ? 'All Sources'
                    : f === 'meta'
                    ? 'Meta (FB/IG)'
                    : f === 'google'
                    ? 'Google Ads'
                    : f === 'snapchat'
                    ? 'Snapchat'
                    : 'Organic / Direct'}
                </button>
              ))}
            </div>

            {/* Search Box */}
            <div className={styles.searchBox}>
              <span style={{ fontSize: '0.85rem', marginRight: 6 }}>🔍</span>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search campaigns..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ads-text-muted)' }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Source</th>
                  <th className={styles.th}>Medium</th>
                  <th className={styles.th}>Campaign</th>
                  <th
                    className={`${styles.th} ${styles.thSortable}`}
                    onClick={() => handleSort('checkouts')}
                  >
                    Checkouts {sortField === 'checkouts' ? (sortAsc ? '▲' : '▼') : ''}
                  </th>
                  <th
                    className={`${styles.th} ${styles.thSortable}`}
                    onClick={() => handleSort('orders')}
                  >
                    Paid Orders {sortField === 'orders' ? (sortAsc ? '▲' : '▼') : ''}
                  </th>
                  <th className={styles.th}>Abandoned</th>
                  <th
                    className={`${styles.th} ${styles.thSortable}`}
                    onClick={() => handleSort('conversionRate')}
                  >
                    Conv. Rate {sortField === 'conversionRate' ? (sortAsc ? '▲' : '▼') : ''}
                  </th>
                  <th
                    className={`${styles.th} ${styles.thSortable}`}
                    onClick={() => handleSort('revenue')}
                  >
                    Revenue {sortField === 'revenue' ? (sortAsc ? '▲' : '▼') : ''}
                  </th>
                  <th className={styles.th}>AOV</th>
                  <th className={styles.th}>Payment Split</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className={styles.tr}>
                      <td colSpan={10} style={{ padding: '16px' }}>
                        <div className={styles.skeleton} style={{ width: '100%', height: 24 }} />
                      </td>
                    </tr>
                  ))
                ) : filteredCampaigns.length === 0 ? (
                  <tr>
                    <td colSpan={10} className={styles.emptyState}>
                      No marketing campaigns found matching the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredCampaigns.map((row, idx) => (
                    <tr key={`${row.source}-${row.medium}-${row.campaign}-${idx}`} className={styles.tr}>
                      {/* Source */}
                      <td className={styles.td}>
                        <span className={`${styles.sourcePill} ${getSourceBadgeClass(row.source)}`}>
                          {row.source}
                        </span>
                      </td>

                      {/* Medium */}
                      <td className={styles.td}>
                        <span className={styles.mediumTag}>{row.medium}</span>
                      </td>

                      {/* Campaign */}
                      <td className={styles.td}>
                        <span className={styles.campaignName}>{row.campaign}</span>
                      </td>

                      {/* Checkouts */}
                      <td className={styles.td}>
                        <span>{row.totalCheckouts}</span>
                      </td>

                      {/* Paid Orders */}
                      <td className={styles.td}>
                        <span className={styles.metricBold}>{row.paidOrders}</span>
                      </td>

                      {/* Abandoned */}
                      <td className={styles.td}>
                        <span style={{ color: row.abandonedOrders > 0 ? 'var(--ads-error)' : 'inherit' }}>
                          {row.abandonedOrders}
                        </span>
                      </td>

                      {/* Conversion Rate */}
                      <td className={styles.td}>
                        <div className={styles.conversionBar}>
                          <div className={styles.miniProgress}>
                            <div
                              className={styles.miniFill}
                              style={{ width: `${Math.min(100, row.conversionRate)}%` }}
                            />
                          </div>
                          <span style={{ fontWeight: 600 }}>{row.conversionRate}%</span>
                        </div>
                      </td>

                      {/* Revenue */}
                      <td className={styles.td}>
                        <span className={styles.metricBold} style={{ color: 'var(--ads-navy)' }}>
                          {formatPaise(row.revenuePaise)}
                        </span>
                      </td>

                      {/* AOV */}
                      <td className={styles.td}>
                        <span>{formatPaise(row.aovPaise)}</span>
                      </td>

                      {/* Payment Split */}
                      <td className={styles.td}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--ads-text-muted)' }}>
                          <span style={{ color: 'var(--ads-success)', fontWeight: 600 }}>{row.prepaidCount} Prepaid</span> / {row.codCount} COD
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

