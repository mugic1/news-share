const CACHE_NAME = 'studystream-v1';
const urlsToCache = [
  './index.html',
  './style.css',
  './app.js',
  'https://unpkg.com/lucide@latest',
  'https://www.youtube.com/iframe_api'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
