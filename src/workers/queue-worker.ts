/**
 * KickoffPro — Standalone Background Queue Worker
 *
 * Runs as a persistent background process (managed by systemd, Docker, or PM2)
 * on a VPS (Oracle Cloud VM / OCI) or container cluster.
 *
 * Responsibilities:
 * - Continuously claims pending/stale jobs from the `jobs` table (via processJobs).
 * - Executes registered handlers:
 *     * email.* (order confirmation, payment success/failure, shipping updates)
 *     * push.* (admin push notifications via WebPush / VAPID)
 *     * tracking.* (Meta Conversions API / CAPI purchase dispatches)
 * - Dynamic polling: polls frequently (~10s) when active jobs are present,
 *   backing off to (~25s) when the queue is idle.
 * - Graceful shutdown: traps SIGINT / SIGTERM to finish in-flight jobs cleanly
 *   before exiting.
 */

import { loadEnvConfig } from '@next/env';

// Load .env / .env.production / .env.local if not already provided by systemd EnvironmentFile
loadEnvConfig(process.cwd());

import { processJobs } from '@/lib/jobs/runner';
import { listHandlerKinds } from '@/lib/jobs/handlers';
import { syncActiveAutomatedShipments } from '@/lib/shipping/syncShipmentTracking';

const TRACKING_SYNC_INTERVAL_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.TRACKING_SYNC_INTERVAL_MS) || 45 * 60 * 1000,
); // Default: every 45 minutes

// Polling interval configuration (ms)
const ACTIVE_POLL_INTERVAL_MS = Math.max(
  1000,
  Number(process.env.QUEUE_WORKER_ACTIVE_INTERVAL_MS) || 10_000,
); // ~10-15s when active
const IDLE_POLL_INTERVAL_MS = Math.max(
  ACTIVE_POLL_INTERVAL_MS,
  Number(process.env.QUEUE_WORKER_IDLE_INTERVAL_MS) || 25_000,
); // ~20-30s when idle
const BATCH_SIZE = Math.max(1, Number(process.env.QUEUE_WORKER_BATCH_SIZE) || 10);
const LEASE_SECONDS = Math.max(10, Number(process.env.QUEUE_WORKER_LEASE_SECONDS) || 60);
const MAX_DURATION_MS = Math.max(1000, Number(process.env.QUEUE_WORKER_MAX_DURATION_MS) || 8000);

let isShuttingDown = false;
let isProcessing = false;
let sleepResolver: (() => void) | null = null;
let sleepTimer: NodeJS.Timeout | null = null;

/**
 * Interruptible sleep helper. Allows graceful shutdown signals to wake the
 * loop immediately during idle backoff without hanging for 25+ seconds.
 */
function interruptibleSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    sleepResolver = resolve;
    sleepTimer = setTimeout(() => {
      sleepResolver = null;
      sleepTimer = null;
      resolve();
    }, ms);
  });
}

function wakeSleep() {
  if (sleepTimer) {
    clearTimeout(sleepTimer);
    sleepTimer = null;
  }
  if (sleepResolver) {
    const resolve = sleepResolver;
    sleepResolver = null;
    resolve();
  }
}

/**
 * Signal handler for SIGINT (Ctrl+C) and SIGTERM (systemd stop/restart).
 */
function handleShutdown(signal: string) {
  if (isShuttingDown) {
    console.warn(`[WORKER] Forced exit on second ${signal}.`);
    process.exit(1);
  }

  isShuttingDown = true;
  console.log(`[WORKER] Received ${signal}. Initiating graceful shutdown...`);

  // Wake up any active sleep timer
  wakeSleep();

  // Safety hard-kill timeout in case a job or network socket hangs
  const forceKillTimeout = setTimeout(() => {
    console.error('[WORKER] Shutdown timed out after 30s. Forcing exit.');
    process.exit(1);
  }, 30_000);
  forceKillTimeout.unref();
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

async function main() {
  console.log('─────────────────────────────────────────────────────────────────');
  console.log(' KickoffPro Background Queue Worker');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log(`PID:               ${process.pid}`);
  console.log(`Node Version:      ${process.version}`);
  console.log(`Active Poll:       ${ACTIVE_POLL_INTERVAL_MS}ms (~${Math.round(ACTIVE_POLL_INTERVAL_MS / 1000)}s)`);
  console.log(`Idle Backoff:      ${IDLE_POLL_INTERVAL_MS}ms (~${Math.round(IDLE_POLL_INTERVAL_MS / 1000)}s)`);
  console.log(`Batch Size:        ${BATCH_SIZE}`);
  console.log(`Lease Seconds:     ${LEASE_SECONDS}s`);
  console.log(`Available Handlers: ${listHandlerKinds().join(', ')}`);

  // Check required environment variables
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const hasResend = Boolean(process.env.RESEND_API_KEY);
  const hasSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_HELLO_USER);

  if (!supabaseUrl || !serviceKey) {
    console.error(
      '[WORKER_WARNING] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment!',
    );
  }
  if (!hasResend && !hasSmtp) {
    console.warn(
      '[WORKER_WARNING] Neither RESEND_API_KEY nor SMTP credentials (SMTP_HOST / SMTP_HELLO_USER) detected. Email jobs may skip delivery.',
    );
  }

  console.log('─────────────────────────────────────────────────────────────────');
  console.log('[WORKER] Loop started. Polling for jobs...');

  let consecutiveIdleCycles = 0;
  // Delay first tracking sync by 60s after boot so restarts stay light
  let lastTrackingSyncAt = Date.now() - TRACKING_SYNC_INTERVAL_MS + 60_000;

  while (!isShuttingDown) {
    const currentUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    const currentKey = (
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      ''
    ).trim();

    if (!currentUrl || !currentKey) {
      consecutiveIdleCycles += 1;
      if (consecutiveIdleCycles === 1 || consecutiveIdleCycles % 10 === 0) {
        console.warn(
          `[WORKER] Waiting for valid NEXT_PUBLIC_SUPABASE_URL and server Supabase key in environment... (retrying in ${Math.round(IDLE_POLL_INTERVAL_MS / 1000)}s)`,
        );
      }
      if (!isShuttingDown) {
        await interruptibleSleep(IDLE_POLL_INTERVAL_MS);
      }
      continue;
    }

    isProcessing = true;
    try {
      const result = await processJobs({
        limit: BATCH_SIZE,
        leaseSeconds: LEASE_SECONDS,
        maxDurationMs: MAX_DURATION_MS,
      });

      if (result.processed > 0) {
        consecutiveIdleCycles = 0;
        console.log(
          `[WORKER] [${new Date().toISOString()}] Batch completed: ${result.processed} processed (${result.succeeded} succeeded, ${result.failed} failed) in ${result.duration_ms}ms. Next active check in ${Math.round(ACTIVE_POLL_INTERVAL_MS / 1000)}s.`,
        );

        if (!isShuttingDown) {
          await interruptibleSleep(ACTIVE_POLL_INTERVAL_MS);
        }
      } else {
        consecutiveIdleCycles += 1;

        if (consecutiveIdleCycles === 1) {
          console.log(
            `[WORKER] [${new Date().toISOString()}] Queue drained. Backing off to idle polling (${Math.round(IDLE_POLL_INTERVAL_MS / 1000)}s).`,
          );
        } else if (consecutiveIdleCycles % 24 === 0) {
          // Periodic heartbeat log every ~10 minutes while idle
          console.log(
            `[WORKER] [${new Date().toISOString()}] Heartbeat: idle, worker running normally.`,
          );
        }

        if (!isShuttingDown) {
          await interruptibleSleep(IDLE_POLL_INTERVAL_MS);
        }
      }

      // Periodic automated shipment tracking fallback (every 45m by default)
      if (!isShuttingDown && Date.now() - lastTrackingSyncAt >= TRACKING_SYNC_INTERVAL_MS) {
        lastTrackingSyncAt = Date.now();
        try {
          const syncStats = await syncActiveAutomatedShipments(25);
          if (syncStats.checked > 0) {
            console.log(
              `[WORKER] [${new Date().toISOString()}] Tracking sync: checked=${syncStats.checked}, updated=${syncStats.updated}, errors=${syncStats.errors}`,
            );
          }
        } catch (syncErr) {
          console.error('[WORKER_TRACKING_SYNC_ERROR]', syncErr);
        }
      }
    } catch (err) {
      console.error(`[WORKER_CYCLE_ERROR] [${new Date().toISOString()}]`, err);
      if (!isShuttingDown) {
        // Back off on unexpected cycle error to avoid tight error loops
        await interruptibleSleep(ACTIVE_POLL_INTERVAL_MS);
      }
    } finally {
      isProcessing = false;
    }
  }

  console.log('[WORKER] Queue worker stopped cleanly.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[WORKER_FATAL_ERROR]', err);
  process.exit(1);
});
