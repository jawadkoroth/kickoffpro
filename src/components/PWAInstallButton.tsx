'use client';

import { usePWA } from './PWAProvider';

export function PWAInstallButton() {
  const { canInstall, isInstalled, isStandalone, install } = usePWA();

  // Don't show if already installed or not installable
  if (isInstalled || isStandalone || !canInstall) return null;

  return (
    <button
      onClick={install}
      title="Install KickoffPro Admin app"
      style={{
        background: 'none',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-sm)',
        padding: '6px 10px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: '0.6875rem',
        fontWeight: 600,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        transition: 'all 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--text-secondary)';
        e.currentTarget.style.color = 'var(--text-primary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-color)';
        e.currentTarget.style.color = 'var(--text-muted)';
      }}
    >
      <span style={{ fontSize: '1rem' }}>📲</span>
      <span>Install</span>
    </button>
  );
}
