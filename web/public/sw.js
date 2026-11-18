// Service Worker für Kita-Ausfall NRW – bewusst schlicht, ohne Bibliothek.
// - /assets/* (Dateinamen mit Hash): cache-first
// - Seitenaufrufe: network-first, offline Rückfall auf die zuletzt geladene App-Hülle
// - GET /api/v1/kitas/…: network-first mit Cache-Rückfall („Meine Kitas“ offline)
// - Nie gecacht: POST, /api/v1/pow, /link, /berichtigung, /einladung
const VERSION = 'v1';
const ASSETS = `assets-${VERSION}`;
const SEITEN = `seiten-${VERSION}`;
const API = `api-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SEITEN)
      .then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg']))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![ASSETS, SEITEN, API].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const NIE = [/^\/api\/v1\/pow\//, /^\/api\/v1\/link/, /^\/api\/v1\/berichtigung/, /^\/api\/v1\/einladung/];

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const treffer = (await cache.match(request)) || (fallbackUrl && (await cache.match(fallbackUrl)));
    if (treffer) return treffer;
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const treffer = await cache.match(request);
  if (treffer) return treffer;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (NIE.some((r) => r.test(p))) return;
  // Requests mit Token (Authorization) nie cachen.
  if (req.headers.has('authorization')) return;

  if (p.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req));
  } else if (req.mode === 'navigate') {
    // Seiten aus Mail-Links (#token) laufen normal; offline zeigt die App-Hülle die Fehlermeldung.
    event.respondWith(networkFirst(req, SEITEN, '/'));
  } else if (p.startsWith('/api/v1/kitas/') || p === '/api/v1/info' || p === '/api/v1/status') {
    event.respondWith(networkFirst(req, API));
  }
});
