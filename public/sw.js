const CACHE_NAME = 'auth-handoff-v9';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Network-first for everything since this is a live tool
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
