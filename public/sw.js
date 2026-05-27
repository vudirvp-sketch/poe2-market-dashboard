const CACHE_NAME = 'poe2-market-v3';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/logo.svg',
];

// Install: cache static assets (ignore individual failures)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Use addAll with a fallback: cache what we can, skip what fails
      Promise.allSettled(
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch(() => {
            // Silently skip assets that fail to fetch (e.g. favicon.ico in dev)
          })
        )
      )
    )
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: stale-while-revalidate for API, cache-first for static
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // API requests: stale-while-revalidate
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        fetch(event.request)
          .then((response) => {
            if (response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          })
          .catch(() => cache.match(event.request).then((r) => r || new Response('Offline', { status: 503 })))
      )
    );
    return;
  }

  // Static assets: cache-first, but never crash on failure
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => new Response('Not found', { status: 404 }));
    })
  );
});
