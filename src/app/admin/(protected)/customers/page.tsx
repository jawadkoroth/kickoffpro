'use client';

export default function AdminCustomers() {
  return (
    <div>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: 'var(--space-4)' }}>Customers</h1>
      <div className="card" style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)' }}>
        <p style={{ fontSize: '1.5rem', marginBottom: 'var(--space-2)' }}>👥</p>
        <p style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>Customer Management Coming Soon</p>
        <p className="text-xs">Database profiles will display here to trace buyer segments, lifecycles, and direct communications.</p>
      </div>
    </div>
  );
}
