// Cache only the public application shell. Private APIs and artwork never enter CacheStorage.
const CACHE = 'energydeck-shell-v48';
const SHELL = ['/', '/app.js', '/details.js', '/charts.js', '/display.js', '/battery-plan.js', '/battery-forward.js', '/battery-detail.js', '/sunshine.js', '/ev-plan.js', '/live.js', '/fonts/Montserrat-Medium.ttf', '/styles.css', '/details.css', '/translations.json', '/icon.svg', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/favicon.ico'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('energydeck-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search || !SHELL.includes(url.pathname)) return;
  // Prefer current files; offline access can load the shell, but never household readings.
  event.respondWith(fetch(event.request).catch(() => caches.match(url.pathname)));
});
