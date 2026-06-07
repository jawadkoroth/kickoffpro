import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestContext } from '@/lib/observability/context';

/**
 * Structured logger for server-side events — KickoffPro observability spine.
 *
 * Two sinks, both best-effort:
 *
 *   1. stdout (single JSON line) — keeps logs trivially grep-able
 *      and ingestible by any downstream platform (Vercel log drain,
 *      Datadog, Logtail) with zero configuration.
 *
 *   2. Postgres `app_events` table — persistent, queryable surface
 *      behind `/admin/diagnostics`. Written via the service-role
 *      admin client so RLS never blocks inserts.
 *
 * Hard rules:
 *   - NEVER throws (callers rely on this).
 *   - NEVER blocks the caller — DB write is fire-and-forget.
 *   - Backward compatible: the old `logEvent(event, data)` signature
 *     still works. New severity / source / entity metadata is opt-in
 *     via `logEvent(event, data, opts)`.
 *
 * Request correlation:
 *   - If the current async context carries a `request_id` (set by
 *     middleware via `withRequestContext`), it's auto-attached to
 *     both sinks. Same for `actor_id` when the route handler has
 *     promoted the user id via `setActor()`.
 */

export type Severity = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type EventSource = 'api' | 'job' | 'webhook' | 'admin' | 'system' | 'cron';

export interface LogOptions {
  severity?: Severity;
  source?: EventSource;
  entityType?: string;
  entityId?: string | null;
  actorId?: string | null;
  /** Explicit override when outside an async request context. */
  requestId?: string | null;
}

/**
 * When the process is running at build time (no env, no DB) we still
 * want stdout to work. Guard DB writes behind env presence so the
 * Next.js build step doesn't blow up on missing SUPABASE_SERVICE_ROLE_KEY.
 */
function canPersist(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/**
 * Infer severity from the event name when the caller hasn't set one.
 * Pure convenience — anything matching *_failed / *_error / *.failed
 * / *.denied / *.unauthorised tips to 'error' so admin diagnostics
 * auto-surface them without forcing every call site to pass opts.
 */
function inferSeverity(event: string): Severity {
  const e = event.toLowerCase();
  if (/\.(fatal|panic)(\.|$)/.test(e)) return 'fatal';
  if (/(failed|error|denied|unauth|exception|rejected)(\.|_|$)/.test(e))
    return 'error';
  if (/(warn|retry|misconfigured|deprecated|throttled)(\.|_|$)/.test(e))
    return 'warn';
  return 'info';
}

export function logEvent(
  event: string,
  data?: Record<string, unknown>,
  opts?: LogOptions,
): void {
  const ts = new Date().toISOString();
  const ctx = getRequestContext();
  const requestId = opts?.requestId ?? ctx?.requestId ?? null;
  const actorId = opts?.actorId ?? ctx?.actorId ?? null;
  const severity: Severity = opts?.severity ?? inferSeverity(event);
  const source: EventSource = opts?.source ?? 'api';
  const entityType = opts?.entityType ?? null;
  const entityId = opts?.entityId ?? null;

  // ---- stdout sink ------------------------------------------------
  try {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        ts,
        event,
        severity,
        source,
        request_id: requestId ?? undefined,
        actor_id: actorId ?? undefined,
        entity_type: entityType ?? undefined,
        entity_id: entityId ?? undefined,
        ...(data ?? {}),
      }),
    );
  } catch {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({ ts, event, severity, source, log_serialization_failed: true }),
    );
  }

  // ---- DB sink (fire-and-forget) ----------------------------------
  // We intentionally do not `await` this. Persistence latency must
  // never show up on the user-facing request. Any failure lands in
  // stdout as a secondary log line and we move on.
  if (canPersist() && event !== 'app_events.persist_failed') {
    void persistEvent({
      ts,
      event,
      severity,
      source,
      requestId,
      actorId,
      entityType,
      entityId,
      metadata: safeMetadata(data),
    });
  }
}

/**
 * Drop functions, circular refs, and anything non-JSON-stringifiable
 * so the JSONB insert never fails on us. Keeps the insert payload
 * small by removing `undefined` entries.
 */
function safeMetadata(data?: Record<string, unknown>): Record<string, unknown> {
  if (!data) return {};
  try {
    // Roundtrip via JSON scrubs non-serialisable values.
    const clean = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
    return clean ?? {};
  } catch {
    return { _serialization: 'failed' };
  }
}

interface PersistInput {
  ts: string;
  event: string;
  severity: Severity;
  source: EventSource;
  requestId: string | null;
  actorId: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
}

async function persistEvent(input: PersistInput): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from('app_events').insert({
      created_at: input.ts,
      event: input.event,
      severity: input.severity,
      source: input.source,
      request_id: input.requestId,
      actor_id: input.actorId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      metadata: input.metadata,
    });
    if (error) {
      // Avoid infinite recursion — use the reserved event name that
      // the top-level `logEvent` short-circuits on.
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: 'app_events.persist_failed',
          severity: 'warn',
          error: error.message,
        }),
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'app_events.persist_failed',
        severity: 'warn',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
