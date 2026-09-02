const CACHE_NAME = 'energytech-quiz-app-v46-session-report';
const FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './question_bank.js',
  './question_bank_ch03.js',
  './explanation_links.js',
  './manifest.webmanifest',
  './icon.svg',
  './images/original_q07_circuit.png',
  './images/original_q10_cranes.png',
  './images/original_q28_shaft.png',
  './images/original_q31_shape.png',
  './images/original_q32_shape.png',
  './images/original_q35_barrel.png',
  './images/ch03_q15_tape.jpg',
  './images/ch03_q16_tape.jpg',
  './images/ch03_q17_tape.jpg',
  './images/ch03_q18_tape.jpg',
  './images/ch03_q25_paper.jpg',
  './images/ch03_q26_tire.jpg',
  './images/ch03_q27_wrenches.jpg',
  './images/ch03_q28_race.jpg',
  './images/ch03_q29_coin.jpg',
  './images/ch03_q30_fingernail.jpg',
  './images/ch03_q35_apple.jpg',
  './images/ch03_q36_train.jpg',
  './images/ch03_q37_flour.jpg',
  './images/ch03_q38_capsule.jpg',
  './images/ch03_q67_screwdriver.jpg',
  './images/ch03_q68_screw.jpg'
];

// skipWaiting + clients.claim: without them a new version installs but sits idle
// until every tab of the app is closed, so a plain refresh (even Ctrl+F5) keeps
// serving the old cached files. That made updates look like they had not applied.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Never cache the Google Apps Script calls -- they must always hit the network.
  if (!req.url.startsWith(self.location.origin)) return;

  // App shell files are fetched network-first so a redeployed build is picked up
  // on the next load, falling back to the cache when offline. Everything else
  // (images, icons) stays cache-first.
  const shell = /\.(html|js|css|webmanifest)$/.test(new URL(req.url).pathname)
    || new URL(req.url).pathname.endsWith('/');
  if (shell) {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }
  event.respondWith(caches.match(req).then(res => res || fetch(req)));
});
