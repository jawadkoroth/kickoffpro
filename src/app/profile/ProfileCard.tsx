'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import styles from './account.module.css';

interface ProfileCardProps {
  name: string;
  email: string;
  ordersCount?: number;
}

export default function ProfileCard({
  name,
  email,
  ordersCount = 0,
}: ProfileCardProps) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/');
    router.refresh();
  }

  const initial = (name || email || 'U').charAt(0).toUpperCase();

  // Dynamic Loyalty Badge Calculation
  let loyaltyBadge = 'Rookie Fan';
  let badgeColor = '#071B3A';
  let badgeBg = '#E2E8F0';
  
  if (ordersCount >= 5) {
    loyaltyBadge = '⭐ Elite Fan';
    badgeColor = '#071B3A';
    badgeBg = '#FFC928'; // Yellow
  } else if (ordersCount >= 2) {
    loyaltyBadge = '⚽ Varsity Supporter';
    badgeColor = '#FFFFFF';
    badgeBg = '#2FA9F5'; // Sky Blue
  }

  return (
    <aside className={styles.summary} aria-label="Account summary">
      <div className={styles.avatar} aria-hidden="true">
        {initial}
      </div>
      
      <h2 className={styles.summaryName}>{name || 'Your account'}</h2>
      <p className={styles.summaryEmail}>{email}</p>

      {/* Gamified Loyalty Badge */}
      <div 
        style={{
          display: 'inline-block',
          padding: '6px 12px',
          borderRadius: '20px',
          fontSize: '0.75rem',
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          backgroundColor: badgeBg,
          color: badgeColor,
          marginTop: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
        }}
      >
        {loyaltyBadge}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', margin: '20px 0 12px 0' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#071B3A' }}>{ordersCount}</p>
          <p style={{ margin: 0, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)' }}>Orders</p>
        </div>
      </div>

      <div className={styles.summaryDivider} role="presentation" />

      <button
        type="button"
        onClick={handleSignOut}
        className={styles.signOut}
      >
        Sign out
      </button>
    </aside>
  );
}
