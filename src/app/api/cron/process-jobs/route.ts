import { NextRequest, NextResponse } from 'next/server';
import { processJobs } from '@/lib/jobs/runner';

/**
 * GET/POST /api/cron/process-jobs
 *
 * Fallback retry worker and scheduled queue processor.
 * Triggered by Vercel Cron or external schedulers (e.g. cron-job.org, VPS cron, Kubernetes CronJob).
 *
 * Authentication:
 * - Vercel Cron automatically sends `Authorization: Bearer <CRON_SECRET>`.
 * - Query parameter `?secret=<CRON_SECRET>` is also supported.
 * - Header `x-cron-secret: <CRON_SECRET>` is also supported.
 * - In development mode, requests are allowed without secret for testing.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorised(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') {
    return true;
  }

  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // If CRON_SECRET is not configured in production, reject for security
    return false;
  }

  const auth = req.headers.get('authorization') || '';
  if (auth === `Bearer ${expected}`) return true;

  const headerSecret = req.headers.get('x-cron-secret');
  if (headerSecret === expected) return true;

  const querySecret = req.nextUrl.searchParams.get('secret');
  if (querySecret === expected) return true;

  return false;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorised(req)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Unauthorized. Please supply valid CRON_SECRET via Bearer token or ?secret=',
      },
      { status: 401 },
    );
  }

  try {
    const result = await processJobs({
      limit: 10,
      leaseSeconds: 30,
      maxDurationMs: 8000,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        success: false,
        error: msg,
      },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}
