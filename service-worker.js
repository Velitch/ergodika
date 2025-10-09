/* === Ergodika Service Worker (clean) ===
 * - Precache asset essenziali
 * - Bypass API/Stripe/Workers
 * - Network-first per HTML e /config/app.json
 * - Stale-while-revalidate per asset statici
 * - Cleanup cache vecchie + attivazione immediata
 */

const CACHE = 'ergodika-v6';

/** Asset essenziali da avere sempre offline (solo se realmente esistono) */
const ASSETS = [
  '/', '/index.html',
  // CSS / JS base
  '/assets/css/style.css',
  '/assets/js/app.js',
  '/assets/js/pwa-install.js',

  // Pagine principali
  '/pages/manifesto.html',
  '/pages/radio.html',
  '/pages/members.html',
  '/pages/artist-onboarding.html',
  '/pages/thank-you.html',

  // Config & PWA
  '/config/app.json',
  '/manifest.json',
  '/assets/images/icon-192.png',
  '/assets/images/icon-512.png',

  // Moduli (se presenti)
  '/assets/js/payments.js',
  '/assets/js/members.js',
  '/assets/css/members.css',
];

/** Host/percorsi da NON intercettare */
const BYPASS_HOST_TESTS = [
  // API del tuo dominio (copri sia /api che /api/...)
  (url) => url.pathname === '/api' || url.pathname.startsWith('/api/'),

  // Worker backend (qualsiasi sottodominio .workers.dev)
  (url) => url.hostname.endsWith('.workers.dev'),

  // Stripe (script, API, hooks, rete)
  (url) => url.hostname === 'js.stripe.com',
  (url) => url.hostname === 'hooks.stripe.com',
  (url) => url.hostname === 'api.stripe.com',
  (url) => url.hostname.endsWith('.stripe.com'),
  (url) => url.hostname.endsWith('.stripe.network'),
];

/** Helpers */
const isHtml = (req) =>
  req.destination === 'document' ||
  (req.headers && req.headers.get('accept')?.includes('text/html'));

const isAssetRequest = (url) => ASSETS.includes(url.pathname);

const isStaticExt = (url) =>
  /\.(?:css|js|mjs|json|png|jpg|jpeg|gif|svg|webp|ico|woff2?)$/i.test(url.pathname);

const shouldBypass = (req, url) =>
  req.method !== 'GET' || BYPASS_HOST_TESTS.some(fn => fn(url));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      await cache.addAll(ASSETS);
    } catch (e) {
      // ignora asset mancanti: non bloccare l'install
      console.warn('[SW] precache warn:', e && e.message);
    } finally {
      await self.skipWaiting();
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((n) => (n === CACHE ? null : caches.delete(n))));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1) BYPASS: API/Workers/Stripe e tutte le non-GET passano dritte alla rete
  if (shouldBypass(event.request, url)) return; // niente respondWith → pass-through

  // 2) Network-first per HTML e per /config/app.json (recepisci subito aggiornamenti)
  if (isHtml(event.request) || url.pathname === '/config/app.json') {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // 3) Stale-while-revalidate per gli asset elencati in ASSETS
  if (isAssetRequest(url)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // 4) Stale-while-revalidate per altri asset statici dello stesso dominio (css/js/img non elencati)
  if (url.origin === self.location.origin && isStaticExt(url)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // 5) Default: passa alla rete (niente cache)
  // (nessun respondWith → pass-through)
});

/* === Strategie di cache === */

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    // Fallback di navigazione: prova l’index offline
    if (isHtml(request)) {
      const index = await cache.match('/index.html');
      if (index) return index;
    }
    // Se non c'è nulla, rilancia l'errore
    throw new Error('Offline e nessun contenuto in cache');
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const fetchPromise = fetch(request).then((fresh) => {
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  }).catch(() => null);

  // Servi subito cache se c’è, altrimenti attendi rete
  return cached || fetchPromise || fetch(request);
}

// Consenti al client di dire "attivati subito"
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
