'use client';

import React from 'react';
import { QueryResultError } from '@/lib/supabase/query-helper';

interface DatabaseErrorPanelProps {
  error: QueryResultError;
  title?: string;
}

export default function DatabaseErrorPanel({ error, title = 'Database Connection Issue' }: DatabaseErrorPanelProps) {
  const isDev = process.env.NODE_ENV === 'development';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-10) var(--space-5)',
        margin: 'var(--space-6) auto',
        maxWidth: 'var(--max-width-desktop)',
        width: '100%',
        animation: 'fadeIn var(--duration-normal) var(--ease-out)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '600px',
          background: 'var(--bg-secondary)',
          border: `1px solid ${isDev ? 'rgba(239, 68, 68, 0.2)' : 'var(--border-color)'}`,
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-md)',
          padding: 'var(--space-6) var(--space-8)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
        }}
      >
        {/* Header Icon + Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '40px',
              height: '40px',
              borderRadius: 'var(--radius-full)',
              background: isDev ? 'rgba(239, 68, 68, 0.1)' : 'var(--hover-wash-strong)',
              color: isDev ? 'var(--error)' : 'var(--text-secondary)',
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M3 5V19A9 3 0 0 0 21 19V5" />
              <path d="M3 12A9 3 0 0 0 21 12" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div>
            <h2
              style={{
                fontSize: '1.125rem',
                fontWeight: 600,
                color: isDev ? 'var(--error)' : 'var(--text-primary)',
                margin: 0,
              }}
            >
              {isDev ? `${title} (Development)` : 'Storefront Temporarily Unavailable'}
            </h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
              Reference ID: <code style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{error.correlationId}</code>
            </p>
          </div>
        </div>

        {/* Message */}
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', lineHeight: '1.5' }}>
          {isDev ? (
            <span>
              A Supabase query failed during rendering. This diagnostics screen is displayed because your server is running in development mode.
            </span>
          ) : (
            <span>
              We&apos;re experiencing a temporary issue. Please try again shortly.
            </span>
          )}
        </div>

        {/* Development Diagnostic Information */}
        {isDev && (
          <div
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-4)',
              fontSize: '0.8125rem',
              fontFamily: 'monospace',
              color: 'var(--text-primary)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
              overflowX: 'auto',
            }}
          >
            <div>
              <strong style={{ color: 'var(--text-muted)' }}>CODE:</strong> {error.code || 'N/A'}
            </div>
            <div>
              <strong style={{ color: 'var(--text-muted)' }}>MESSAGE:</strong> {error.message}
            </div>
            {error.details && (
              <div>
                <strong style={{ color: 'var(--text-muted)' }}>DETAILS:</strong> {error.details}
              </div>
            )}
            {error.hint && (
              <div>
                <strong style={{ color: 'var(--text-muted)' }}>HINT:</strong> {error.hint}
              </div>
            )}
          </div>
        )}

        {/* Action Button/Footer */}
        <div
          style={{
            marginTop: 'var(--space-2)',
            display: 'flex',
            justifyContent: 'flex-end',
            borderTop: '1px solid var(--border-color)',
            paddingTop: 'var(--space-4)',
          }}
        >
          <button
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.reload();
              }
            }}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              background: 'var(--text-primary)',
              color: 'var(--bg-primary)',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 600,
              fontSize: '0.8125rem',
              cursor: 'pointer',
              border: 'none',
              transition: 'background var(--duration-fast) var(--ease-out)',
            }}
            onMouseOver={(e) => (e.currentTarget.style.opacity = '0.9')}
            onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
          >
            Retry Connection
          </button>
        </div>
      </div>
    </div>
  );
}
