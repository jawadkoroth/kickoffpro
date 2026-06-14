import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import styles from './diagnostics.module.css';

/**
 * KickoffPro Admin — System Health.
 *
 * Rebrand of the old "Diagnostics" surface. Same data, same queries,
 * same RLS contract — purely a visual and naming upgrade:
 *
 *   - Title: "System Health" (operator language, not dev jargon).
 *   - Stat bar counts (queued / running / failed / dead) always
 *     visible above the tabs; dead + failed glow red/amber so a
 *     single glance confirms pipeline health.
 *   - Tabs: "Events" and "Jobs" — unchanged labels, new gold active
 *     underline to match the rest of KickoffPro Admin.
 *   - Filter toolbars: compact field groups with KickoffPro input tokens.
 *   - Tables: monochrome hairline rows, mono font for code values,
 *     severity/status chips that use border+text colour rather than
 *     filled backgrounds so 100 rows don't look like a traffic light.
 *
 * Filters live in the URL (?tab, ?severity, ?source, ?q, ?request_id,
 * ?entity_id, ?status, ?kind) — unchanged for shareability / back nav.
 */

export const dynamic = 'force-dynamic';

type Tab = 'events' | 'jobs';

const SEVERITIES = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
const SOURCES = ['api', 'job', 'webhook', 'admin', 'system', 'cron'] as const;
const STATUSES = ['queued', 'running', 'succeeded', 'failed', 'dead'] as const;

const PAGE_SIZE = 100;

interface AppEventRow {
  id: string;
  created_at: string;
  severity: string;
  source: string;
  event: string;
  request_id: string | null;
  actor_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
}

interface JobRow {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  max_attempts: number;
  run_at: string;
  locked_at: string | null;
  lease_until: string | null;
  last_error: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
  payload: Record<string, unknown>;
}

interface CountsByStatus {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  dead: number;
}

export default async function DiagnosticsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    severity?: string;
    source?: string;
    q?: string;
    request_id?: string;
    entity_id?: string;
    status?: string;
    kind?: string;
  }>;
}) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === 'jobs' ? 'jobs' : 'events';
  const supabase = await createServerSupabaseClient();
  const counts = await loadJobCounts(supabase);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>System Health</h1>
            <p className={styles.subtitle}>
              Structured event log and async job queue. Read-only — except
              for dead-letter retry / discard.
            </p>
          </div>
          <Link
            href={`/admin/diagnostics?tab=${tab}`}
            className={styles.refreshLink}
          >
            ↺ Refresh
          </Link>
        </div>

        <JobSummary counts={counts} />

        <TabNav active={tab} sp={sp} />
      </header>



      {tab === 'events' ? (
        <EventsView sp={sp} />
      ) : (
        <JobsView sp={sp} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Job summary stat bar                                                */
/* ------------------------------------------------------------------ */

function JobSummary({ counts }: { counts: CountsByStatus }) {
  const cards: Array<{
    label: string;
    value: number;
    cls?: string;
  }> = [
      { label: 'Queued', value: counts.queued },
      { label: 'Running', value: counts.running, cls: counts.running > 0 ? styles.statRunning : undefined },
      { label: 'Failed', value: counts.failed, cls: counts.failed > 0 ? styles.statWarn : undefined },
      { label: 'Dead', value: counts.dead, cls: counts.dead > 0 ? styles.statAlert : undefined },
    ];

  return (
    <div className={styles.statBar}>
      {cards.map((c) => (
        <div
          key={c.label}
          className={`${styles.statCard} ${c.value === 0 ? styles.statCardDim : ''
            }`}
        >
          <span className={styles.statLabel}>{c.label}</span>
          <span className={`${styles.statValue} ${c.cls ?? ''}`}>
            {c.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab nav                                                             */
/* ------------------------------------------------------------------ */

function TabNav({
  active,
  sp,
}: {
  active: Tab;
  sp: { request_id?: string; entity_id?: string };
}) {
  const carry = new URLSearchParams();
  if (sp.request_id) carry.set('request_id', sp.request_id);
  if (sp.entity_id) carry.set('entity_id', sp.entity_id);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'events', label: 'Events' },
    { id: 'jobs', label: 'Jobs' },
  ];

  return (
    <nav className={styles.tabs}>
      {tabs.map((t) => {
        const params = new URLSearchParams(carry);
        params.set('tab', t.id);
        return (
          <Link
            key={t.id}
            href={`/admin/diagnostics?${params.toString()}`}
            className={`${styles.tabLink} ${active === t.id ? styles.tabActive : ''
              }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Events view                                                         */
/* ------------------------------------------------------------------ */

async function EventsView({
  sp,
}: {
  sp: {
    severity?: string;
    source?: string;
    q?: string;
    request_id?: string;
    entity_id?: string;
  };
}) {
  const supabase = await createServerSupabaseClient();

  let query = supabase
    .from('app_events')
    .select(
      'id, created_at, severity, source, event, request_id, actor_id, entity_type, entity_id, metadata',
    )
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (sp.severity && (SEVERITIES as readonly string[]).includes(sp.severity)) {
    query = query.eq('severity', sp.severity);
  }
  if (sp.source && (SOURCES as readonly string[]).includes(sp.source)) {
    query = query.eq('source', sp.source);
  }
  if (sp.request_id) query = query.eq('request_id', sp.request_id);
  if (sp.entity_id) query = query.eq('entity_id', sp.entity_id);
  if (sp.q) query = query.ilike('event', `%${sp.q}%`);

  const { data, error } = await query;
  const rows = (data ?? []) as AppEventRow[];

  return (
    <section>
      <EventsFilters sp={sp} />
      {error && (
        <p className={styles.queryError}>
          Failed to load events: {error.message}
        </p>
      )}
      {!error && rows.length === 0 && (
        <div className={styles.empty}>No events match the current filters.</div>
      )}
      {rows.length > 0 && <EventsTable rows={rows} />}
    </section>
  );
}

function EventsFilters({
  sp,
}: {
  sp: {
    severity?: string;
    source?: string;
    q?: string;
    request_id?: string;
    entity_id?: string;
  };
}) {
  return (
    <form method="GET" className={styles.filterBar}>
      <input type="hidden" name="tab" value="events" />

      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Severity</span>
        <select
          name="severity"
          defaultValue={sp.severity ?? ''}
          className={styles.fieldSelect}
        >
          <option value="">any</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Source</span>
        <select
          name="source"
          defaultValue={sp.source ?? ''}
          className={styles.fieldSelect}
        >
          <option value="">any</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Event contains</span>
        <input
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder="e.g. payment."
          className={styles.fieldInput}
        />
      </div>

      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Request ID</span>
        <input
          name="request_id"
          defaultValue={sp.request_id ?? ''}
          placeholder="x-request-id"
          className={styles.fieldInput}
        />
      </div>

      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Entity ID</span>
        <input
          name="entity_id"
          defaultValue={sp.entity_id ?? ''}
          placeholder="order id, etc."
          className={styles.fieldInput}
        />
      </div>

      <div className={styles.filterActions}>
        <button type="submit" className={styles.applyBtn}>Apply</button>
        <Link
          href="/admin/diagnostics?tab=events"
          className={styles.clearLink}
        >
          Clear
        </Link>
      </div>
    </form>
  );
}

function EventsTable({ rows }: { rows: AppEventRow[] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>When</th>
            <th className={styles.th}>Sev</th>
            <th className={styles.th}>Source</th>
            <th className={styles.th}>Event</th>
            <th className={styles.th}>Entity</th>
            <th className={styles.th}>Request</th>
            <th className={styles.th}>Metadata</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={styles.td}>{formatTime(r.created_at)}</td>
              <td className={styles.td}>
                <SeverityChip severity={r.severity} />
              </td>
              <td className={styles.td}>
                <code className={styles.mono}>{r.source}</code>
              </td>
              <td className={styles.td}>
                <code className={styles.mono}>{r.event}</code>
              </td>
              <td className={styles.td}>
                {r.entity_type && r.entity_id ? (
                  <Link
                    href={`/admin/diagnostics?tab=events&entity_id=${encodeURIComponent(r.entity_id)}`}
                    className={styles.entityLink}
                  >
                    {r.entity_type}:{shorten(r.entity_id)}
                  </Link>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>—</span>
                )}
              </td>
              <td className={styles.td}>
                {r.request_id ? (
                  <Link
                    href={`/admin/diagnostics?tab=events&request_id=${encodeURIComponent(r.request_id)}`}
                    className={styles.requestLink}
                  >
                    {shorten(r.request_id)}
                  </Link>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>—</span>
                )}
              </td>
              <td className={`${styles.td} ${styles.tdWrap}`}>
                <MetaPreview metadata={r.metadata} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Jobs view                                                           */
/* ------------------------------------------------------------------ */

async function JobsView({
  sp,
}: {
  sp: { status?: string; kind?: string; q?: string };
}) {
  const supabase = await createServerSupabaseClient();

  let query = supabase
    .from('job_queue')
    .select(
      'id, kind, status, attempts, max_attempts, run_at, locked_at, lease_until, last_error, idempotency_key, created_at, updated_at, payload',
    )
    .order('updated_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (sp.status && (STATUSES as readonly string[]).includes(sp.status)) {
    query = query.eq('status', sp.status);
  }
  if (sp.kind) query = query.eq('kind', sp.kind);
  if (sp.q) query = query.ilike('kind', `%${sp.q}%`);

  const { data, error } = await query;
  const rows = (data ?? []) as JobRow[];

  return (
    <section>
      <JobsFilters sp={sp} />
      {error && (
        <p className={styles.queryError}>
          Failed to load jobs: {error.message}
        </p>
      )}
      {!error && rows.length === 0 && (
        <div className={styles.empty}>No jobs match the current filters.</div>
      )}
      {rows.length > 0 && <JobsTable rows={rows} />}
    </section>
  );
}

function JobsFilters({
  sp,
}: {
  sp: { status?: string; kind?: string; q?: string };
}) {
  return (
    <form method="GET" className={styles.filterBar}>
      <input type="hidden" name="tab" value="jobs" />

      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Status</span>
        <select
          name="status"
          defaultValue={sp.status ?? ''}
          className={styles.fieldSelect}
        >
          <option value="">any</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Kind</span>
        <input
          name="kind"
          defaultValue={sp.kind ?? ''}
          placeholder="email.order_created"
          className={styles.fieldInput}
        />
      </div>

      <div className={styles.filterActions}>
        <button type="submit" className={styles.applyBtn}>Apply</button>
        <Link
          href="/admin/diagnostics?tab=jobs"
          className={styles.clearLink}
        >
          Clear
        </Link>
      </div>
    </form>
  );
}

function JobsTable({ rows }: { rows: JobRow[] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>Updated</th>
            <th className={styles.th}>Kind</th>
            <th className={styles.th}>Status</th>
            <th className={styles.th}>Attempts</th>
            <th className={styles.th}>Run at</th>
            <th className={styles.th}>Last error</th>
            <th className={styles.th}>Payload</th>
            <th className={styles.th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((j) => (
            <tr key={j.id}>
              <td className={styles.td}>{formatTime(j.updated_at)}</td>
              <td className={styles.td}>
                <code className={styles.mono}>{j.kind}</code>
              </td>
              <td className={styles.td}>
                <StatusChip status={j.status} />
              </td>
              <td className={styles.td}>
                {j.attempts} / {j.max_attempts}
              </td>
              <td className={styles.td}>{formatTime(j.run_at)}</td>
              <td className={`${styles.td} ${styles.tdWrap}`}>
                {j.last_error ? (
                  <span className={styles.errorText} title={j.last_error}>
                    {j.last_error}
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>—</span>
                )}
              </td>
              <td className={`${styles.td} ${styles.tdWrap}`}>
                <MetaPreview metadata={j.payload} />
              </td>
              <td className={styles.td}>
                {j.status === 'dead' || j.status === 'failed' ? (
                  <JobActions id={j.id} status={j.status} />
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chips                                                               */
/* ------------------------------------------------------------------ */

function SeverityChip({ severity }: { severity: string }) {
  const cls =
    severity === 'fatal' ? styles.sevFatal
      : severity === 'error' ? styles.sevError
        : severity === 'warn' ? styles.sevWarn
          : severity === 'debug' ? styles.sevDebug
            : styles.sevInfo;
  return <span className={`${styles.chip} ${cls}`}>{severity}</span>;
}

function StatusChip({ status }: { status: string }) {
  const cls =
    status === 'dead' ? styles.statusDead
      : status === 'failed' ? styles.statusFailed
        : status === 'running' ? styles.statusRunning
          : status === 'succeeded' ? styles.statusSucceeded
            : styles.statusQueued;
  return <span className={`${styles.chip} ${cls}`}>{status}</span>;
}

/* ------------------------------------------------------------------ */
/* Job actions                                                         */
/* ------------------------------------------------------------------ */

function JobActions({ id, status }: { id: string; status: string }) {
  const retry = async () => {
    await fetch(`/api/admin/jobs/${id}/retry`, { method: 'POST' });
    window.location.reload();
  };

  const archive = async () => {
    await fetch(`/api/admin/jobs/${id}/archive`, { method: 'POST' });
    window.location.reload();
  };

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {status === 'failed' && (
        <button
          onClick={retry}
          style={{
            fontSize: '0.6875rem',
            padding: '4px 8px',
            background: 'var(--warning)',
            color: 'var(--bg-primary)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      )}
      <button
        onClick={archive}
        style={{
          fontSize: '0.6875rem',
          padding: '4px 8px',
          background: 'var(--bg-input)',
          color: 'var(--text-muted)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
        }}
      >
        Archive
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Meta preview                                                        */
/* ------------------------------------------------------------------ */

function MetaPreview({ metadata }: { metadata: Record<string, unknown> }) {
  let text: string;
  try {
    text = JSON.stringify(metadata);
  } catch {
    text = '[unserializable]';
  }
  if (!text || text === '{}') {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  }
  return (
    <code className={styles.metaCode} title={text}>
      {text}
    </code>
  );
}

/* ------------------------------------------------------------------ */
/* DB helpers                                                          */
/* ------------------------------------------------------------------ */

async function loadJobCounts(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
): Promise<CountsByStatus> {
  const empty: CountsByStatus = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    dead: 0,
  };
  const results = await Promise.all(
    STATUSES.map(async (s) => {
      const { count } = await supabase
        .from('job_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', s);
      return [s, count ?? 0] as const;
    }),
  );
  const out = { ...empty };
  for (const [s, n] of results) {
    out[s] = n;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function shorten(s: string): string {
  if (s.length <= 14) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
