
const CACHE = 'ergodika-v1';
const ASSETS = [
  '/', '/index.html','/assets/css/style.css','/assets/js/app.js',
  '/pages/manifesto.html','/pages/radio.html','/pages/members.html','/pages/artist-onboarding.html',
  '/manifest.json','/assets/images/icon-192.png','/assets/images/icon-512.png','/config/app.json'
];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate', e=>{ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  if (ASSETS.includes(url.pathname)) {
    e.respondWith(caches.match(e.request).then(r=> r || fetch(e.request)));
  }
});
