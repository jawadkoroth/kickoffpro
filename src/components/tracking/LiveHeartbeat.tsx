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

  const sendHeartbeat = async () => {
    if (typeof window === 'undefined') return;
    if (!pathname || pathname.startsWith('/admin') || pathname.startsWith('/api')) {
      return;
    }
    const sessionId = getOrCreateSessionId();
    if (!sessionId) return;

    if (isSendingRef.current) return;
    isSendingRef.current = true;

    const payload = {
      sessionId,
      path: pathname,
      referrer: referrerRef.current,
      productCount: totalItems || 0,
      cartTotalPaise: totalPaise || 0,
    };

    console.log('[Heartbeat sent]', payload);

    const postHeartbeat = (url: string) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify(payload),
      });

    try {
      let res = await postHeartbeat('/api/tracking/heartbeat').catch(() => null);
      if (!res || !res.ok) {
        // Fallback to unblocked presence endpoint if blocked by browser ad blocker or 500
        res = await postHeartbeat('/api/session/heartbeat').catch(() => null);
      }

      if (!res) {
        console.error('[Heartbeat network error] Failed to reach heartbeat endpoint');
        return;
      }

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        console.warn('[Heartbeat response warning]', res.status, json);
      } else {
        console.log('[Heartbeat acknowledged]', json);
      }
    } catch (err) {
      console.error('[Heartbeat network error]', err);
    } finally {
      isSendingRef.current = false;
    }
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
