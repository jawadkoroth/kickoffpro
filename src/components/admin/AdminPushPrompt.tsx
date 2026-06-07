'use client';

import { useEffect, useState } from 'react';

/**
 * Header pill that:
 *
 *   1. Registers `/sw-admin.js` (idempotent).
 *   2. Requests Notification permission on click.
 *   3. After permission is granted, fetches the public VAPID key
 *      and calls `pushManager.subscribe()`, then POSTs the
 *      subscription to `/api/admin/push/subscribe` so the server
 *      can fan out true background notifications via web-push.
 *
 * The pill auto-hides once subscribed, denied, or unsupported.
 * If push is not configured server-side (no VAPID env vars),
 * /api/admin/push/vapid returns 404 and we fall back to the
 * Notification API alone — which still works while any admin tab
 * is open. No user-visible failure.
 */

type State =
  | 'pending'
  | 'unsupported'
  | 'ios-install'
  | 'default'
  | 'subscribing'
  | 'subscribed'
  | 'denied';

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIos && isSafari;
}

function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  const mq = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone = (navigator as { standalone?: boolean }).standalone === true;
  return Boolean(mq || iosStandalone);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    return await navigator.serviceWorker.register('/sw-admin.js', { scope: '/admin' });
  } catch (err) {
    console.error('[PUSH_SW_REGISTER]', err);
    return null;
  }
}

async function alreadySubscribed(): Promise<boolean> {
  try {
    // Prefer the scoped registration we own; fall back to whichever
    // registration the browser has for this origin. Some iOS / Chrome
    // combos return null from getRegistration(scope) even after a
    // successful register() call earlier in the session.
    const reg =
      (await navigator.serviceWorker.getRegistration('/admin')) ||
      (await navigator.serviceWorker.getRegistration()) ||
      null;
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
}

export default function AdminPushPrompt() {
  const [state, setState] = useState<State>('pending');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      // iOS Safari only exposes PushManager when the site is installed
      // as a PWA (iOS 16.4+). If we detect iOS Safari that's NOT in
      // standalone mode, show an install hint instead of a dead end.
      if (isIosSafari() && !isStandalonePwa()) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState('ios-install');
        return;
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState('unsupported');
      return;
    }

    // Best-effort SW register; failure is non-fatal.
    ensureServiceWorker();

    (async () => {
      const perm = Notification.permission;
      if (perm === 'denied') return setState('denied');
      if (perm === 'default') return setState('default');
      // perm === 'granted' — check whether we already have a sub.
      const sub = await alreadySubscribed();
      setState(sub ? 'subscribed' : 'default');
    })();
  }, []);

  async function subscribe() {
    setState('subscribing');
    try {
      let perm = Notification.permission;
      if (perm === 'default') {
        perm = await Notification.requestPermission();
      }
      if (perm !== 'granted') {
        setState(perm === 'denied' ? 'denied' : 'default');
        return;
      }

      const reg = await ensureServiceWorker();
      if (!reg) {
        // SW unavailable — Notification API still works while tab
        // is open. Treat as subscribed so we stop nagging.
        setState('subscribed');
        return;
      }

      // Fetch VAPID public key. 404 = push not configured; we
      // gracefully fall back to in-tab Notifications.
      let publicKey: string | null = null;
      try {
        const vapidRes = await fetch('/api/admin/push/vapid', { cache: 'no-store' });
        if (vapidRes.ok) {
          const json = await vapidRes.json();
          publicKey = (json as { publicKey?: string }).publicKey ?? null;
        }
      } catch (err) {
        console.error('[PUSH_VAPID_FETCH]', err);
      }

      if (!publicKey) {
        // No web-push backend → realtime + Notification path only.
        setState('subscribed');
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      });

      // Persist on the server. The browser representation has
      // `getKey()` accessors that return ArrayBuffers; we extract
      // them as base64url strings the way web-push expects.
      const json = sub.toJSON() as PushSubscriptionJSON;
      const endpoint = json.endpoint;
      const p256dh = json.keys?.p256dh;
      const auth = json.keys?.auth;
      if (!endpoint || !p256dh || !auth) {
        setState('subscribed');
        return;
      }

      await fetch('/api/admin/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint,
          keys: { p256dh, auth },
        }),
      });

      setState('subscribed');
    } catch (err) {
      console.error('[PUSH_SUBSCRIBE_FLOW]', err);
      // Permission may have been granted but subscribe failed
      // (browser quirk, network). Notifications via the in-tab
      // path still work; treat as subscribed to stop prompting.
      setState('subscribed');
    }
  }

  if (state === 'unsupported' || state === 'denied' || state === 'pending') {
    return null;
  }

  // iOS Safari (not installed): one-line nudge to install the PWA
  // because Apple gates Web Push behind Home-Screen installation.
  if (state === 'ios-install') {
    return (
      <span
        title="Install NOIR Admin to your Home Screen to enable push notifications"
        style={{
          fontSize: '0.65rem',
          letterSpacing: '0.08em',
          color: 'var(--text-muted, #9A9A9A)',
          marginRight: 8,
          whiteSpace: 'nowrap',
        }}
      >
        📱 Install to enable alerts
      </span>
    );
  }

  if (state === 'subscribed') {
    return <AdminPushTestButton />;
  }

  const busy = state === 'subscribing';

  return (
    <button
      type="button"
      onClick={busy ? undefined : subscribe}
      disabled={busy}
      title="Enable browser notifications for new orders"
      style={{
        background: 'transparent',
        border: '1px solid rgba(212, 175, 55, 0.45)',
        color: 'var(--gold, #D4AF37)',
        padding: '4px 10px',
        borderRadius: '999px',
        fontSize: '0.7rem',
        fontWeight: 600,
        letterSpacing: '0.08em',
        cursor: busy ? 'progress' : 'pointer',
        marginRight: 8,
        whiteSpace: 'nowrap',
        opacity: busy ? 0.7 : 1,
      }}
    >
      {busy ? '🔔 ENABLING…' : '🔔 ENABLE ALERTS'}
    </button>
  );
}

/**
 * Small "test push" pill shown only when the admin is already
 * subscribed. Calls /api/admin/push/test which fans out a no-op
 * notification to EVERY admin subscription via `notifyAdmins`, so
 * the operator can verify the full pipeline (VAPID → web-push →
 * push service → service worker → showNotification) without
 * placing a real order.
 *
 * Quietly hides itself if the server responds 404 (push not
 * configured) so it never clutters the header for environments
 * running without VAPID keys.
 */
function AdminPushTestButton() {
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<'idle' | 'ok' | 'none' | 'err'>('idle');

  async function sendTest() {
    if (busy) return;
    setBusy(true);
    setFlash('idle');
    try {
      const res = await fetch('/api/admin/push/test', { method: 'POST' });
      if (res.status === 404) {
        setHidden(true);
        return;
      }
      const data = await res.json();
      if (!data?.success) {
        setFlash('err');
      } else if ((data.sent ?? 0) > 0) {
        setFlash('ok');
      } else {
        setFlash('none');
      }
    } catch {
      setFlash('err');
    } finally {
      setBusy(false);
      setTimeout(() => setFlash('idle'), 2400);
    }
  }

  if (hidden) return null;

  const label =
    flash === 'ok'
      ? '✓ SENT'
      : flash === 'none'
        ? 'NO SUBS'
        : flash === 'err'
          ? 'FAILED'
          : busy
            ? 'SENDING…'
            : '🔔 TEST PUSH';

  return (
    <button
      type="button"
      onClick={sendTest}
      disabled={busy}
      title="Send a test notification to all admin subscriptions"
      style={{
        background: 'transparent',
        border: '1px solid rgba(212, 175, 55, 0.28)',
        color:
          flash === 'ok'
            ? 'var(--success, #4CAF50)'
            : flash === 'err'
              ? 'var(--error, #E53935)'
              : 'var(--text-muted, #9A9A9A)',
        padding: '4px 10px',
        borderRadius: '999px',
        fontSize: '0.65rem',
        fontWeight: 600,
        letterSpacing: '0.10em',
        cursor: busy ? 'progress' : 'pointer',
        marginRight: 8,
        whiteSpace: 'nowrap',
        opacity: busy ? 0.7 : 1,
        transition: 'color 180ms ease, border-color 180ms ease',
      }}
    >
      {label}
    </button>
  );
}
