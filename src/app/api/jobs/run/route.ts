import { NextRequest, NextResponse } from 'next/server';
import { processJobs } from '@/lib/jobs/runner';

/**
 * GET/POST /api/jobs/run
 *
 * Legacy drain endpoint retained for backward compatibility with existing cron hooks.
 * Delegates to the unified `processJobs` worker.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorised(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') {
    return true;
  }

  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const auth = req.headers.get('authorization') || '';
  if (auth === `Bearer ${expected}`) return true;

  const headerSecret = req.headers.get('x-cron-secret');
  if (headerSecret === expected) return true;

  const fromQuery = req.nextUrl.searchParams.get('secret');
  if (fromQuery && fromQuery === expected) return true;

  return false;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorised(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}
