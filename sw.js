/* Service worker: cache-first for static assets, stale-while-revalidate for everything else,
   offline fallback for navigations. Bump VERSION on every release. */
const VERSION = 'v1.0.0';
const STATIC_CACHE = `staad-static-${VERSION}`;
const RUNTIME_CACHE = `staad-runtime-${VERSION}`;
const OFFLINE_URL = './offline.html';
const RUNTIME_LIMIT = 60;
const PRECACHE = [
  "./",
  "./index.html",
  "./offline.html",
  "./manifest.json",
  "./assets/tailwind.css",
  "./assets/fonts.css",
  "./assets/app.css",
  "./assets/pwa.js",
  "./assets/fonts/inter-latin-400-normal.woff2",
  "./assets/fonts/inter-latin-500-normal.woff2",
  "./assets/fonts/inter-latin-600-normal.woff2",
  "./assets/fonts/inter-latin-700-normal.woff2",
  "./assets/fonts/inter-latin-800-normal.woff2",
  "./assets/fonts/jetbrains-mono-latin-400-normal.woff2",
  "./assets/fonts/jetbrains-mono-latin-500-normal.woff2",
  "./assets/fonts/jetbrains-mono-latin-600-normal.woff2",
  "./assets/fonts/jetbrains-mono-latin-700-normal.woff2",
  "./icons/apple-touch-icon-180.png",
  "./icons/favicon-32.png",
  "./icons/icon-128.png",
  "./icons/icon-144.png",
  "./icons/icon-152.png",
  "./icons/icon-192.png",
  "./icons/icon-256.png",
  "./icons/icon-384.png",
  "./icons/icon-512.png",
  "./icons/icon-72.png",
  "./icons/icon-96.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/icon-maskable.svg",
  "./icons/icon.svg"
];
const STATIC_EXT = /\.(?:css|js|woff2?|ttf|otf|png|jpe?g|webp|gif|svg|ico)$/i;
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
  ); // no skipWaiting: the page offers "Update" and sends SKIP_WAITING
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [STATIC_CACHE, RUNTIME_CACHE];
    await Promise.all((await caches.keys()).filter((k) => k.startsWith('staad-') && !keep.includes(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'staad-refresh-shell') event.waitUntil(refreshShell());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;

  if (req.mode === 'navigate') { event.respondWith(handleNavigation(event)); return; }
  const sameOrigin = url.origin === self.location.origin;
  if ((sameOrigin && STATIC_EXT.test(url.pathname)) || FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req)); return;
  }
  event.respondWith(staleWhileRevalidate(event));
});

async function handleNavigation(event) {
  const url = new URL(event.request.url);
  const isShell = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  const cache = await caches.open(STATIC_CACHE);
  const network = fetch(event.request).then((res) => {
    if (isShell && res && res.ok && !res.redirected) cache.put('./index.html', res.clone());
    return res;
  }).catch(() => null);
  if (isShell) {
    const cached = await cache.match('./index.html');
    if (cached) { event.waitUntil(network); return cached; } // instant, then refresh in background
  }
  const res = await network;
  if (res) return res;
  return (await cache.match(OFFLINE_URL)) || new Response('You are offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
}

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  } catch (_) {
    return Response.error();
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(RUNTIME_CACHE);
  const hit = await cache.match(event.request);
  const network = fetch(event.request).then(async (res) => {
    if (res && (res.ok || res.type === 'opaque')) { await cache.put(event.request, res.clone()); trim(cache); }
    return res;
  }).catch(() => null);
  if (hit) { event.waitUntil(network); return hit; }
  return (await network) || new Response('', { status: 504, statusText: 'Offline' });
}

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > RUNTIME_LIMIT) await Promise.all(keys.slice(0, keys.length - RUNTIME_LIMIT).map((k) => cache.delete(k)));
}

async function refreshShell() {
  const cache = await caches.open(STATIC_CACHE);
  await Promise.all(PRECACHE.map((u) => fetch(new Request(u, { cache: 'reload' })).then((r) => r.ok && cache.put(u, r)).catch(() => {})));
}
