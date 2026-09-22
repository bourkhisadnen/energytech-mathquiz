#!/usr/bin/env node
/* Manual, one-off check for the app retirement (claude/cutover-runbook.md) --
 * NOT part of the mutation battery. Deliberately not named test_*.js: no mutant
 * in tools/mutate_backend.js names it as a suite, and it should stay that way --
 * it drives a Playwright browser against two REAL git refs of this repo (MAIN_REF
 * / NOTICE_REF below), not against the served app.js the mutation harness
 * mutates, so a mutant would never make it fail meaningfully.
 *
 * Simulates a tablet that already has the OLD app installed (service worker
 * registered, ~7.5 MB cached) meeting the retirement, then meeting Sunday's
 * rollback -- all within one continuous browser session, so the same Cache
 * Storage/SW registration carries across every reload exactly as it would on a
 * real device. Serves from a plain local folder (never touches Railway, GitHub
 * Pages, or Apps Script) that is populated from two real commits of this
 * repository via `git archive` and swapped between phases.
 *
 * Usage:  node tools/check-notice-rollback.js [main-ref] [notice-ref]
 * Defaults to comparing main against the branch that carries the retirement
 * notice; pass two refs/SHAs to check any other pair (e.g. two tags, once the
 * notice has actually been merged and main IS the notice).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MQ = path.join(__dirname, '..'); // this script lives in tools/, one level below the repo root
const MAIN_REF = process.argv[2] || 'main';
const NOTICE_REF = process.argv[3] || 'retire-old-app';
const { chromium } = require(path.join(MQ, 'node_modules', 'playwright'));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

let currentRoot = null; // swapped between phases
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(currentRoot, p);
  if (!file.startsWith(currentRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('nope');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

function exportTree(ref, dir) {
  fs.mkdirSync(dir, { recursive: true });
  // git archive: exactly what that ref's working tree looks like, without
  // touching the actual checked-out branch or working directory at all.
  // Extracted with PowerShell's Expand-Archive rather than tar.exe: Windows'
  // bundled bsdtar reads an absolute "C:\Users\..." path as a user@host:path
  // remote spec (the drive letter before the colon) and tries to open an SSH
  // connection to a host named "C" instead of the local file -- --force-local
  // did not fully suppress it. PowerShell has no such ambiguity.
  const zipPath = path.join(dir, '..', `${path.basename(dir)}.zip`);
  const archive = execFileSync('git', ['-C', MQ, 'archive', '--format=zip', ref], { maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync(zipPath, archive);
  execFileSync('powershell.exe', ['-NoProfile', '-Command',
    `Expand-Archive -Path '${zipPath}' -DestinationPath '${dir}' -Force`]);
  fs.unlinkSync(zipPath);
  return dir;
}

// Waits for the cache-name landscape to STABILISE on exactly one key containing
// `wantSubstring`, with a STABLE (unchanging for two consecutive reads) entry
// count -- not merely "some worker is active", which is trivially already true
// once ANY version has ever activated on this origin (the pitfall: re-registering
// the same scriptURL after swapping the served bytes can resolve register()
// against the still-active PREVIOUS worker before the browser's own update check
// has even fetched the new script, so "reg.active.state === 'activated'" proves
// nothing about which version is active). Robust against that by polling the
// actual observable end state (Cache Storage) instead of the registration
// object's own racy interim states.
async function waitForCacheStable(page, wantSubstring, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  let stableSince = null;
  while (Date.now() < deadline) {
    const sizes = await page.evaluate(async () => {
      const names = await caches.keys();
      const out = {};
      for (const n of names) out[n] = (await (await caches.open(n)).keys()).length;
      return out;
    });
    const keys = Object.keys(sizes);
    const matches = keys.length === 1 && keys[0].includes(wantSubstring) && sizes[keys[0]] > 0;
    const snapshot = JSON.stringify(sizes);
    if (matches) {
      if (snapshot === last) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince > 400) return sizes; // unchanged across two polls: settled
      } else { stableSince = null; }
    }
    last = snapshot;
    await page.waitForTimeout(200);
  }
  // Timed out: return the last observed state so the caller's own assertions
  // report exactly what was wrong, rather than this helper hiding it.
  return page.evaluate(async () => {
    const names = await caches.keys();
    const out = {};
    for (const n of names) out[n] = (await (await caches.open(n)).keys()).length;
    return out;
  });
}

async function registerAndWait(page, wantSubstring) {
  await page.evaluate(() => navigator.serviceWorker.register('./service-worker.js').then((r) => r.update()));
  const caches_ = await waitForCacheStable(page, wantSubstring);
  const active = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration('./');
    return reg && reg.active && reg.active.state;
  });
  return { active, caches: caches_ };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tablet_test_'));
  const oldTree = exportTree(MAIN_REF, path.join(tmp, 'old'));
  const notice = exportTree(NOTICE_REF, path.join(tmp, 'notice'));

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).split('\n')[0]));

  console.log('===== Phase 1: a tablet with the old app already installed =====');
  currentRoot = oldTree;
  await page.goto(base + '/', { waitUntil: 'load' });
  const t1 = await page.title();
  const sw1 = await registerAndWait(page, 'v59');
  const roleGridVisible = await page.locator('#landingPanel').isVisible().catch(() => false);
  const oldCacheKey = Object.keys(sw1.caches)[0];
  console.log('title:', t1);
  console.log('service worker:', sw1.active, '| cache key:', oldCacheKey, '| files cached:', sw1.caches[oldCacheKey]);
  console.log('the app UI is on screen ("Choose your role" landing panel):', roleGridVisible);

  console.log('\n===== Phase 2: the retirement ships; the tablet comes online and reloads =====');
  currentRoot = notice;
  // A real tablet does not re-register -- app-shell files are network-first
  // (service-worker.js:272-284), so the plain reload below already serves the
  // new index.html; the SW registration's own background update follows.
  await page.reload({ waitUntil: 'load' });
  const t2 = await page.title();
  const linkHref = await page.locator('#newAddressLink').getAttribute('href').catch(() => null);
  const fineprintText = await page.locator('.fineprint').innerText().catch(() => '');
  const sw2 = await registerAndWait(page, 'v60');
  console.log('title:', t2);
  console.log('link href:', linkHref);
  console.log('caches after the swap:', JSON.stringify(sw2.caches));
  console.log('old cache (' + oldCacheKey + ') gone:', !(oldCacheKey in sw2.caches));
  console.log('waiting for the redirect (meta refresh / JS timer)...');
  await page.waitForURL((url) => url.origin !== new URL(base).origin || url.href.includes('railway.app'), { timeout: 8000 }).catch(() => null);
  console.log('page navigated to:', page.url(), '(a real tablet would now be off this origin entirely -- this stays on it only because 127.0.0.1 is not really railway.app)');

  console.log('\n===== Phase 3: Sunday\'s rollback -- revert to the old build, tablet reloads again =====');
  currentRoot = oldTree;
  await page.goto(base + '/', { waitUntil: 'load' });
  const t3 = await page.title();
  const sw3 = await registerAndWait(page, 'v59');
  const roleGridBack = await page.locator('#landingPanel').isVisible().catch(() => false);
  const canClickTrainee = await page.locator('#studentModeBtn').isVisible().catch(() => false);
  console.log('title:', t3);
  console.log('service worker:', sw3.active, '| caches:', JSON.stringify(sw3.caches));
  console.log('the app UI is back ("Choose your role" landing panel):', roleGridBack, '| Trainee button present:', canClickTrainee);

  await browser.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  const notice2Ok = sw2.active === 'activated' && Object.keys(sw2.caches).length === 1
    && Object.keys(sw2.caches)[0].includes('v60') && sw2.caches[Object.keys(sw2.caches)[0]] === 7
    && !(oldCacheKey in sw2.caches);
  const back3Ok = sw3.active === 'activated' && Object.keys(sw3.caches).length === 1
    && Object.keys(sw3.caches)[0].includes('v59') && sw3.caches[Object.keys(sw3.caches)[0]] === 239;
  const ok = sw1.active === 'activated' && sw1.caches[oldCacheKey] === 239 && roleGridVisible
    && /moved/i.test(t2) && linkHref === 'https://energytech-api-production.up.railway.app/'
    && /energytech-api-production\.up\.railway\.app/.test(fineprintText) // the address as plain text too,
    // for anyone who wants to write it down or read it aloud rather than click
    && notice2Ok
    && t3 === t1 && back3Ok && roleGridBack && canClickTrainee
    && errors.length === 0;
  console.log('\nphase 2 cache exactly {v60: 7}, old cache gone:', notice2Ok);
  console.log('phase 3 cache exactly {v59: 239} (a full fresh install, not leftover v60):', back3Ok);
  console.log('page errors across all three phases:', errors.length ? errors.join(' | ') : 'none');
  console.log(ok ? '\nRESULT: notice replaces the old cached app; rollback genuinely restores it' : '\nRESULT: PROBLEM');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('test error:', e.stack || e.message); process.exit(2); });
