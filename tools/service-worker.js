// Offline support. The build fills in the list of files and a version derived from their content.
const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = `wheelie-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // A replay link opens the same page whatever follows the address.
      // Servers that answer with `Vary: Origin` would otherwise hide scripts and styles from the lookup.
      const cached = await cache.match(request.mode === 'navigate' ? './' : request.url, {
        ignoreSearch: true,
        ignoreVary: true,
      });
      if (cached) return cached;
      const response = await fetch(request);
      // Whole files fetched later (level packs) are kept for offline play too.
      if (response.status === 200) await cache.put(request, response.clone());
      return response;
    })(),
  );
});
