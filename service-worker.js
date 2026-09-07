const CACHE_NAME = 'energytech-quiz-app-v53-ch12a-original-pdf';
const FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './question_bank.js',
  './question_bank_ch03.js',
  './question_bank_ch12a.js',
  './explanation_links.js',
  './worksheet_tex.js',
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
  // Chapter 12A's drawings. The SVGs are listed because every trainee sees
  // them; the PDF twin of each, which only the worksheet export uses, is
  // deliberately NOT listed -- 3.5 MB downloaded onto every device for a
  // button only an instructor presses, and only while online.
  './figures_ch12a/0132f9050e1a.svg',
  './figures_ch12a/01b106c206d1.svg',
  './figures_ch12a/037bf67d1a81.svg',
  './figures_ch12a/0383b05b05ed.svg',
  './figures_ch12a/05038b39ea5e.svg',
  './figures_ch12a/0557e219727f.svg',
  './figures_ch12a/094433bd1e9f.svg',
  './figures_ch12a/09509b6ebc83.svg',
  './figures_ch12a/095130c0c6c7.svg',
  './figures_ch12a/0b58671f5523.svg',
  './figures_ch12a/0c8e443b14a1.svg',
  './figures_ch12a/0c981b07cbee.svg',
  './figures_ch12a/0cbe58008d86.svg',
  './figures_ch12a/121f315f2d87.svg',
  './figures_ch12a/143827c9f03f.svg',
  './figures_ch12a/18a2710a5d7d.svg',
  './figures_ch12a/18f71e99d48f.svg',
  './figures_ch12a/1c21ddf15e94.svg',
  './figures_ch12a/1c77e1192d20.svg',
  './figures_ch12a/1c8e220b94cc.svg',
  './figures_ch12a/1d69126b3b06.svg',
  './figures_ch12a/1ecbf31d05d7.svg',
  './figures_ch12a/20d6e2b746b0.svg',
  './figures_ch12a/20dd00f2dcbc.svg',
  './figures_ch12a/22241911a792.svg',
  './figures_ch12a/2356a431b661.svg',
  './figures_ch12a/23febbec8bdf.svg',
  './figures_ch12a/24e6ef0e6c4b.svg',
  './figures_ch12a/26d41bf90bf6.svg',
  './figures_ch12a/286e6596c7cc.svg',
  './figures_ch12a/297948e7a817.svg',
  './figures_ch12a/2a3676aee88a.svg',
  './figures_ch12a/2b99ad4fcddc.svg',
  './figures_ch12a/2bff163443e5.svg',
  './figures_ch12a/2c7aa12ecd82.svg',
  './figures_ch12a/2d692b233cfd.svg',
  './figures_ch12a/2ebd98a100a8.svg',
  './figures_ch12a/349854fa3725.svg',
  './figures_ch12a/36cc94e82ace.svg',
  './figures_ch12a/392aac5b5805.svg',
  './figures_ch12a/402b7576d96b.svg',
  './figures_ch12a/410838f43627.svg',
  './figures_ch12a/44df00dbe7cf.svg',
  './figures_ch12a/48152fd7082f.svg',
  './figures_ch12a/482db9625a49.svg',
  './figures_ch12a/48353dba5fe3.svg',
  './figures_ch12a/499249ae57ad.svg',
  './figures_ch12a/4d7445257999.svg',
  './figures_ch12a/4deedf42faa0.svg',
  './figures_ch12a/4e0ceef208e1.svg',
  './figures_ch12a/4e57e9467d10.svg',
  './figures_ch12a/4e86c92cf70c.svg',
  './figures_ch12a/4f631db2356c.svg',
  './figures_ch12a/4fc9d97f9e20.svg',
  './figures_ch12a/507f52dd4a34.svg',
  './figures_ch12a/516b1997e114.svg',
  './figures_ch12a/526d0b08c2f6.svg',
  './figures_ch12a/52b8d07166e3.svg',
  './figures_ch12a/52b9b419b679.svg',
  './figures_ch12a/545e538f585e.svg',
  './figures_ch12a/559224616a52.svg',
  './figures_ch12a/58f9221915fa.svg',
  './figures_ch12a/5aca7da80b74.svg',
  './figures_ch12a/5e8cda1da85c.svg',
  './figures_ch12a/5fcc0326b677.svg',
  './figures_ch12a/630dfa6d417a.svg',
  './figures_ch12a/63cdd2a81b5d.svg',
  './figures_ch12a/656f84b5cbe4.svg',
  './figures_ch12a/66d3213a17f5.svg',
  './figures_ch12a/679b2f7d84fc.svg',
  './figures_ch12a/69e769dd1622.svg',
  './figures_ch12a/6b1420fe7d0a.svg',
  './figures_ch12a/6b610b2bf3fc.svg',
  './figures_ch12a/6bafecefc8c5.svg',
  './figures_ch12a/6c521156f5dc.svg',
  './figures_ch12a/6cf1de10b5dd.svg',
  './figures_ch12a/70d046947a0e.svg',
  './figures_ch12a/763dbab724b3.svg',
  './figures_ch12a/7903af1d1384.svg',
  './figures_ch12a/7af3fb96d1b8.svg',
  './figures_ch12a/7cd57f5537df.svg',
  './figures_ch12a/7d30f2050f82.svg',
  './figures_ch12a/7ecf209ed49a.svg',
  './figures_ch12a/7fe4a831f900.svg',
  './figures_ch12a/828565f05585.svg',
  './figures_ch12a/83483eb285ae.svg',
  './figures_ch12a/83c944d71fd0.svg',
  './figures_ch12a/851c133edf4e.svg',
  './figures_ch12a/8760e08cac4a.svg',
  './figures_ch12a/890b0788baea.svg',
  './figures_ch12a/8a95650ed12c.svg',
  './figures_ch12a/8b01c012d7e0.svg',
  './figures_ch12a/8ca6a1200545.svg',
  './figures_ch12a/8cfb7d3e269c.svg',
  './figures_ch12a/8d0f1048eea2.svg',
  './figures_ch12a/8dac952d1664.svg',
  './figures_ch12a/907fad134f70.svg',
  './figures_ch12a/911afafb1869.svg',
  './figures_ch12a/92f69384c201.svg',
  './figures_ch12a/93df454cd408.svg',
  './figures_ch12a/94aa604d6910.svg',
  './figures_ch12a/976a8630fa12.svg',
  './figures_ch12a/981a65bd77bb.svg',
  './figures_ch12a/9af2142b632e.svg',
  './figures_ch12a/9b177ea33d2c.svg',
  './figures_ch12a/9b6a445311ad.svg',
  './figures_ch12a/9c6b969cc985.svg',
  './figures_ch12a/a29f1151fd4b.svg',
  './figures_ch12a/a753b9a5f93a.svg',
  './figures_ch12a/ab95ccd2cfd6.svg',
  './figures_ch12a/ac77c63c3c31.svg',
  './figures_ch12a/ada9b89dc78d.svg',
  './figures_ch12a/afa388f2a78d.svg',
  './figures_ch12a/afd3ef51bc46.svg',
  './figures_ch12a/b05bea843562.svg',
  './figures_ch12a/b10ae33ec745.svg',
  './figures_ch12a/b1128ce9489d.svg',
  './figures_ch12a/b119f0693db9.svg',
  './figures_ch12a/b2c33560189d.svg',
  './figures_ch12a/b41f1f4d65c0.svg',
  './figures_ch12a/b4ad861235c0.svg',
  './figures_ch12a/b670483dc7e3.svg',
  './figures_ch12a/b91de5563ee3.svg',
  './figures_ch12a/bed228ec71da.svg',
  './figures_ch12a/bf04012371e8.svg',
  './figures_ch12a/c517d39c2511.svg',
  './figures_ch12a/c5267cf0550d.svg',
  './figures_ch12a/c7924760d06e.svg',
  './figures_ch12a/c8cfa4480d4d.svg',
  './figures_ch12a/c9bd440dc1d3.svg',
  './figures_ch12a/cdafc2a42151.svg',
  './figures_ch12a/cf752b2d32b3.svg',
  './figures_ch12a/d07234032899.svg',
  './figures_ch12a/d0b9daa8efce.svg',
  './figures_ch12a/d17d63a4285b.svg',
  './figures_ch12a/d302981d86fa.svg',
  './figures_ch12a/d38bb082f2a1.svg',
  './figures_ch12a/d6a25998cfc5.svg',
  './figures_ch12a/d6d2d2b0e544.svg',
  './figures_ch12a/d7117db44066.svg',
  './figures_ch12a/d819fc8c9390.svg',
  './figures_ch12a/d81a7ca443cd.svg',
  './figures_ch12a/d82f4322e2a9.svg',
  './figures_ch12a/da5230b4138d.svg',
  './figures_ch12a/dbbf7b939539.svg',
  './figures_ch12a/e15103a2734e.svg',
  './figures_ch12a/e1b0088ebd2d.svg',
  './figures_ch12a/e407a332c28f.svg',
  './figures_ch12a/e58f3dc65f9e.svg',
  './figures_ch12a/e59ddf0a1167.svg',
  './figures_ch12a/e791b338c0ff.svg',
  './figures_ch12a/eb933999be8d.svg',
  './figures_ch12a/f1163cd9ac9d.svg',
  './figures_ch12a/f21a1a339591.svg',
  './figures_ch12a/f6c57fe0cf7d.svg',
  './figures_ch12a/f812cef7c6fb.svg',
  './figures_ch12a/f8b4201f5a93.svg',
  './figures_ch12a/f93c1ec561a6.svg',
  './figures_ch12a/fad0ea458d63.svg',
  './figures_ch12a/fcce9d175347.svg',
  './figures_ch12a/fd204312648d.svg',
  './figures_ch12a/fe3fc0e93045.svg',
  './images/ch12a_q76_a.png',
  './images/ch12a_q76_b.png',
  './images/ch12a_q76_c.png',
  './images/ch12a_q76_d.png',
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
