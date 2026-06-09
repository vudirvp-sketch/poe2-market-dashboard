// ============================================================================
// PoE2 Market Dashboard — Service Worker
//
// v4 FIX: Changed caching strategy for _next/static/ to network-first.
// Previous cache-first strategy caused 404 errors after rebuilds because
// the SW served stale HTML that referenced old chunk hashes.
//
// AUTO-BUST: The CACHE_NAME is updated automatically on each build via
// `npm run postbuild` → `scripts/bump-sw-cache.js`. This ensures stale
// caches are cleaned up after every deployment without manual version bumps.
//
// Strategy:
// - HTML pages:        network-first (always get fresh HTML)
// - _next/static/*:    network-first (fresh build assets take priority)
// - API requests:      stale-while-revalidate
// - Other static:      cache-first (icons, manifest, etc.)
// ============================================================================

const CACHE_NAME = 'poe2-market-v1780948202269';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-1024.png',
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
            // Silently skip assets that fail to fetch
          })
        )
      )
    )
  );
  // Force activation without waiting for existing clients to close
  self.skipWaiting();
});

// Activate: clean old caches IMMEDIATELY
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  // Take control of all clients immediately
  self.clients.claim();
});

// Fetch routing
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests (except fonts from CDN)
  if (url.origin !== self.location.origin && !url.hostname.includes('poecdn.com')) return;

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

  // HTML navigation requests: network-first
  // This is CRITICAL — stale HTML references old chunk hashes → 404 errors
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then((cached) => cached || new Response('Offline', { status: 503 }))
        )
    );
    return;
  }

  // _next/static/*: network-first with fallback to cache
  // After each build, chunk hashes change — we must always try network first
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return new Response('Not found', { status: 404 });
          })
        )
    );
    return;
  }

  // Other static assets (icons, manifest, etc.): cache-first
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
