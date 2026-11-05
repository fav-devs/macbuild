// App shell and last-seen data for offline use; IPAs and install files always go to the network.
const CACHE = 'macbuild-v7';
const SHELL = ['/', '/style.css', '/app.js', '/manifest.webmanifest', '/icon-192.png', '/apple-touch-icon.png'];
self.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/ota/') || /app\.ipa|log\.txt|\/log$/.test(url.pathname)) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); }
    return response;
  }).catch(() => caches.match(event.request, { ignoreSearch: url.pathname === '/' }).then((hit) => hit ?? Response.error())));
});
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(self.registration.showNotification(data.title ?? 'macbuild', { body: data.body, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: data.url ?? '/' } }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((open) => {
    const client = open[0];
    if (client) return client.focus().then(() => client.navigate(event.notification.data.url));
    return self.clients.openWindow(event.notification.data.url);
  }));
});
