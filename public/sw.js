/**
 * NOIR — Progressive Web App Service Worker
 *
 * Strategy:
 *   - Shell caching: App shell assets cached for offline resilience
 *   - API passthrough: Admin API calls never cached (always fresh)
 *   - Image caching: Product images cached with stale-while-revalidate
 *   - Update flow: Detect new SW, notify client, skip waiting on message
 *   - Push handling: Background notifications with click-to-focus
 *
 * Security:
 *   - No admin data cached
 *   - No auth tokens in SW scope
 *   - API routes explicitly excluded from cache
 */

const CACHE_CORE = 'kickoffpro-core-v1';
const CACHE_IMAGES = 'kickoffpro-images-v1';
const CACHE_ASSETS = 'kickoffpro-assets-v1';

// Core static assets only (no SSR routes)
const CORE_ASSETS = [
  '/manifest.json',
  '/icons/icon.svg',
];

// API routes that must never be cached
const API_BLACKLIST = [
  '/api/admin',
  '/api/auth',
  '/api/webhooks',
];

// SSR routes that should not be cached
const SSR_ROUTES = [
  '/admin',
  '/admin/dashboard',
  '/admin/orders',
  '/admin/products',
  '/admin/coupons',
  '/admin/shipping',
  '/admin/diagnostics',
];

// Install: Cache core assets only
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_CORE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: Claim clients and clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name.startsWith('kickoffpro-') && name !== CACHE_CORE && name !== CACHE_IMAGES && name !== CACHE_ASSETS)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch: Cache strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip API calls entirely
  if (API_BLACKLIST.some((prefix) => url.pathname.startsWith(prefix))) {
    return;
  }

  // Skip external resources
  if (url.origin !== self.location.origin) return;

  // Skip SSR routes - never cache dynamic HTML
  if (SSR_ROUTES.some((route) => url.pathname.startsWith(route))) {
    return;
  }

  // Images: Stale-while-revalidate
  if (request.destination === 'image') {
    event.respondWith(
      caches.open(CACHE_IMAGES).then(async (cache) => {
        const cached = await cache.match(request);
        const fetchPromise = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Core assets: Cache-first with network fallback
  if (CORE_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (!response || response.status !== 200) return response;
          const clone = response.clone();
          caches.open(CACHE_CORE).then((cache) => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Static assets (JS/CSS): Cache-first
  if (request.destination === 'script' || request.destination === 'style') {
    event.respondWith(
      caches.open(CACHE_ASSETS).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // Navigation: Network-first with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() =>
          new Response(
            `<!DOCTYPE html>
<html>
<head><title>KickoffPro — Offline</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{background:#0F172A;color:#fff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:20px}
.icon{font-size:48px;margin-bottom:16px}
h1{font-size:18px;font-weight:600;letter-spacing:0.1em;margin-bottom:8px}
p{font-size:14px;color:#888;margin:0}
</style></head>
<body>
<div>
<div class="icon">📡</div>
<h1>KICKOFFPRO OFFLINE</h1>
<p>Connection lost. Working offline mode.</p>
<p style="margin-top:20px;font-size:12px;color:#666">Check network and retry</p>
</div>
</body>
</html>`,
            { headers: { 'Content-Type': 'text/html' } }
          )
        )
    );
  }
});

// Message handling: Skip waiting for updates
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Push: Background notifications
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { title: 'KickoffPro Alert', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'KickoffPro Admin';
  const options = {
    body: payload.body || '',
    tag: payload.tag || 'kickoffpro-alert',
    renotify: true,
    requireInteraction: payload.requireInteraction || false,
    silent: false,
    vibrate: [200, 100, 200],
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    data: {
      url: payload.url || '/admin/dashboard',
      orderId: payload.orderId,
      type: payload.type || 'general',
    },
    actions: payload.actions || [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click: Focus or open window
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const { action } = event;
  const data = event.notification.data || {};
  const targetUrl = data.url || '/admin/dashboard';

  if (action === 'dismiss') return;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Find existing admin window
        for (const client of clientList) {
          if (client.url.includes('/admin')) {
            if ('navigate' in client) {
              client.navigate(targetUrl);
            }
            if ('focus' in client) {
              return client.focus();
            }
          }
        }
        // Open new window if none exists
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});

// Push subscription change: Notify app
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGE' });
      });
    })
  );
});
