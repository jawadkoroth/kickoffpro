import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/log';
import { claimJobs, markSucceeded, markFailed, type JobRow } from '@/lib/jobs/queue';
import { getHandler } from '@/lib/jobs/handlers';

export interface ProcessJobsOptions {
  limit?: number;
  leaseSeconds?: number;
  maxDurationMs?: number;
  client?: SupabaseClient;
}

export interface ProcessJobsResult {
  processed: number;
  succeeded: number;
  failed: number;
  duration_ms: number;
}

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LEASE_SECONDS = 30;
const DEFAULT_MAX_DURATION_MS = 8000;

/**
 * Core job runner: claims pending/stale jobs and executes their registered handlers.
 *
 * Can be called:
 * 1. Directly from Next.js after() inside an API route for immediate execution.
 * 2. By /api/cron/process-jobs or /api/jobs/run for cron polling and retries.
 * 3. By background workers or scripts in VPS / Kubernetes environments.
 */
export async function processJobs(
  options: ProcessJobsOptions = {},
): Promise<ProcessJobsResult> {
  const startedAt = Date.now();
  const limit = options.limit ?? DEFAULT_BATCH_SIZE;
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const supabase = options.client ?? createAdminClient();

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  try {
    while (Date.now() - startedAt < maxDurationMs) {
      const jobs: JobRow[] = await claimJobs(limit, leaseSeconds, supabase);
      if (!jobs || jobs.length === 0) break;

      for (const job of jobs) {
        processed += 1;
        const handler = getHandler(job.kind);

        if (!handler) {
          const errMsg = `no handler registered for kind=${job.kind}`;
          await markFailed(
            job.id,
            {
              error: errMsg,
              attempts: job.max_attempts,
              maxAttempts: job.max_attempts,
            },
            supabase,
          );
          failed += 1;
          logEvent(
            'job.unknown_kind',
            { job_id: job.id, kind: job.kind },
            { source: 'job', severity: 'error' },
          );
          continue;
        }

        try {
          await handler(job.payload, supabase);
          await markSucceeded(job.id, supabase);
          succeeded += 1;
          logEvent(
            'job.succeeded',
            { job_id: job.id, kind: job.kind, attempts: job.attempts },
            { source: 'job', entityType: 'job', entityId: job.id },
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await markFailed(
            job.id,
            {
              error: msg,
              attempts: job.attempts,
              maxAttempts: job.max_attempts,
            },
            supabase,
          );
          failed += 1;
          logEvent(
            'job.failed',
            {
              job_id: job.id,
              kind: job.kind,
              attempts: job.attempts,
              max_attempts: job.max_attempts,
              error: msg,
            },
            { source: 'job', severity: 'warn', entityType: 'job', entityId: job.id },
          );
        }
      }

      // If we got fewer than batch limit, the queue is currently drained
      if (jobs.length < limit) break;
    }
  } catch (err) {
    const topError = err instanceof Error ? err.message : String(err);
    logEvent(
      'job.runner_unhandled',
      { error: topError },
      { source: 'job', severity: 'error' },
    );
  }

  return {
    processed,
    succeeded,
    failed,
    duration_ms: Date.now() - startedAt,
  };
}
