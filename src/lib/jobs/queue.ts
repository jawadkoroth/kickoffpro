import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/log';

/**
 * KickoffPro job queue — thin wrapper around the `job_queue` table.
 *
 * Design goals:
 *   * Zero external infra. Single Postgres-backed queue, claimed
 *     with FOR UPDATE SKIP LOCKED via the `claim_jobs` RPC.
 *   * Fire-and-forget safe: `enqueue()` never throws. A failed
 *     enqueue lands in app_events with severity=error so admin
 *     diagnostics catch it, but the business action (order, webhook)
 *     completes regardless.
 *   * Idempotent: pass `idempotencyKey` when a retry of the same
 *     business action must not produce duplicate jobs. The UNIQUE
 *     index collapses concurrent inserts to one row.
 */

export interface EnqueueInput {
  kind: string;
  payload: Record<string, unknown>;
  /** ISO timestamp or Date — defaults to now. */
  runAt?: Date | string;
  /** When set, a second enqueue with the same key is a no-op. */
  idempotencyKey?: string;
  /** Override the default 5 attempts per job. */
  maxAttempts?: number;
}

export interface JobRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'dead';
  attempts: number;
  max_attempts: number;
  run_at: string;
  locked_at: string | null;
  lease_until: string | null;
  last_error: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Insert a job. Uses the supplied supabase admin client (or creates
 * one) so callers inside a request can reuse their client for
 * locality, and cron can create a fresh one.
 *
 * Returns the enqueued job id on success, `null` on failure / dedupe.
 * Never throws.
 */
export async function enqueue(
  input: EnqueueInput,
  client?: SupabaseClient,
): Promise<string | null> {
  const supabase = client ?? createAdminClient();
  try {
    const runAtIso =
      input.runAt instanceof Date
        ? input.runAt.toISOString()
        : input.runAt ?? new Date().toISOString();

    const row = {
      kind: input.kind,
      payload: input.payload ?? {},
      run_at: runAtIso,
      max_attempts: input.maxAttempts ?? 5,
      idempotency_key: input.idempotencyKey ?? null,
    };

    // When an idempotency_key collides we get a unique-violation.
    // Treat that as a successful no-op — the job already exists.
    const { data, error } = await supabase
      .from('job_queue')
      .insert(row)
      .select('id')
      .single();

    if (error) {
      // Postgres unique_violation SQLSTATE: 23505
      if ((error as { code?: string }).code === '23505') {
        return null;
      }
      logEvent('job.enqueue_failed', {
        kind: input.kind,
        error: error.message,
      });
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    logEvent('job.enqueue_failed', {
      kind: input.kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Claim the next batch of due jobs. Runs inside the cron endpoint.
 * The RPC atomically flips rows from `queued` (or stale `running`)
 * into `running` and bumps `attempts`, so we never double-run.
 */
export async function claimJobs(
  limit: number,
  leaseSeconds: number,
  client?: SupabaseClient,
): Promise<JobRow[]> {
  const supabase = client ?? createAdminClient();
  const { data, error } = await supabase.rpc('claim_jobs', {
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });
  if (error) {
    logEvent(
      'job.claim_failed',
      { error: error.message },
      { source: 'cron' },
    );
    return [];
  }
  return (data ?? []) as JobRow[];
}

export async function markSucceeded(
  jobId: string,
  client?: SupabaseClient,
): Promise<void> {
  const supabase = client ?? createAdminClient();
  const { error } = await supabase
    .from('job_queue')
    .update({
      status: 'succeeded',
      last_error: null,
      locked_at: null,
      lease_until: null,
    })
    .eq('id', jobId);
  if (error) {
    logEvent('job.mark_succeeded_failed', { job_id: jobId, error: error.message });
  }
}

export interface MarkFailedOptions {
  error: string;
  /** Already incremented attempts count; used to decide dead vs retry. */
  attempts: number;
  maxAttempts: number;
}

/**
 * Mark a job failed. If attempts exhausted → 'dead' (human attention
 * required); otherwise schedule a retry with exponential backoff
 * (30s × 2^attempts, capped at 10 min).
 */
export async function markFailed(
  jobId: string,
  opts: MarkFailedOptions,
  client?: SupabaseClient,
): Promise<void> {
  const supabase = client ?? createAdminClient();
  const dead = opts.attempts >= opts.maxAttempts;
  const backoffMs = dead
    ? 0
    : Math.min(30_000 * Math.pow(2, Math.max(0, opts.attempts - 1)), 10 * 60_000);
  const runAt = new Date(Date.now() + backoffMs).toISOString();

  const { error } = await supabase
    .from('job_queue')
    .update({
      status: dead ? 'dead' : 'queued',
      last_error: opts.error.slice(0, 2000),
      locked_at: null,
      lease_until: null,
      run_at: runAt,
    })
    .eq('id', jobId);
  if (error) {
    logEvent('job.mark_failed_failed', { job_id: jobId, error: error.message });
  }
  if (dead) {
    logEvent(
      'job.dead',
      { job_id: jobId, error: opts.error, attempts: opts.attempts },
      { severity: 'error', source: 'job' },
    );
  }
}
