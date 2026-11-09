'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function CheckoutErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[CHECKOUT_RUNTIME_ERROR]', error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: '70dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-6, 24px)',
        textAlign: 'center',
        maxWidth: '520px',
        margin: '0 auto',
      }}
    >
      <div
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: 'rgba(239, 68, 68, 0.12)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.75rem',
          marginBottom: 'var(--space-4, 16px)',
        }}
      >
        ⚠️
      </div>
      <h2
        style={{
          fontSize: '1.35rem',
          fontWeight: 800,
          color: 'var(--text-primary, #071b3a)',
          marginBottom: '8px',
        }}
      >
        Checkout Encountered an Issue
      </h2>
      <p
        style={{
          fontSize: '0.9rem',
          color: 'var(--text-secondary, #475569)',
          marginBottom: 'var(--space-6, 24px)',
          lineHeight: 1.5,
        }}
      >
        We were unable to complete this step. Your items remain safe in your cart. You can try reloading or return to your cart.
      </p>

      {error?.message && (
        <div
          style={{
            background: 'var(--bg-secondary, #f8fafc)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: '8px',
            padding: '10px 14px',
            fontSize: '0.75rem',
            color: 'var(--text-muted, #64748b)',
            fontFamily: 'monospace',
            marginBottom: 'var(--space-6, 24px)',
            maxWidth: '100%',
            overflowX: 'auto',
            textAlign: 'left',
          }}
        >
          {error.message}
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={() => reset()}
          className="btn btn-primary btn-sm"
          style={{ width: 'auto', padding: '10px 20px' }}
        >
          🔄 Try Again
        </button>
        <Link
          href="/cart"
          className="btn btn-secondary btn-sm"
          style={{ width: 'auto', padding: '10px 20px' }}
        >
          🛒 View Cart
        </Link>
        <Link
          href="/"
          className="btn btn-ghost btn-sm"
          style={{ width: 'auto', padding: '10px 16px' }}
        >
          Home
        </Link>
      </div>
    </div>
  );
}

