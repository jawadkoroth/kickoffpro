'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Admin Welcome Greeting
 * 
 * Personalized time-based greeting for admin dashboard.
 * Luxury control-room aesthetic with editorial typography.
 */

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

function extractFirstName(email: string | undefined): string {
  if (!email) return 'Admin';
  
  // Extract name from email (e.g., jawad@kickoffpro.com → Jawad)
  const localPart = email.split('@')[0];
  
  // Handle common separators
  const name = localPart
    .split(/[._-]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
  
  return name || 'Admin';
}

export default function AdminWelcome() {
  const [firstName, setFirstName] = useState<string>('');
  const [greeting, setGreeting] = useState<string>(getGreeting());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    
    // Update greeting on mount (avoid hydration mismatch)
    setGreeting(getGreeting());
    
    // Fetch admin profile
    const fetchProfile = async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        
        if (user?.email) {
          setFirstName(extractFirstName(user.email));
        }
      } catch (err) {
        console.error('Failed to fetch admin profile:', err);
      }
    };
    
    fetchProfile();
    
    // Update greeting every minute
    const interval = setInterval(() => {
      setGreeting(getGreeting());
    }, 60000);
    
    return () => clearInterval(interval);
  }, []);

  // Prevent hydration mismatch - render nothing on server
  if (!mounted) {
    return (
      <div style={{ 
        minHeight: '80px',
        marginBottom: 'var(--space-6)',
      }} />
    );
  }

  return (
    <div 
      style={{ 
        marginBottom: 'var(--space-6)',
        paddingBottom: 'var(--space-4)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Greeting */}
      <h1
        style={{
          fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
          fontWeight: 800,
          letterSpacing: '-0.02em',
          color: 'var(--navy, #071B3A)',
          lineHeight: 1.2,
          margin: 0,
          fontFamily: 'inherit',
          textTransform: 'uppercase',
        }}
      >
        {greeting},
        <br />
        <span
          style={{
            color: 'var(--blue, #2FA9F5)',
          }}
        >
          {firstName}
        </span>
      </h1>
      
      {/* Subtle tagline */}
      <p
        style={{
          marginTop: 'var(--space-3)',
          fontSize: '0.875rem',
          color: 'var(--text-muted, #9A9A9A)',
          letterSpacing: '0.02em',
          fontWeight: 400,
        }}
      >
        KickoffPro Operations Dashboard
      </p>
    </div>
  );
}
