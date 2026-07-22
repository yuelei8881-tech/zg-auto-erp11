const CACHE = 'zg-auto-erp-shell-v0870';
const SHELL = ['/', '/manifest.webmanifest', '/icons/zg-auto-icon.svg'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('zg-auto-erp-shell-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request, { cache: 'no-store' }).then(response => { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put('/', copy)); return response; }).catch(() => caches.match('/')));
    return;
  }
  if (['style', 'script', 'image', 'font'].includes(request.destination)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => { if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone())); return response; })));
  }
});
