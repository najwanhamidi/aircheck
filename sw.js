// AirCheck service worker: app shell works offline; live data always comes from the network.
const CACHE = 'aircheck-v2';
const SHELL = ['./', 'index.html', 'desktop.html', 'config.js', 'css/app.css', 'js/stations.js', 'js/core.js', 'js/app.js',
  'vendor/chart.umd.min.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;   // APIs: straight to network
  if (url.pathname.includes('/data/')) return;                                // cached readings: never stale-serve
  // app shell: network first (so updates arrive), cache as fallback when offline
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
