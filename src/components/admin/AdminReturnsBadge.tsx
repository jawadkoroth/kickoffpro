'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

/**
 * Admin Returns Badge - Foundation
 * 
 * Shows count of pending return/exchange requests.
 * Click navigates to orders page (full returns UI pending).
 */

export default function AdminReturnsBadge() {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  async function fetchPendingCount() {
    try {
      const supabase = createClient();
      const { count: pendingCount, error } = await supabase
        .from('return_requests')
        .select('*', { count: 'exact', head: true })
        .in('status', ['requested', 'under_review', 'approved', 'pickup_scheduled']);

      if (error) throw error;
      setCount(pendingCount || 0);
    } catch (err) {
      console.error('Failed to fetch returns count:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPendingCount();
    
    // Refresh every 60 seconds
    const interval = setInterval(fetchPendingCount, 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading || count === 0) return null;

  return (
    <button
      onClick={() => router.push('/admin/orders')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        background: 'rgba(212, 175, 55, 0.15)',
        border: '1px solid rgba(212, 175, 55, 0.35)',
        borderRadius: '999px',
        fontSize: '0.6875rem',
        fontWeight: 600,
        letterSpacing: '0.08em',
        color: 'var(--gold, #D4AF37)',
        cursor: 'pointer',
        transition: 'all 150ms ease',
      }}
      title="Pending return/exchange requests"
    >
      <span>↩️</span>
      <span>{count} PENDING RETURN{count !== 1 ? 'S' : ''}</span>
    </button>
  );
}
