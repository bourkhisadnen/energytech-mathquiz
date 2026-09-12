/* The app shell: the icon set, the manifest, and the service worker.
 *
 * This suite exists because of what it found on the day it was written. The
 * service worker had a missing comma in its precache list -- two adjacent
 * string literals -- so the file did not parse, `register()` rejected, and
 * app.js swallowed the rejection with `.catch(() => {})`. The app therefore had
 * NO offline support and NO precaching from the moment Chapter 12A's figures
 * were added, and nothing noticed: every other suite drives the page over a
 * live server, where an app with a dead service worker behaves exactly like one
 * with a working service worker.
 *
 * So the checks here are deliberately end-to-end rather than textual. A parse
 * check alone would have caught that one bug, but registering the worker for
 * real and reading back what it cached also catches a precache entry that
 * 404s -- cache.addAll() rejects atomically, which fails the install and leaves
 * trainees with nothing cached, again silently.
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = '/tmp/energytech_app/energytech_quiz_app_session_sync_fixed';
const BASE = 'http://127.0.0.1:8901/index.html';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

/* A PNG's real dimensions, straight out of the IHDR header, so a file that
 * claims "512x512" in the manifest can be checked against what it actually is. */
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.subarray(1, 4).toString() !== 'PNG') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function precacheList() {
  const src = fs.readFileSync(path.join(APP, 'service-worker.js'), 'utf8');
  const m = src.match(/const FILES = \[([\s\S]*?)\];/);
  return [...m[1].matchAll(/'\.\/(.*?)'/g)].map(x => x[1]);
}

(async () => {
  console.log('\n=== 1. The service worker is valid JavaScript ===');
  // The cheap check that the expensive one below supersedes -- kept because
  // when it fails it says exactly which line, which `register()` rejecting
  // does not.
  let parses = true, parseErr = '';
  try {
    execFileSync('node', ['--check', path.join(APP, 'service-worker.js')], { stdio: 'pipe' });
  } catch (e) {
    parses = false;
    parseErr = String(e.stderr || e).split('\n').filter(l => /SyntaxError|service-worker\.js:/.test(l))[0] || '';
  }
  ok(parses, 'service-worker.js parses' + (parses ? '' : ` -- ${parseErr}`));

  console.log('\n=== 2. Everything the worker promises to precache exists ===');
  const files = precacheList();
  ok(files.length > 200, `${files.length} files listed for precaching`);
  const absent = files.filter(f => f !== '' && !fs.existsSync(path.join(APP, f)));
  eq(absent, [], 'every listed file is on disk (one that is not fails the whole install)');
  const icons = files.filter(f => /^(icon-|favicon-|apple-touch)/.test(f));
  eq(icons.sort(), ['apple-touch-icon.png', 'favicon-16.png', 'favicon-32.png',
                    'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
    'and the icon set is among them, so the app keeps its icon offline');

  console.log('\n=== 3. The manifest and its icons agree with each other ===');
  const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.webmanifest'), 'utf8'));
  ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2,
    `${manifest.icons.length} icons declared`);
  const wrong = [];
  for (const ic of manifest.icons) {
    const p = path.join(APP, ic.src);
    if (!fs.existsSync(p)) { wrong.push(`${ic.src}: missing`); continue; }
    const size = pngSize(p);
    const [w, h] = ic.sizes.split('x').map(Number);
    if (!size || size.w !== w || size.h !== h) {
      wrong.push(`${ic.src}: declared ${ic.sizes}, actually ${size ? size.w + 'x' + size.h : 'not a PNG'}`);
    }
  }
  eq(wrong, [], 'every icon exists and is really the size the manifest claims');
  ok(manifest.icons.some(i => (i.purpose || '').includes('maskable')),
    'a maskable icon is offered, so Android does not crop the artwork badly');
  ok(manifest.icons.some(i => (i.purpose || 'any').includes('any')),
    'and a plain one, for everywhere that does not mask');

  console.log('\n=== 4. The page asks for icons that are actually there ===');
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const referenced = [...html.matchAll(/<link[^>]+rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)]
    .map(m => m[1]);
  ok(referenced.length >= 2, `${referenced.length} icon links in the document head`);
  eq(referenced.filter(r => !fs.existsSync(path.join(APP, r))), [],
    'each one resolves to a file that exists');
  ok(referenced.includes('apple-touch-icon.png'),
    'including an apple-touch-icon, which iOS uses instead of the manifest');

  const browser = await chromium.launch({ executablePath: EXEC });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const missing = [];
  page.on('response', r => { if (r.status() >= 400) missing.push(new URL(r.url()).pathname); });
  await page.goto(BASE);

  console.log('\n=== 5. The service worker actually installs and caches ===');
  // The real test. With the missing comma this rejects, and with a precache
  // entry that 404s the install fails -- neither of which is visible from the
  // page itself, which is why it went unnoticed for so long.
  const reg = await page.evaluate(async () => {
    // Deliberately NOT `await navigator.serviceWorker.ready`. When the install
    // fails -- which is the second thing this section is here to catch, since
    // cache.addAll() rejects atomically if any one file 404s -- `ready` never
    // resolves and never rejects, so awaiting it hangs the suite for ever
    // rather than failing it. (Found the hard way: the mutation harness sat on
    // this for ten minutes.) Watch the worker's own state instead, which
    // reaches 'redundant' on a failed install, and cap the whole thing.
    const deadline = (p, ms) => Promise.race([p, new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`no verdict within ${ms}ms`)), ms))]);
    try {
      const r = await deadline(navigator.serviceWorker.register('./service-worker.js'), 15000);
      const worker = r.installing || r.waiting || r.active;
      const settled = new Promise((resolve, reject) => {
        if (r.active) return resolve();
        if (!worker) return reject(new Error('registration has no worker attached'));
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated') resolve();
          if (worker.state === 'redundant') reject(new Error(
            'the worker went redundant, so its install failed -- most likely a '
            + 'precached file that 404s, which fails cache.addAll() as a whole'));
        });
      });
      await deadline(settled, 20000);
      return { ok: true, active: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });
  ok(reg.ok, 'register() resolves' + (reg.ok ? '' : ` -- ${reg.error}`));
  ok(reg.ok && reg.active, 'and the worker reaches "activated"');

  if (reg.ok) {
    const cache = await page.evaluate(async () => {
      const names = await caches.keys();
      const out = {};
      for (const n of names) out[n] = (await (await caches.open(n)).keys()).length;
      return out;
    });
    const name = Object.keys(cache)[0] || '(none)';
    ok(Object.keys(cache).length === 1, `exactly one cache is open: ${name}`);
    ok((cache[name] || 0) >= files.length,
      `it holds all ${files.length} precached files (${cache[name] || 0})`);
    // A stale cache name means returning users keep the old files for ever.
    ok(/^energytech-quiz-app-v\d+/.test(name),
      'and its name carries a version, so a new build replaces the old cache');
  }

  console.log('\n=== 6. The icons load, and are opaque or transparent as intended ===');
  // Read the actual pixels: the maskable and Apple icons must be FULLY opaque
  // (Android crops them to a circle, iOS paints unset pixels black), while the
  // plain ones keep their transparent corners.
  const alpha = await page.evaluate(async (names) => {
    const out = {};
    for (const n of names) {
      const img = new Image();
      img.src = n;
      try { await img.decode(); } catch { out[n] = { error: 'did not load' }; continue; }
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let min = 255;
      for (let i = 3; i < d.length; i += 4) if (d[i] < min) min = d[i];
      out[n] = { w: img.naturalWidth, h: img.naturalHeight, minAlpha: min };
    }
    return out;
  }, ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png',
      'favicon-32.png', 'favicon-16.png']);

  for (const [n, r] of Object.entries(alpha)) {
    ok(!r.error && r.w > 0, `${n} loads (${r.w}x${r.h})`);
  }
  eq(alpha['icon-maskable-512.png'].minAlpha, 255,
    'the maskable icon is fully opaque, so Android\'s circular crop shows no hole');
  eq(alpha['apple-touch-icon.png'].minAlpha, 255,
    'the Apple touch icon is fully opaque, so iOS draws no black corners');
  ok(alpha['icon-512.png'].minAlpha === 0,
    'while the plain icon keeps its transparent corners');

  console.log('\n=== 7. The logo is on screen, not just in the tab ===');
  const logo = await page.evaluate(() => {
    const el = document.querySelector('.app-header .app-logo');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { src: el.getAttribute('src'), alt: el.getAttribute('alt'),
             drawn: el.naturalWidth > 0, w: Math.round(r.width), h: Math.round(r.height) };
  });
  ok(logo, 'the header carries a logo');
  if (logo) {
    ok(logo.drawn, `and it renders (${logo.w}x${logo.h} on screen)`);
    ok(logo.w >= 30 && logo.w <= 60, 'at a sensible size for a header');
    eq(logo.alt, '', 'with empty alt text, since the h1 beside it already names the app');
  }
  eq(missing.filter(u => /icon|favicon|manifest/.test(u)), [], 'and nothing icon-related 404s');

  await browser.close();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})();
