import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Next.js 16 renamed the `middleware` file convention to `proxy`.
 * The function exported from this file MUST be named `proxy` (or
 * default) — `middleware` is no longer recognised and emits a
 * deprecation warning at build time.
 *
 * Single source of truth for session refresh + protected-route gating.
 *
 * Pattern from @supabase/ssr docs: build a NextResponse, wire a server
 * Supabase client to the request/response cookie jars, then call
 * `getUser()` to refresh the access token. Refreshed cookies are written
 * onto the outgoing response, so subsequent server components and route
 * handlers see an up-to-date session.
 *
 * IMPORTANT: do not run any logic between `createServerClient` and
 * `getUser()` — the @supabase/ssr README warns this can desync auth.
 */
/**
 * Generate a short, URL-safe request id. crypto.randomUUID is
 * available in Edge + Node runtimes; we strip dashes for compactness.
 */
function newRequestId(): string {
  try {
    return globalThis.crypto.randomUUID().replace(/-/g, '');
  } catch {
    // Deterministic fallback — never used in practice, but keeps the
    // middleware safe on runtimes that lack `crypto.randomUUID`.
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

export default async function proxy(request: NextRequest) {
  // Correlation ID: accept an inbound `x-request-id` (e.g. from a
  // reverse proxy / load test harness) when present; otherwise mint
  // a fresh one. Pass it through to the downstream handler via a
  // mutated request header AND echo it on the response so clients
  // can reference the id in bug reports.
  const inboundId = request.headers.get('x-request-id');
  const requestId =
    inboundId && inboundId.length > 0 && inboundId.length <= 64
      ? inboundId
      : newRequestId();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', requestId);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('x-request-id', requestId);

  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/auth/callback')) {
    return response;
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.error('[PROXY] Missing Supabase environment variables on proxy initialization.');
    return new NextResponse(
      'Configuration Error: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.',
      { status: 500 }
    );
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          const cookieHeaderValue = request.cookies.getAll()
            .map(({ name, value }) => `${name}=${value}`)
            .join('; ');
          requestHeaders.set('cookie', cookieHeaderValue);
          response = NextResponse.next({ request: { headers: requestHeaders } });
          response.headers.set('x-request-id', requestId);
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Routes that require an authenticated user.
  const requiresUser =
    pathname.startsWith('/profile') ||
    pathname.startsWith('/checkout') ||
    pathname.startsWith('/order/');

  // Admin protected sub-tree (the /admin login page itself is public).
  const requiresAdmin = pathname.startsWith('/admin/');

  if ((requiresUser || requiresAdmin) && !user) {
    if (requiresAdmin) {
      return NextResponse.redirect(new URL('/admin', request.url));
    } else {
      const redirectUrl = new URL('/auth', request.url);
      redirectUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Already authenticated users should not see the login page.
  if (pathname === '/auth' && user) {
    const next = request.nextUrl.searchParams.get('next') || '/profile';
    const destination = next.startsWith('/') ? next : '/profile';
    return NextResponse.redirect(new URL(destination, request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on every path except:
     * - Next internals (_next/*)
     * - Metadata files (favicon.ico, manifest.json, robots.txt, sitemap.xml)
     * - Public asset directories (images/, fonts/)
     * - Other static file extensions
     * The OAuth callback route (/auth/callback) MUST be matched so the
     * exchange's Set-Cookie headers survive any session refresh logic.
     */
    '/((?!_next|favicon\\.ico|manifest\\.json|robots\\.txt|sitemap\\.xml|images/|fonts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
