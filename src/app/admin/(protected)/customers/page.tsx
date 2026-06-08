'use client';

import { useEffect, useState } from 'react';

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  ordersCount: number;
  totalSpend: number;
  lastOrderDate: string | null;
  createdAt: string;
}

export default function AdminCustomers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCustomers() {
      try {
        const res = await fetch('/api/admin/customers');
        const data = await res.json();
        if (data.success) {
          setCustomers(data.data || []);
        } else {
          setError(data.error || 'Failed to load customers');
        }
      } catch (err) {
        console.error('[LOAD_CUSTOMERS]', err);
        setError('Failed to load customers');
      } finally {
        setLoading(false);
      }
    }
    loadCustomers();
  }, []);

  const formatPrice = (paise: number) =>
    '₹' + (paise / 100).toLocaleString('en-IN');

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="animate-pulse text-muted" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
        Loading...
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: 'var(--space-4)' }}>Customers</h1>
      
      {error && (
        <div className="warning-banner" style={{ marginBottom: 'var(--space-4)', color: 'var(--error)' }}>
          ⚠ {error}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '600px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }}>
              <th style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Customer</th>
              <th style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Contact</th>
              <th style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', textAlign: 'center' }}>Orders</th>
              <th style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', textAlign: 'right' }}>Total Spend</th>
              <th style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Last Order</th>
              <th style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Joined</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background-color 0.2s' }} className="admin-table-row">
                <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.id}</div>
                </td>
                <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                  <div className="text-sm">{c.email}</div>
                  {c.phone && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{c.phone}</div>}
                </td>
                <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'center', fontWeight: 600 }}>
                  {c.ordersCount}
                </td>
                <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', fontWeight: 600, color: c.totalSpend > 0 ? 'var(--success)' : 'inherit' }}>
                  {formatPrice(c.totalSpend)}
                </td>
                <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.8125rem' }}>
                  {formatDate(c.lastOrderDate)}
                </td>
                <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  {formatDate(c.createdAt)}
                </td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No registered customers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
