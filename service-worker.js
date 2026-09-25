// v60: the app itself has moved (see index.html) -- this list is deliberately cut
// down to what the retirement notice needs, not the quiz app's. A new CACHE_NAME
// is what actually matters here: activate() below deletes every cache key that
// is not this one, so a tablet with v59's ~7.5 MB app cache still installed gets
// it evicted the moment this version activates, and is left holding only the
// notice page. tools/site-files.json and every other file in this repository are
// untouched -- restoring the real app (Sunday's rollback) is reverting this
// commit, not editing a manifest.
const CACHE_NAME = 'energytech-quiz-app-v60-retired';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './apple-touch-icon.png',
  './favicon-32.png',
  './favicon-16.png',
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
