'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useCart } from '@/lib/cart';

const STORAGE_KEY = 'kp_live_session_id';

function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = window.sessionStorage.getItem(STORAGE_KEY);
    if (!id || id.length < 5) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'sess_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      window.sessionStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    return 'fallback_' + Math.random().toString(36).slice(2);
  }
}

export default function LiveHeartbeat() {
  const pathname = usePathname();
  const { totalItems, totalPaise } = useCart();
  const referrerRef = useRef<string | null>(null);
  const isSendingRef = useRef(false);

  useEffect(() => {
    if (typeof document !== 'undefined' && document.referrer) {
      referrerRef.current = document.referrer;
    }
  }, []);

  const sendHeartbeat = () => {
    if (typeof window === 'undefined') return;
    if (!pathname || pathname.startsWith('/admin') || pathname.startsWith('/api')) {
      return;
    }
    const sessionId = getOrCreateSessionId();
    if (!sessionId) return;

    if (isSendingRef.current) return;
    isSendingRef.current = true;

    fetch('/api/tracking/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        sessionId,
        path: pathname,
        referrer: referrerRef.current,
        productCount: totalItems || 0,
        cartTotalPaise: totalPaise || 0,
      }),
    })
      .catch(() => {})
      .finally(() => {
        isSendingRef.current = false;
      });
  };

  // Trigger immediately on mount and route change
  useEffect(() => {
    sendHeartbeat();
  }, [pathname, totalItems, totalPaise]);

  // Periodic heartbeat every 30s while page is visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        sendHeartbeat();
      }
    }, 30000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        sendHeartbeat();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [pathname, totalItems, totalPaise]);

  return null;
}
