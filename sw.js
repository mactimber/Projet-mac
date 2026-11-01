// Service worker : application disponible hors-ligne + cache des tuiles cartographiques.

const APP_CACHE = 'rf-app-v27';
const TILE_CACHE = 'rf-tiles-v1';
const MAX_RUNTIME_TILES = 6000;

const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/draw.js',
  'js/fiche.js',
  'js/place.js',
  'js/share.js',
  'vendor/qrcode/qrcode.js',
  'js/swiss.js',
  'js/symbols.js',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png',
  'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon.png',
  'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png',
  'vendor/geoman/leaflet-geoman.min.js',
  'vendor/geoman/leaflet-geoman.css',
  'icons/logo-vallon-180.png',
  'img/logo-triage.jpg',
  'icons/logo-vallon-192.png',
  'icons/logo-vallon-512.png',
];

const TILE_HOSTS = ['wmts.geo.admin.ch', 'wms.geo.admin.ch', 'tile.openstreetmap.org', 'sit.vs.ch', 'geodienste.ch'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rf-app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Tuiles : cache d'abord, puis réseau (et mise en cache).
  if (TILE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`)) && !/getcapabilities/i.test(url.search)) {
    event.respondWith(tileFirst(req));
    return;
  }

  // Fichiers de l'application : réseau d'abord (mises à jour), cache si hors-ligne.
  if (url.origin === self.location.origin) {
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
  }
});

let runtimeCount = 0;

async function tileFirst(req) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(req.url);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') {
      cache.put(req.url, res.clone()).catch(() => {});
      if (++runtimeCount % 200 === 0) trimCache(cache);
    }
    return res;
  } catch (err) {
    return new Response('', { status: 504, statusText: 'Hors-ligne' });
  }
}

async function trimCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_RUNTIME_TILES;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}
