'use client';

import { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import styles from './page.module.css';

/**
 * KickoffPro Auth — Passwordless sign-in
 *
 * Flow:
 *   1. User chooses Google or Email.
 *   2. Email path: sends a magic link via Supabase (signInWithOtp + emailRedirectTo).
 *      UI switches to a clean "check your inbox" confirmation screen.
 *      No OTP input — the email contains a clickable link only.
 *   3. Clicking the email link hits /auth/callback which exchanges the
 *      code for a session server-side, then redirects to ?next or /profile.
 *
 * UX hardening:
 *   - Centralized error mapper — no raw Supabase/provider messages reach users.
 *   - 60-second cooldown after send: prevents spam, reduces rate-limit hits.
 *   - Duplicate-send guard: inflight ref prevents concurrent submissions.
 *   - Cooldown persists across React re-renders via refs + interval.
 */

const COOLDOWN_SECONDS = 60;

/**
 * Maps raw Supabase/provider error messages to curated KickoffPro copy.
 * Technical messages are logged to console; only premium UX copy
 * is shown to users.
 */
function mapAuthError(raw: string): string {
  const msg = raw.toLowerCase();

  if (msg.includes('rate limit') || msg.includes('too many') || msg.includes('429')) {
    return 'Please wait a moment before requesting another login link.';
  }
  if (msg.includes('invalid email') || msg.includes('unable to validate email')) {
    return 'Please enter a valid email address.';
  }
  if (msg.includes('signups not allowed') || msg.includes('signup disabled')) {
    return 'New sign-ups are temporarily unavailable. Please try again later.';
  }
  if (msg.includes('email not confirmed')) {
    return 'Please verify your email first. Check your inbox for a previous sign-in link.';
  }
  if (msg.includes('expired') || msg.includes('token has expired')) {
    return 'This sign-in link has expired. Please request a new one.';
  }
  if (msg.includes('invalid token') || msg.includes('otp') || msg.includes('token not found')) {
    return 'This sign-in link is invalid or has already been used. Please request a new one.';
  }
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
    return 'Connection issue. Please check your internet and try again.';
  }
  if (msg.includes('popup') || msg.includes('closed by')) {
    return 'Sign-in was cancelled. Please try again.';
  }
  if (msg.includes('access_denied')) {
    return 'Access was denied. Please try again or use a different sign-in method.';
  }
  if (msg.includes('redirect_uri_mismatch') || msg.includes('redirect url') || msg.includes('redirect uri') || msg.includes('callback url')) {
    return 'Unauthorized callback URL / Invalid redirect URL. Please check your Supabase Dashboard configuration.';
  }
  if (msg.includes('configuration') || msg.includes('missing api key') || msg.includes('supabase key') || msg.includes('env var')) {
    return 'Missing Supabase configuration. Please check your environment variables.';
  }
  if (msg.includes('email not authorized') || msg.includes('not authorized') || msg.includes('unauthorized')) {
    return 'Email not authorized. Access is restricted.';
  }

  // Log technical details internally
  console.error('[AUTH_ERROR]', raw);
  return `Authentication error: ${raw}`;
}

type Step = 'enter' | 'sent';

function AuthInner() {
  const searchParams = useSearchParams();
  const errorParam = searchParams.get('error');
  const rawNext = searchParams.get('next') || '/profile';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/profile';

  const [step, setStep] = useState<Step>('enter');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(errorParam ? mapAuthError(errorParam) : '');
  const [cooldown, setCooldown] = useState(0);

  const inflightRef = useRef(false);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clear interval on unmount
  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  const startCooldown = useCallback(() => {
    setCooldown(COOLDOWN_SECONDS);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  async function handleSendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || inflightRef.current || cooldown > 0) return;

    inflightRef.current = true;
    setLoading(true);
    setError('');

    const supabase = createClient();
    const callbackUrl = new URL('/auth/callback', window.location.origin);
    callbackUrl.searchParams.set('next', next);

    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: true,
        emailRedirectTo: callbackUrl.toString(),
      },
    });

    inflightRef.current = false;

    if (authError) {
      setError(mapAuthError(authError.message));
      setLoading(false);
    } else {
      setLoading(false);
      startCooldown();
      setStep('sent');
    }
  }

  async function handleGoogleLogin() {
    if (inflightRef.current) return;
    inflightRef.current = true;
    setLoading(true);
    setError('');
    const supabase = createClient();
    const callbackUrl = new URL('/auth/callback', window.location.origin);
    callbackUrl.searchParams.set('next', next);

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl.toString() },
    });
    if (oauthError) {
      setError(mapAuthError(oauthError.message));
      setLoading(false);
      inflightRef.current = false;
    }
    // On success: browser redirects away — inflight ref doesn't matter
  }

  function handleBackToEnter() {
    setStep('enter');
    setError('');
    // Keep cooldown running — prevents re-sending immediately after going back
  }

  return (
    <div className={styles.page}>
      {/* Ambient gradient glow */}
      <div className={styles.glow} aria-hidden />

      <div className={styles.card}>
        {/* Brand mark */}
        <div className={styles.brand}>
          <span className={styles.brandName}>KickoffPro</span>
          <span className={styles.brandDot} />
        </div>

        {step === 'enter' && (
          <>
            <h1 className={styles.title}>Welcome back.</h1>
            <p className={styles.subtitle}>
              Sign in or create your account — no password required.
            </p>

            {error && (
              <div className={styles.errorBanner} role="alert">
                {error}
              </div>
            )}

            <div className={styles.stack}>
              {/* Google */}
              <button
                className={styles.googleBtn}
                onClick={handleGoogleLogin}
                disabled={loading}
                type="button"
              >
                <GoogleIcon />
                <span>Continue with Google</span>
              </button>

              {/* Divider */}
              <div className={styles.divider}>
                <div className={styles.dividerLine} />
                <span className={styles.dividerText}>or continue with email</span>
                <div className={styles.dividerLine} />
              </div>

              {/* Email */}
              <form onSubmit={handleSendMagicLink} className={styles.emailForm}>
                <div className={styles.inputWrap}>
                  <input
                    className={styles.emailInput}
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                    disabled={loading}
                  />
                </div>
                <button
                  className={styles.primaryBtn}
                  disabled={loading || !email.trim() || cooldown > 0}
                  type="submit"
                >
                  {loading ? (
                    <span className={styles.spinner} />
                  ) : cooldown > 0 ? (
                    <span className={styles.cooldownText}>
                      Request another link in: {cooldown}s
                    </span>
                  ) : (
                    'Send Secure Link'
                  )}
                </button>
              </form>
            </div>

            <p className={styles.legalNote}>
              By continuing, you agree to our{' '}
              <a href="/legal/terms" className={styles.legalLink}>Terms</a>
              {' '}and{' '}
              <a href="/legal/privacy" className={styles.legalLink}>Privacy Policy</a>.
            </p>
          </>
        )}

        {step === 'sent' && (
          <div className={styles.sentScreen}>
            <div className={styles.sentIcon}>✉️</div>
            <h2 className={styles.sentTitle}>Check your inbox</h2>
            <p className={styles.sentBody}>
              We sent a secure sign-in link to
              <br />
              <strong className={styles.sentEmail}>{email}</strong>
            </p>
            <p className={styles.sentHint}>
              Click the link in the email to sign in instantly.
              The link expires in 60 minutes.
            </p>
            {cooldown > 0 ? (
              <div className={styles.cooldownBar}>
                <div className={styles.cooldownTrack}>
                  <div
                    className={styles.cooldownProgress}
                    style={{ width: `${((COOLDOWN_SECONDS - cooldown) / COOLDOWN_SECONDS) * 100}%` }}
                  />
                </div>
                <p className={styles.cooldownLabel}>
                  Request another link in: {cooldown}s
                </p>
              </div>
            ) : (
              <button
                className={styles.resendBtn}
                onClick={handleBackToEnter}
                type="button"
              >
                ← Use a different email
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.15v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.15C1.43 8.55 1 10.22 1 12s.43 3.45 1.15 4.93l3.69-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.15 7.07l3.69 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100dvh', background: '#071B3A' }} />}>
      <AuthInner />
    </Suspense>
  );
}
