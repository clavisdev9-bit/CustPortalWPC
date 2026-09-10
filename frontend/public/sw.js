// manifest.webmanifest is deliberately NOT in this list: it's read by the browser out-of-band for
// PWA install metadata, not fetched by app code, so cache-first buys it nothing -- and it did cost
// something once already (v2->v3 bump below exists to flush a copy that got stuck caching an HTML
// interstitial page instead of the real JSON, permanently reproducing as a manifest parse error
// on every load since cache-first never re-fetches an entry that's already cached).
const CACHE_NAME = 'custportalwpc-shell-v3';
const SHELL_ASSETS = ['/', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

// Cache-first for the static app shell ONLY -- the exact SHELL_ASSETS paths above. Everything
// else same-origin (every JS/CSS module Vite serves, every SPA route/HTML navigation) must always
// go to the network: this app ships no build-hashed filenames in dev, so a stale cached module
// (e.g. an old src/api/client.js) would keep being served forever after a real fix landed on
// disk, with no way for a returning browser to ever pick it up. API calls (any origin/path under
// /api/) are also always network -- per-user, auth-scoped data must never be cached.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !SHELL_ASSETS.includes(url.pathname)) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
