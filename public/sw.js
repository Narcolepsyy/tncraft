const CACHE_NAME = 'tncraft-pwa-v6';
const RELATIVE_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const base = self.registration.scope;
      const shellUrls = RELATIVE_SHELL.map((p) => new URL(p, base).toString());
      await cache.addAll(shellUrls);

      try {
        const indexRes = await cache.match(new URL('./index.html', base).toString());
        if (indexRes) {
          const html = await indexRes.text();
          const matches = [...html.matchAll(/(?:src|href)=["']([^"']*assets\/[^"']+)["']/g)];
          const assetUrls = matches.map((m) => new URL(m[1], base).toString());
          if (assetUrls.length > 0) {
            await cache.addAll(assetUrls);
          }
        }
      } catch {
        // Optional bundle precache fallback
      }

      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;

  const fallbackIndex = new URL('./index.html', self.registration.scope).toString();
  const isDocOrScript =
    req.mode === 'navigate' ||
    req.destination === 'document' ||
    req.url.endsWith('/index.html');

  // Network-first for HTML navigations so online users immediately receive updates,
  // falling back to offline cache when disconnected.
  if (isDocOrScript) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match(fallbackIndex)))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached || caches.match(fallbackIndex));
      return cached || fetchPromise;
    })
  );
});
