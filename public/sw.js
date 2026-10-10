// Minimal offline cache: the app shell only (the JS/CSS/HTML Vite builds).
// The map, sound and sprites are all generated in code, so there is nothing
// else to cache - a fresh build just bumps CACHE_NAME to invalidate the old one.
const CACHE_NAME = 'wriggle-shell-v2';
const SHELL = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Network-first for navigation and built assets, so a new deploy is picked up
// the moment there is a connection; falls back to the cache when offline.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then((cached) => cached ?? caches.match('./'))),
  );
});
