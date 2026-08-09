const CACHE_NAME = 'sendy-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  // Sadece GET isteklerini ve kendi domainimizi cachele
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  // API veya uploads klasörünü cacheleme
  if (e.request.url.includes('/api/') || e.request.url.includes('/uploads/')) return;

  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});
