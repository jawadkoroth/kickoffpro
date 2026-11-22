import { NextRequest, NextResponse } from 'next/server';
import { verifyUnsubscribeToken, suppressEmail } from '@/lib/email/unsubscribe';
import { enforceRateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Public Unsubscribe Endpoint
 *
 * Supports:
 * 1. RFC 8058 One-Click Unsubscribe (POST with List-Unsubscribe=One-Click)
 * 2. Standard Web Form Unsubscribe (POST with { email, token })
 * 3. Fallback GET request (query params ?email=...&token=...)
 */
export async function POST(req: NextRequest) {
  const limited = await enforceRateLimit(req, {
    bucket: 'unsubscribe.post',
    max: 30,
    windowSeconds: 60,
  });
  if (limited) return limited;

  let email = '';
  let token = '';

  // Check query string first (common for List-Unsubscribe mail headers)
  const searchParams = req.nextUrl.searchParams;
  if (searchParams.get('email') && searchParams.get('token')) {
    email = searchParams.get('email') || '';
    token = searchParams.get('token') || '';
  }

  // If not in query, try parsing JSON body or form data
  if (!email || !token) {
    try {
      const contentType = req.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const body = await req.json();
        email = String(body.email || '');
        token = String(body.token || '');
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const form = await req.formData();
        email = String(form.get('email') || '');
        token = String(form.get('token') || '');
      }
    } catch {
      // ignore parse errors and rely on query fallback
    }
  }

  if (!email || !token) {
    return NextResponse.json(
      { success: false, error: 'Email and valid token are required.' },
      { status: 400 },
    );
  }

  const isValid = verifyUnsubscribeToken(email, token);
  if (!isValid) {
    return NextResponse.json(
      { success: false, error: 'Invalid or expired unsubscribe link.' },
      { status: 403 },
    );
  }

  const result = await suppressEmail(email, 'one_click_or_api', 'api_route');
  if (!result.success) {
    return NextResponse.json(
      { success: false, error: 'Could not process unsubscribe. Please try again later.' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    message: 'You have been successfully unsubscribed from marketing and promotional emails.',
    email: email.trim().toLowerCase(),
  });
}

export async function GET(req: NextRequest) {
  const limited = await enforceRateLimit(req, {
    bucket: 'unsubscribe.get',
    max: 30,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const searchParams = req.nextUrl.searchParams;
  const email = searchParams.get('email') || '';
  const token = searchParams.get('token') || '';

  if (!email || !token) {
    return NextResponse.json(
      { success: false, error: 'Email and token required' },
      { status: 400 },
    );
  }

  const isValid = verifyUnsubscribeToken(email, token);
  if (!isValid) {
    return NextResponse.json(
      { success: false, error: 'Invalid or expired unsubscribe link' },
      { status: 403 },
    );
  }

  const result = await suppressEmail(email, 'direct_get_link', 'api_route');
  if (!result.success) {
    return NextResponse.json(
      { success: false, error: 'Failed to process unsubscribe' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    message: 'Successfully unsubscribed from marketing emails.',
    email: email.trim().toLowerCase(),
  });
}
