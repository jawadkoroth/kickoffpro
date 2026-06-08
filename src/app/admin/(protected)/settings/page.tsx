'use client';

export default function AdminSettings() {
  return (
    <div>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: 'var(--space-4)' }}>Settings</h1>
      <div className="card" style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)' }}>
        <p style={{ fontSize: '1.5rem', marginBottom: 'var(--space-2)' }}>⚙️</p>
        <p style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>Admin Settings Coming Soon</p>
        <p className="text-xs">Configure site variables, webhook logs, API credentials, and administrative credentials.</p>
      </div>
    </div>
  );
}
