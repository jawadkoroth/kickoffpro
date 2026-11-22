'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';
  const token = searchParams.get('token') || '';

  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConfigured = Boolean(email && token);

  const handleUnsubscribe = async () => {
    if (!email || !token) {
      setError('Missing email or unsubscribe verification token.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setDone(true);
      } else {
        setError(data.error || 'Failed to process unsubscribe request.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0B0B0C',
        color: '#F5F5F5',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: '460px',
          width: '100%',
          background: '#141416',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          padding: '36px 28px',
          textAlign: 'center',
          boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ marginBottom: '20px' }}>
          <span
            style={{
              fontFamily: 'inherit',
              fontSize: '1.25rem',
              fontWeight: 800,
              letterSpacing: '0.05em',
              color: '#FFFFFF',
            }}
          >
            KICKOFF<span style={{ color: '#FFC928' }}>PRO</span>
          </span>
        </div>

        {done ? (
          <div>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: 'rgba(34, 197, 94, 0.15)',
                color: '#22c55e',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '22px',
                marginBottom: '16px',
              }}
            >
              ✓
            </div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 10px' }}>
              Unsubscribed Successfully
            </h1>
            <p style={{ color: '#9CA3AF', fontSize: '0.875rem', lineHeight: 1.6, margin: '0 0 24px' }}>
              <strong style={{ color: '#E5E7EB' }}>{email}</strong> has been removed from all marketing, drops, and promotional broadcasts.
            </p>
            <p style={{ color: '#6B7280', fontSize: '0.75rem', margin: '0 0 28px', lineHeight: 1.5 }}>
              *Note: You will still receive essential transactional emails (order confirmations, tracking updates, and refunds) whenever you place an order.
            </p>
            <Link
              href="/"
              style={{
                display: 'inline-block',
                background: '#FFC928',
                color: '#0B0B0C',
                textDecoration: 'none',
                padding: '10px 24px',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '0.875rem',
              }}
            >
              Return to Store
            </Link>
          </div>
        ) : (
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 12px' }}>
              Unsubscribe Preferences
            </h1>
            <p style={{ color: '#9CA3AF', fontSize: '0.875rem', lineHeight: 1.6, margin: '0 0 20px' }}>
              Are you sure you want to stop receiving promotional emails, drop announcements, and special offers from KickoffPro?
            </p>

            {email && (
              <div
                style={{
                  background: '#0B0B0C',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  fontSize: '0.875rem',
                  color: '#FFC928',
                  wordBreak: 'break-all',
                  marginBottom: '20px',
                }}
              >
                {email}
              </div>
            )}

            {error && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  color: '#EF4444',
                  fontSize: '0.8125rem',
                  padding: '10px',
                  borderRadius: '8px',
                  marginBottom: '20px',
                }}
              >
                {error}
              </div>
            )}

            {!isConfigured ? (
              <p style={{ color: '#EF4444', fontSize: '0.8125rem' }}>
                Invalid unsubscribe link. Please use the link at the bottom of your email.
              </p>
            ) : (
              <button
                onClick={handleUnsubscribe}
                disabled={loading}
                style={{
                  width: '100%',
                  background: '#EF4444',
                  color: '#FFFFFF',
                  border: 'none',
                  padding: '12px 20px',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                  transition: 'opacity 0.2s',
                }}
              >
                {loading ? 'Unsubscribing...' : 'Confirm Unsubscribe'}
              </button>
            )}

            <div style={{ marginTop: '20px' }}>
              <Link
                href="/"
                style={{
                  color: '#9CA3AF',
                  fontSize: '0.8125rem',
                  textDecoration: 'none',
                }}
              >
                Cancel and return to store
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: '100vh', background: '#0B0B0C', color: '#F5F5F5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          Loading...
        </div>
      }
    >
      <UnsubscribeContent />
    </Suspense>
  );
}
