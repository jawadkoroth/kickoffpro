import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Auth callback handler — supports two Supabase auth flows:
 *
 *   1. OAuth (Google): `?code=...`  — PKCE exchange server-side.
 *   2. Magic link email: `?token_hash=...&type=email` — verifyOtp server-side.
 *
 * Both paths write session cookies via @supabase/ssr, then redirect:
 *   - no phone on profile → /profile/complete?next=...
 *   - profile complete    → ?next= (default /profile)
 *
 * This eliminates the "duplicate tab" confusion: the magic link lands here,
 * exchanges the token for a session in the SAME request, then sends the user
 * directly to their destination — no OTP input screen involved.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);

  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as 'email' | 'recovery' | null;
  const errorParam = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  const rawNext = url.searchParams.get('next') || '/profile';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/profile';

  if (errorParam) {
    const target = new URL('/auth', request.url);
    target.searchParams.set('error', errorDescription || errorParam);
    return NextResponse.redirect(target);
  }

  const cookieStore = await cookies();
  console.log('[AUTH_CALLBACK] Request cookies:', cookieStore.getAll().map(c => `${c.name}: ${c.value.substring(0, 12)}...`));

  const supabase = await createServerSupabaseClient();

  if (tokenHash && type) {
    // ── Magic link / email OTP flow ──
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (verifyError) {
      const target = new URL('/auth', request.url);
      target.searchParams.set('error', verifyError.message);
      return NextResponse.redirect(target);
    }
  } else if (code) {
    // ── OAuth PKCE flow (Google, etc.) ──
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      const target = new URL('/auth', request.url);
      target.searchParams.set('error', exchangeError.message);
      return NextResponse.redirect(target);
    }
  } else {
    const target = new URL('/auth', request.url);
    target.searchParams.set('error', 'Missing authorization parameters');
    return NextResponse.redirect(target);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const target = new URL('/auth', request.url);
    target.searchParams.set('error', 'Session could not be established');
    return NextResponse.redirect(target);
  }

  // Profile row is auto-created by trigger (migration 003).
  // Only check phone to decide whether onboarding is required.
  const { data: profile } = await supabase
    .from('profiles')
    .select('phone')
    .eq('id', user.id)
    .maybeSingle();

  const destination = profile?.phone
    ? next
    : `/profile/complete?next=${encodeURIComponent(next)}`;

  return NextResponse.redirect(new URL(destination, request.url));
}
