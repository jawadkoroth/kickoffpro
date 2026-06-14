'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * KickoffPro Admin â€” Premium Realtime Alert System v2
 *
 * Visibility-aware notification routing:
 *   - App foreground/visible  â†’ in-app glassmorphism toast (top-center mobile, top-right desktop)
 *   - App background/hidden   â†’ enhanced push via SW postMessage
 *
 * Toast features:
 *   - Top-center on mobile (slide-down)
 *   - Top-right on desktop
 *   - "View Order" CTA with direct routing
 *   - Large amount, money emoji, customer name, payment badge
 *   - Auto-dismiss 6s, stacks safely up to 5
 *
 * Sound design:
 *   - order   â†’ premium cash register (two bell tones)
 *   - return  â†’ soft neutral
 *   - cancel  â†’ warning tone
 *   - exchange â†’ premium ping
 */

export const ADMIN_ORDER_CREATED_EVENT = 'admin:order-created';

interface OrderInsertPayload {
  id: string;
  order_number: string;
  total_paise: number;
  payment_method?: string;
  customer?: { name?: string };
}

interface ToastEntry {
  id: number;
  orderId: string;
  orderNumber: string;
  totalPaise: number;
  paymentMethod: string;
  customerName: string;
  createdAt: number;
}

const TOAST_TTL_MS = 6000;
const MAX_TOASTS = 5;
const MUTE_STORAGE_KEY = 'kickoffpro_admin_sound_muted';

function getMuteState(): boolean {
  if (typeof window === 'undefined') return false;
  try { return localStorage.getItem(MUTE_STORAGE_KEY) === 'true'; } catch { return false; }
}

function setMuteState(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(MUTE_STORAGE_KEY, muted ? 'true' : 'false'); } catch { /* ignore */ }
}

function formatPrice(paise: number): string {
  return 'â‚¹' + (paise / 100).toLocaleString('en-IN');
}

function isAppVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'visible';
}

/**
 * Premium synthesised SFX â€” zero deps, bandwidth-free.
 * order    â†’ cash register double bell
 * return   â†’ soft neutral descend
 * cancel   â†’ low warning double pulse
 * exchange â†’ bright single ping
 */
type SoundType = 'order' | 'return' | 'cancel' | 'exchange';

function playAlertSound(type: SoundType = 'order'): void {
  if (typeof window === 'undefined' || getMuteState()) return;
  try {
    const Ctx =
      (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.14;
    master.connect(ctx.destination);

    const tone = (freq: number, start: number, dur: number, shape: OscillatorType = 'sine') => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = shape;
      osc.frequency.setValueAtTime(freq, now + start);
      g.gain.setValueAtTime(0, now + start);
      g.gain.linearRampToValueAtTime(1, now + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
      osc.connect(g).connect(master);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.05);
    };

    if (type === 'order') {
      tone(880, 0, 0.25);         // A5
      tone(1108.73, 0.09, 0.3);   // C#6 â€” sweet third
      tone(1318.51, 0.18, 0.25);  // E6 â€” fifth completes triad
    } else if (type === 'return') {
      tone(659.25, 0, 0.2);       // E5 â€” soft
      tone(523.25, 0.12, 0.25);   // C5 â€” descend
    } else if (type === 'cancel') {
      tone(293.66, 0, 0.18, 'triangle'); // D4
      tone(261.63, 0.14, 0.2, 'triangle'); // C4 â€” minor resolve
    } else if (type === 'exchange') {
      tone(1174.66, 0, 0.18);     // D6 â€” bright ping
    }

    setTimeout(() => { ctx.close().catch(() => { }); }, 900);
  } catch { /* ignore */ }
}

function vibrate(pattern: number[] = [60, 40, 80]): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  }
}

/**
 * Route order notification to SW when app is backgrounded.
 * The service worker will show a rich Android-compatible notification.
 */
function notifyViaServiceWorker(payload: OrderInsertPayload): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then((reg) => {
    reg.active?.postMessage({
      type: 'SHOW_ORDER_NOTIFICATION',
      payload: {
        title: 'ðŸ’° New order â€” KickoffPro',
        body: `${payload.customer?.name?.split(' ')[0] || 'Guest'} Â· ${formatPrice(payload.total_paise)}`,
        orderId: payload.id,
        orderNumber: payload.order_number,
        amount: formatPrice(payload.total_paise),
        paymentMethod: payload.payment_method ?? 'online',
        url: `/admin/orders/${payload.id}`,
      },
    });
  }).catch(() => { });
}

export default function AdminRealtimeProvider() {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [showMuteIndicator, setShowMuteIndicator] = useState(false);
  const mountedRef = useRef(true);
  const seenIds = useRef<Set<string>>(new Set());
  const toastIdRef = useRef(0);

  useEffect(() => { 
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMuted(getMuteState()); 
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleMuteToggle = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    setMuteState(next);
    setShowMuteIndicator(true);
    setTimeout(() => setShowMuteIndicator(false), 1600);
  }, [isMuted]);

  const handleNewOrder = useCallback((payload: OrderInsertPayload) => {
    if (seenIds.current.has(payload.id)) return;
    seenIds.current.add(payload.id);
    if (seenIds.current.size > 200) {
      const first = seenIds.current.values().next().value;
      if (first) seenIds.current.delete(first);
    }
    if (!mountedRef.current) return;

    if (isAppVisible()) {
      // â”€â”€ Foreground: show in-app toast â”€â”€
      const entry: ToastEntry = {
        id: ++toastIdRef.current,
        orderId: payload.id,
        orderNumber: payload.order_number,
        totalPaise: payload.total_paise,
        paymentMethod: payload.payment_method ?? 'online',
        customerName: payload.customer?.name ?? '',
        createdAt: Date.now(),
      };

      setToasts((prev) => {
        const next = [...prev, entry];
        return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
      });

      setTimeout(() => {
        if (mountedRef.current) setToasts((prev) => prev.filter((t) => t.id !== entry.id));
      }, TOAST_TTL_MS);

      playAlertSound('order');
      vibrate();
    } else {
      // â”€â”€ Background: route to service worker for rich push â”€â”€
      notifyViaServiceWorker(payload);
    }

    // Always dispatch dashboard refresh event
    try {
      window.dispatchEvent(new CustomEvent(ADMIN_ORDER_CREATED_EVENT, { detail: payload }));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const supabase = createClient();

    const channel = supabase
      .channel('admin-orders-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (msg) => {
          const row = msg.new as Partial<OrderInsertPayload> | undefined;
          if (!row?.id || !row.order_number || typeof row.total_paise !== 'number') return;
          handleNewOrder({
            id: row.id,
            order_number: row.order_number,
            total_paise: row.total_paise,
            payment_method: row.payment_method,
            customer: row.customer,
          });
        },
      )
      .subscribe();

    return () => {
      mountedRef.current = false;
      supabase.removeChannel(channel).catch(() => { });
    };
  }, [handleNewOrder]);

  return (
    <>
      {/* â”€â”€ Toast Container â”€â”€ */}
      <div
        aria-live="polite"
        aria-atomic="false"
        style={{
          position: 'fixed',
          // Mobile: top-center (below header). Desktop: top-right.
          top: 'calc(60px + env(safe-area-inset-top, 0px) + 8px)',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          zIndex: 9999,
          pointerEvents: 'none',
          width: 'min(400px, calc(100vw - 32px))',
          // Desktop: right-align, not centered
        }}
        className="kickoffpro-toast-container"
      >
        {[...toasts].reverse().map((t) => (
          <AdminOrderToast key={t.id} toast={t} onDismiss={dismissToast} />
        ))}
      </div>

      {/* ── Mute toggle pill — positioned top-left below header ── */}
      <button
        onClick={handleMuteToggle}
        style={{
          position: 'fixed',
          top: 'calc(60px + env(safe-area-inset-top, 0px) + 12px)',
          left: 'max(16px, env(safe-area-inset-left, 0px))',
          zIndex: 999,
          background: 'rgba(18,18,18,0.88)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid rgba(47,169,245,0.22)',
          borderRadius: '999px',
          padding: '7px 14px',
          fontSize: '0.7rem',
          fontWeight: 600,
          letterSpacing: '0.07em',
          color: isMuted ? 'var(--text-muted, #8A8A8A)' : 'rgba(47,169,245,0.8)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          transition: 'all 200ms ease',
          boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
        }}
        title={isMuted ? 'Unmute alerts' : 'Mute alerts'}
      >
        <span style={{ fontSize: '0.85rem' }}>{isMuted ? '🔇' : '🔔'}</span>
        <span>{isMuted ? 'MUTED' : 'SOUND ON'}</span>
      </button>

      {/* ── Mute flash indicator ── */}
      {showMuteIndicator && (
        <div
          style={{
            position: 'fixed',
            top: 'calc(60px + env(safe-area-inset-top, 0px) + 48px)',
            left: 'max(16px, env(safe-area-inset-left, 0px))',
            transform: 'none',
            zIndex: 10000,
            background: 'rgba(18,18,18,0.92)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(47,169,245,0.25)',
            borderRadius: '8px',
            padding: '9px 16px',
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.06em',
            color: 'var(--blue, #2FA9F5)',
            pointerEvents: 'none',
            animation: 'kickoffpro-fade-inout 1.6s ease forwards',
            whiteSpace: 'nowrap',
          }}
        >
          {isMuted ? 'ðŸ”‡  Alerts muted' : 'ðŸ””  Sound enabled'}
        </div>
      )}

      <style jsx global>{`
        @keyframes kickoffpro-fade-inout {
          0%   { opacity: 0; transform: translateX(-50%) translateY(6px); }
          12%  { opacity: 1; transform: translateX(-50%) translateY(0); }
          80%  { opacity: 1; transform: translateX(-50%) translateY(0); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-6px); }
        }
        @keyframes kickoffpro-toast-slide-down {
          0%   { opacity: 0; transform: translateY(-18px) scale(0.97); }
          45%  { opacity: 1; transform: translateY(3px) scale(1.005); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes kickoffpro-toast-glow {
          0%   { box-shadow: 0 20px 50px rgba(0,0,0,0.55), 0 0 30px rgba(47,169,245,0.04); }
          100% { box-shadow: 0 20px 50px rgba(0,0,0,0.55), 0 0 50px rgba(47,169,245,0.09); }
        }
        @media (min-width: 640px) {
          .kickoffpro-toast-container {
            left: auto !important;
            right: 20px !important;
            transform: none !important;
          }
        }
      `}</style>
    </>
  );
}

function AdminOrderToast({
  toast,
  onDismiss,
}: {
  toast: ToastEntry;
  onDismiss: (id: number) => void;
}) {
  const router = useRouter();
  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const firstName = toast.customerName?.split(' ')[0] || 'Guest';
  const shortId = toast.orderNumber?.slice(-6) || '------';
  const isCod = toast.paymentMethod === 'cod';

  return (
    <div
      role="status"
      style={{
        pointerEvents: 'auto',
        background: 'rgba(14,14,14,0.82)',
        border: '1px solid rgba(47,169,245,0.2)',
        borderTop: '2px solid rgba(47,169,245,0.6)',
        color: '#ECECEC',
        borderRadius: '16px',
        boxShadow: '0 20px 50px rgba(0,0,0,0.55), 0 0 30px rgba(47,169,245,0.04)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        animation: prefersReduced
          ? undefined
          : 'kickoffpro-toast-slide-down 420ms cubic-bezier(0.16,1,0.3,1), kickoffpro-toast-glow 2s ease-in-out infinite alternate',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Depth sheen */}
      <div
        style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit',
          background: 'linear-gradient(135deg, rgba(255,255,255,0.025) 0%, transparent 55%, rgba(0,0,0,0.08) 100%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', zIndex: 1, padding: '14px 16px' }}>
        {/* Row 1: emoji label + order id + dismiss */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: '1.3rem', lineHeight: 1, filter: 'drop-shadow(0 0 8px rgba(47,169,245,0.5))' }}>
            ðŸ¤‘
          </span>
          <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.16em', color: 'rgba(47,169,245,0.9)', textTransform: 'uppercase' }}>
            New Order
          </span>
          <span style={{ fontSize: '0.6rem', color: '#666', fontFamily: 'ui-monospace, monospace', letterSpacing: '0.04em', marginLeft: 2 }}>
            #{shortId}
          </span>
          <button
            onClick={() => onDismiss(toast.id)}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 2px' }}
            aria-label="Dismiss"
          >
            Ã—
          </button>
        </div>

        {/* Row 2: customer name + big amount */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: '1.05rem', fontWeight: 600, letterSpacing: '-0.01em', color: '#F0F0F0' }}>
              {firstName}
            </span>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em',
                textTransform: 'uppercase',
                padding: '2px 7px', borderRadius: '999px',
                background: isCod ? 'rgba(255,152,0,0.12)' : 'rgba(76,175,80,0.12)',
                border: `1px solid ${isCod ? 'rgba(255,152,0,0.3)' : 'rgba(76,175,80,0.3)'}`,
                color: isCod ? '#FF9800' : '#4CAF50',
              }}
            >
              {isCod ? 'ðŸ’µ COD' : 'ðŸ’³ Paid'}
            </span>
          </div>

          <span style={{
            fontSize: '1.45rem', fontWeight: 700,
            fontFamily: 'ui-monospace, monospace',
            letterSpacing: '-0.03em',
            color: 'rgba(47,169,245,0.95)',
            textShadow: '0 0 24px rgba(47,169,245,0.3)',
            lineHeight: 1,
          }}>
            {formatPrice(toast.totalPaise)}
          </span>
        </div>

        {/* Row 3: View Order CTA */}
        <button
          onClick={() => router.push(`/admin/orders/${toast.orderId}`)}
          style={{
            width: '100%',
            padding: '8px 0',
            background: 'rgba(47,169,245,0.1)',
            border: '1px solid rgba(47,169,245,0.25)',
            borderRadius: '8px',
            color: 'rgba(47,169,245,0.9)',
            fontSize: '0.7rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            transition: 'background 150ms ease, border-color 150ms ease',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(47,169,245,0.18)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(47,169,245,0.1)';
          }}
        >
          VIEW ORDER â†’
        </button>
      </div>
    </div>
  );
}
