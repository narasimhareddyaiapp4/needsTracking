/* Needs Tracker PWA Service Worker */
const CACHE_NAME = 'needs-tracker-pwa-v8';

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './favicon.ico'
];

// Install: Cache essential shell assets and activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        STATIC_ASSETS.map((url) =>
          fetch(url, { cache: 'no-cache' }).then((res) => {
            if (res.ok) {
              return cache.put(url, res);
            }
          }).catch(() => {})
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up previous caches and take control
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Deleting stale cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Secure rewriting, font caching, Network-first for dynamic navigation, Cache-first for images/icons/fonts
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip non-GET requests and external third-party API/Websocket calls
  if (req.method !== 'GET' || url.hostname.includes('supabase.co') || url.protocol.startsWith('ws')) {
    return;
  }

  // 1. Intercept legacy domain (needstracking.com) or insecure HTTP requests and rewrite to HTTPS on current host
  let targetUrl = url;
  if (url.protocol === 'http:' || url.hostname.includes('needstracking.com')) {
    const rawPath = url.pathname;
    const cleanPath = rawPath.startsWith('/needsTracking')
      ? rawPath
      : ('/needsTracking' + (rawPath.startsWith('/') ? rawPath : '/' + rawPath));
    targetUrl = new URL(cleanPath + url.search, self.location.origin);
  }

  const effectiveReq = (targetUrl.href !== req.url)
    ? new Request(targetUrl.href, {
        method: req.method,
        headers: req.headers,
        mode: req.mode === 'navigate' ? 'navigate' : 'cors',
        credentials: req.credentials
      })
    : req;

  // 2. Cache-first for static images, icons, and fonts (e.g., FontAwesome .ttf)
  if (
    req.destination === 'image' ||
    req.destination === 'font' ||
    targetUrl.pathname.match(/\.(png|jpg|jpeg|svg|webp|ico|ttf|woff|woff2|otf|eot)$/)
  ) {
    event.respondWith(
      caches.match(effectiveReq).then((cached) => {
        if (cached) return cached;
        return fetch(effectiveReq).then((response) => {
          if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(effectiveReq, clone));
          }
          return response;
        }).catch(() => {
          if (req.destination === 'image') {
            return caches.match('./icon-192.png');
          }
          return new Response(null, { status: 404, statusText: 'Not Found' });
        });
      })
    );
    return;
  }

  // 3. Network-first with cache fallback for HTML, JS and styles (no-cache fetch to ensure fresh bundles)
  const fetchOptions = (req.mode === 'navigate' || req.destination === 'document')
    ? { cache: 'no-cache' }
    : undefined;

  event.respondWith(
    fetch(effectiveReq, fetchOptions).then((response) => {
      if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(effectiveReq, clone));
      }
      return response;
    }).catch(() => {
      return caches.match(effectiveReq).then((cached) => {
        if (cached) return cached;
        if (req.mode === 'navigate' || req.destination === 'document') {
          return caches.match('./') || caches.match('./index.html');
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      });
    })
  );
});

// ==============================================================================
// BACKEND WEB PUSH NOTIFICATIONS
// ==============================================================================
self.addEventListener('push', (event) => {
  console.log('[SW] Push event received:', event);

  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (_) {
      try {
        data = { body: event.data.text() };
      } catch (err) {
        data = { body: 'You have a new update.' };
      }
    }
  }

  const title = data.title || 'Needs Tracker';
  const notificationOptions = {
    body: data.body || 'Order status or delivery update received.',
    icon: data.icon || './icon-192.png',
    badge: data.badge || './icon-192.png',
    data: data.data || {},
    vibrate: [200, 100, 200],
    tag: data.tag || `needs-tracking-${Date.now()}`,
    renotify: true,
    requireInteraction: false,
    actions: data.actions || []
  };

  event.waitUntil(
    self.registration.showNotification(title, notificationOptions)
  );
});

// Notification Click: Focus existing tab or open destination
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};
  console.log('[SW] Notification clicked with data:', notifData);

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Find open tab within app scope
      for (const client of windowClients) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({
            type: 'NOTIFICATION_CLICKED',
            data: notifData,
          });
          return;
        }
      }
      // If no tab open, open app root
      if (clients.openWindow) {
        return clients.openWindow(self.registration.scope);
      }
    })
  );
});
