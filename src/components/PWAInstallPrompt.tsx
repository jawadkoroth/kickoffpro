'use client';

import { useState, useEffect } from 'react';
import { usePWA } from './PWAProvider';

export function PWAInstallPrompt() {
  const { canInstall, isInstalled, isStandalone, isIOS, install, dismissInstall } = usePWA();
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Check localStorage for previous dismissal
  useEffect(() => {
    const dismissed = localStorage.getItem('kickoffpro-install-dismissed');
    if (dismissed) {
      const date = new Date(dismissed);
      const now = new Date();
      // Reshow after 7 days
      if (now.getTime() - date.getTime() < 7 * 24 * 60 * 60 * 1000) {
        setIsDismissed(true);
      }
    }
  }, []);

  // Show prompt after short delay if conditions met
  useEffect(() => {
    if (!canInstall || isInstalled || isStandalone || isDismissed) return;

    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 2000);

    return () => clearTimeout(timer);
  }, [canInstall, isInstalled, isStandalone, isDismissed]);

  const handleDismiss = () => {
    setIsVisible(false);
    setIsDismissed(true);
    localStorage.setItem('kickoffpro-install-dismissed', new Date().toISOString());
    dismissInstall();
  };

  const handleInstall = async () => {
    await install();
    setIsVisible(false);
  };

  if (!isVisible) return null;

  // iOS Safari instructions
  if (isIOS) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 'calc(90px + env(safe-area-inset-bottom))',
          left: 16,
          right: 16,
          zIndex: 9998,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          padding: '16px 20px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ fontSize: '1.5rem' }}>📲</span>
          <div style={{ flex: 1 }}>
            <p
              style={{
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
                margin: '0 0 8px',
              }}
            >
              Install KickoffPro Admin
            </p>
            <p
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              Tap <strong>Share</strong> then <strong>Add to Home Screen</strong> for the app experience
            </p>
          </div>
          <button
            onClick={handleDismiss}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '1.25rem',
              cursor: 'pointer',
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  // Android/Desktop install prompt
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'calc(90px + env(safe-area-inset-bottom))',
        left: 16,
        right: 16,
        zIndex: 9998,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px 20px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: 'var(--bg-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid var(--border-color)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>K</span>
        </div>
        <div style={{ flex: 1 }}>
          <p
            style={{
              fontSize: '0.875rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: '0 0 4px',
            }}
          >
            KICKOFFPRO ADMIN
          </p>
          <p
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              margin: 0,
            }}
          >
            Install for operational alerts & faster access
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            onClick={handleDismiss}
            style={{
              fontSize: '0.6875rem',
              fontWeight: 600,
              letterSpacing: '0.05em',
              padding: '8px 14px',
              background: 'transparent',
              color: 'var(--text-muted)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            Later
          </button>
          <button
            onClick={handleInstall}
            style={{
              fontSize: '0.6875rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '8px 16px',
              background: 'var(--text-primary)',
              color: 'var(--bg-primary)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            Install
          </button>
        </div>
      </div>
    </div>
  );
}
