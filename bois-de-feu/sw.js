// Service worker : application disponible hors-ligne.

const APP_CACHE = 'bf-app-v6';
const TILE_CACHE = 'bf-tiles-v1';
const MAX_TILES = 6000;

const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/photos.js',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png',
  'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon.png',
  'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png',
  'vendor/geoman/leaflet-geoman.min.js',
  'vendor/geoman/leaflet-geoman.css',
  'img/logo-triage.jpg',
  'icons/logo-vallon-180.png',
  'icons/logo-vallon-192.png',
  'icons/logo-vallon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bf-app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Réseau d'abord (mises à jour), cache si hors-ligne.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'wmts.geo.admin.ch' || (url.hostname === 'wms.geo.admin.ch' && !/getcapabilities/i.test(url.search))) { event.respondWith(tileFirst(req)); return; }
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(APP_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});

// Images de carte swisstopo : cache d'abord (carte disponible sans réseau).
let tileCount = 0;
async function tileFirst(req) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(req.url);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') {
      cache.put(req.url, res.clone()).catch(() => {});
      if (++tileCount % 200 === 0) trim(cache);
    }
    return res;
  } catch (err) {
    return new Response('', { status: 504, statusText: 'Hors-ligne' });
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}
