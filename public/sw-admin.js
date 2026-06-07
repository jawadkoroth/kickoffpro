/**
 * NOIR Admin — Production-grade service worker for operational notifications.
 *
 * Responsibilities:
 *   1. Background push notification delivery with category support
 *   2. Notification deduplication via tags
 *   3. Click-to-navigate: focus existing tab or open new window
 *   4. Silent subscription expiry recovery messaging
 *   5. Clean coordination with main app SW
 *
 * Categories:
 *   - new_order: New order received
 *   - shipment_update: Shipment status changed
 *   - webhook_failure: Provider webhook issues
 *   - operational_alert: System warnings
 *   - diagnostics_warning: Health check failures
 */

// Notification category configuration
const NOTIFICATION_CONFIG = {
  new_order: {
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    tag: 'kickoffpro-order',
    vibrate: [200, 100, 200],
    requireInteraction: false,
  },
  shipment_update: {
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    tag: 'kickoffpro-shipment',
    vibrate: [150, 50, 150],
    requireInteraction: false,
  },
  webhook_failure: {
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    tag: 'kickoffpro-webhook',
    vibrate: [300, 100, 300, 100, 300],
    requireInteraction: true,
  },
  operational_alert: {
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    tag: 'kickoffpro-alert',
    vibrate: [250, 100, 250],
    requireInteraction: true,
  },
  diagnostics_warning: {
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    tag: 'kickoffpro-diag',
    vibrate: [100, 50, 100],
    requireInteraction: false,
  },
};

// Install: Activate immediately for operational responsiveness
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

// Activate: Claim all clients
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Push: Handle background notifications with category routing
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
    payload = {
      title: 'KickoffPro Alert',
      body: event.data ? event.data.text() : 'Operational notification',
      type: 'operational_alert'
    };
  }

  const type = payload.type || 'new_order';
  const config = NOTIFICATION_CONFIG[type] || NOTIFICATION_CONFIG.new_order;

  // Deduplication: use orderId or shipmentId as tag suffix
  const tag = payload.orderId
    ? `${config.tag}-${payload.orderId}`
    : payload.shipmentId
      ? `${config.tag}-${payload.shipmentId}`
      : config.tag;

  const title = payload.title || 'KickoffPro Admin';
  const options = {
    body: payload.body || '',
    tag: tag,
    renotify: true,
    requireInteraction: config.requireInteraction,
    silent: payload.silent || false,
    vibrate: config.vibrate,
    icon: config.icon,
    badge: config.badge,
    data: {
      url: payload.url || '/admin/dashboard',
      orderId: payload.orderId,
      shipmentId: payload.shipmentId,
      type: type,
      timestamp: Date.now(),
    },
    actions: payload.actions || [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click: Smart navigation
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const { action } = event;
  if (action === 'dismiss') return;
  // 'view' or default click both navigate to the order

  const data = event.notification.data || {};
  const type = data.type || 'new_order';

  // Build target URL based on notification type
  let targetUrl = data.url || '/admin/dashboard';
  if (data.orderId && targetUrl === '/admin/dashboard') {
    targetUrl = `/admin/orders/${data.orderId}`;
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Find existing admin tab
        for (const client of clientList) {
          if (client.url.includes('/admin')) {
            // Navigate to specific order if available
            if ('navigate' in client) {
              client.navigate(targetUrl);
            }
            if ('focus' in client) {
              return client.focus();
            }
          }
        }
        // Open new window if no admin tab exists
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return null;
      })
  );
});

// Subscription change: Notify app to resubscribe
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({
          type: 'PUSH_SUBSCRIPTION_EXPIRED',
          timestamp: Date.now(),
        });
      });
    })
  );
});

// Message handling from main app
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data === 'PING') {
    event.source?.postMessage?.({ type: 'PONG', timestamp: Date.now() });
    return;
  }

  // ── Realtime order alert routed from AdminRealtimeProvider when app is backgrounded ──
  if (event.data?.type === 'SHOW_ORDER_NOTIFICATION') {
    const p = event.data.payload || {};
    const tag = p.orderId ? `kickoffpro-order-${p.orderId}` : 'kickoffpro-order';

    const notifOptions = {
      body: p.body || 'A new order has been placed.',
      tag,
      renotify: true,
      requireInteraction: false,
      silent: false,
      vibrate: [120, 60, 200, 60, 120],
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-96x96.png',
      data: {
        url: p.url || '/admin/orders',
        orderId: p.orderId,
        type: 'new_order',
        timestamp: Date.now(),
      },
      actions: [
        { action: 'view', title: '👁 View Order' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    };

    event.waitUntil(
      self.registration.showNotification(p.title || '💰 New Order — KickoffPro', notifOptions)
    );
    return;
  }
});
