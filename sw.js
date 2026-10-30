/* ============================================================
   SERVICE WORKER — Form Speed Extruder (PWA)
   ============================================================
   Fungsi minimal: agar aplikasi bisa diinstal sebagai PWA.
   Tidak melakukan caching agresif karena data GAS harus
   selalu fresh (real-time dari server).
   ============================================================ */

const CACHE_NAME = 'fse-shell-v1';

// Aset statis yang di-cache (app shell)
const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './scanner.js',
  './app.js',
  './manifest.json'
];

// Install: cache aset shell
self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_ASSETS).catch(function (err) {
        console.warn('SW: gagal cache sebagian aset', err);
      });
    })
  );
});

// Activate: bersihkan cache lama
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE_NAME; })
            .map(function (key) { return caches.delete(key); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Fetch: strategi network-first untuk file lokal, bypass total untuk GAS
self.addEventListener('fetch', function (event) {
  const url = event.request.url;

  // Jangan ganggu request ke GAS / external / JSONP
  if (url.indexOf('script.google.com') !== -1 ||
      url.indexOf('unpkg.com') !== -1 ||
      url.indexOf('fonts.googleapis.com') !== -1 ||
      url.indexOf('fonts.gstatic.com') !== -1 ||
      url.indexOf('flaticon.com') !== -1 ||
      url.indexOf('cdn-icons-png') !== -1) {
    return; // biarkan browser handle langsung
  }

  // Strategi network-first: coba jaringan dulu, fallback ke cache
  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        // Simpan salinan ke cache (hanya untuk request GET same-origin)
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(function () {
        return caches.match(event.request).then(function (cached) {
          if (cached) return cached;
          // Jika tidak ada di cache dan offline, tampilkan pesan
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});
