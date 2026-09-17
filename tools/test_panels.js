/* The instructor page's cards: their order, and folding them away, in a real
 * browser against the REAL energytech-api backend (Express + Postgres) --
 * repointed for Phase 6 from the mocked-Apps-Script version this file used
 * to be. See test_roster.js's header for the shared mechanics (served from
 * public/ via src/app.js, seeded/asserted through TEST_DATABASE_URL, never
 * DATABASE_URL).
 *
 * The page had grown to nine cards with the two least-used ones (the backend
 * URL and the password change) sitting at the top, above the card an
 * instructor actually opens the app to use. So the order was changed, and
 * every card's heading now carries a triangle that folds it.
 *
 * The fiddly part, and the reason for the structural check in section 6: the
 * fold control is built AROUND each existing <h2>, in the h2's own position in
 * the DOM. "My sessions" keeps its heading inside #sessionsWorkspace, which
 * the app hides wholesale when a session report is opened. A tidier-looking
 * implementation that lifted every heading to the top of its card would leave
 * "My sessions" and its triangle stranded above an open report.
 *
 * This is a straight repoint, not a rewrite, except where the served page has
 * genuinely diverged from what this suite used to check: Phase 5 dropped the
 * whole "Instructor connection setup" card (energytech-api/public/index.html
 * has no #connectionPanel, no #webAppUrl, no #saveWebAppUrlBtn at all -- a
 * same-origin server has no Apps Script URL to configure), so the served page
 * has seven foldable cards, not eight, and the old section 7 -- driving the
 * connection card's URL field and Save button -- has no field left to drive
 * and is removed rather than repointed. It was the OTHER "least-used" card
 * (see the paragraph above) that started folded; with its sibling gone,
 * passwordPanel is what is left, and what public/app.js's own comment says
 * takes over the role. Do not add a connection-card section back here --
 * that card is gone from the served app on purpose, not by accident. */

const path = require('path');
const { chromium } = require('playwright');

const ENERGYTECH_API_ROOT = path.join(__dirname, '..', '..', 'energytech-api');
require('dotenv').config({ path: path.join(ENERGYTECH_API_ROOT, '.env') });

const {
  pool, resetDb, insertInstructor,
} = require(path.join(ENERGYTECH_API_ROOT, 'tests', 'helpers', 'db'));
const { hashPasswordForStorage } = require(path.join(ENERGYTECH_API_ROOT, 'src', 'lib', 'passwords'));
const app = require(path.join(ENERGYTECH_API_ROOT, 'src', 'app'));

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const ORDER = ['setupPanel', 'resultPanel', 'dashboardPanel', 'sessionsPanel',
               'intakePanelSection', 'adminPanelSection', 'passwordPanel'];

const cardState = page => page.evaluate(() =>
  [...document.querySelectorAll('#teacherInterface section.panel')]
    .filter(s => s.querySelector('.panel-toggle'))
    .map(s => ({
      id: s.id,
      title: s.querySelector('h2').textContent.trim(),
      collapsed: s.classList.contains('is-collapsed'),
      ariaExpanded: s.querySelector('.panel-toggle').getAttribute('aria-expanded'),
      bodyHidden: document.getElementById(s.id + 'Body').hidden
    })));

(async () => {
  await resetDb();
  const pw = await hashPasswordForStorage('x');
  await insertInstructor({
    username: 'adnen', displayName: 'Adnane Khalifa', role: 'admin', status: 'approved',
    passwordHash: pw.passwordHash, passwordSalt: pw.passwordSalt, passwordAlgo: pw.passwordAlgo,
  });

  const server = app.listen(0);
  const { port } = server.address();
  const BASE = `http://127.0.0.1:${port}/index.html`;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const errs = [];

  async function signIn() {
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await page.goto(BASE);
    await page.click('#teacherModeBtn');
    await page.fill('#teacherLoginUsername', 'adnen');
    await page.fill('#teacherLoginPassword', 'x');
    await page.click('#teacherLoginBtn');
    await page.waitForSelector('#teacherInterface:not([hidden])');
    await page.waitForTimeout(400);
    return page;
  }

  const page = await signIn();

  console.log('\n=== 1. The cards are in the order the instructor asked for ===');
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('#teacherInterface section.panel')].map(s => s.id || '(account bar)'));
  eq(order.filter(id => id !== '(account bar)'), ORDER,
    'daily work first, roster and account admin next, personal settings last');
  eq(order[0], '(account bar)', 'and the "logged in as" bar stays above them all');
  const titles = (await cardState(page)).map(c => c.title);
  eq(titles[0], 'Create quiz session', 'so the first thing on the page is the reason to open the app');
  eq(titles[titles.length - 1], 'Change my password', 'and changing your password is the last thing');

  console.log('\n=== 2. Every card can be folded; the account bar is not a card ===');
  const state = await cardState(page);
  eq(state.length, 7, 'seven cards carry a fold triangle');
  const barHasToggle = await page.evaluate(() =>
    !!document.querySelector('#teacherInterface .account-bar-panel .panel-toggle'));
  ok(!barHasToggle, 'the account bar has no heading and so gets no triangle');
  const wired = await page.evaluate(() =>
    [...document.querySelectorAll('#teacherInterface .panel-toggle')].every(t =>
      t.getAttribute('aria-controls')
      && document.getElementById(t.getAttribute('aria-controls'))
      && t.hasAttribute('aria-expanded')
      && (t.getAttribute('aria-label') || '').length > 0));
  ok(wired, 'each triangle names the region it controls, for a screen reader');

  console.log('\n=== 3. Only the password card starts folded ===');
  // The connection-setup card this used to be -- the URL was baked into the
  // build, so it was out of the way until the day the Apps Script got
  // redeployed -- is gone from the served page (see this file's header).
  // passwordPanel is the other "least-used" card the fold feature was built
  // for, and public/app.js's own PANELS_COLLAPSED_BY_DEFAULT comment says
  // explicitly that it is what took over the role.
  const folded = state.filter(c => c.collapsed).map(c => c.id);
  eq(folded, ['passwordPanel'],
    'changing your password is rare enough to start out of the way');
  ok(state.filter(c => !c.collapsed).every(c => c.ariaExpanded === 'true' && !c.bodyHidden),
    'and every other card is open, with aria and the body agreeing');
  const pwd = state.find(c => c.id === 'passwordPanel');
  ok(pwd.ariaExpanded === 'false' && pwd.bodyHidden,
    'the folded one reports itself folded, and its body really is hidden');

  console.log('\n=== 4. Folding and unfolding ===');
  await page.click('#setupPanel .panel-toggle');
  await page.waitForTimeout(150);
  let s = (await cardState(page)).find(c => c.id === 'setupPanel');
  ok(s.collapsed && s.bodyHidden && s.ariaExpanded === 'false', 'clicking the triangle folds the card');
  const treeGone = await page.evaluate(() => {
    const el = document.getElementById('questionTree');
    return !el || !el.offsetParent;                        // inside the hidden body
  });
  ok(treeGone, 'and its contents really leave the page, rather than just looking smaller');
  await page.click('#setupPanel .panel-toggle');
  await page.waitForTimeout(150);
  s = (await cardState(page)).find(c => c.id === 'setupPanel');
  ok(!s.collapsed && !s.bodyHidden && s.ariaExpanded === 'true', 'clicking again brings it back');

  // The triangle is a small target on a tablet, so the heading works too.
  await page.click('#dashboardPanel h2');
  await page.waitForTimeout(150);
  ok((await cardState(page)).find(c => c.id === 'dashboardPanel').collapsed,
    'clicking the heading itself folds the card as well');
  await page.click('#dashboardPanel h2');
  await page.waitForTimeout(150);
  ok(!(await cardState(page)).find(c => c.id === 'dashboardPanel').collapsed, 'and unfolds it');

  console.log('\n=== 5. What is folded is still folded next time ===');
  await page.click('#sessionsPanel .panel-toggle');      // fold one
  await page.click('#passwordPanel .panel-toggle');      // and unfold the one that starts folded
  await page.waitForTimeout(200);
  const stored = await page.evaluate(() => localStorage.getItem('energytechPanelCollapsed_v1'));
  ok(stored && stored.includes('sessionsPanel'), `the choice is written down (${stored})`);
  // Sign in again in the same browser profile, as if returning the next day.
  await page.evaluate(() => {
    localStorage.removeItem('energytechAuthToken_v1');
    localStorage.removeItem('energytechAuthUser_v1');
  });
  await page.close();
  const page2 = await signIn();
  const back = await cardState(page2);
  ok(back.find(c => c.id === 'sessionsPanel').collapsed, 'a card folded last time comes back folded');
  ok(!back.find(c => c.id === 'passwordPanel').collapsed,
    'and one deliberately unfolded stays unfolded -- the default does not reassert itself');

  console.log('\n=== 6. "My sessions" keeps its heading where the app expects it ===');
  // The app hides #sessionsWorkspace wholesale to show a session report. If the
  // heading (and now the fold control) were lifted out of it, "My sessions"
  // would sit above an open report with nothing under it.
  const nested = await page2.evaluate(() => {
    const head = document.querySelector('#sessionsPanel .panel-head');
    const ws = document.getElementById('sessionsWorkspace');
    return { insideWorkspace: !!(ws && head && ws.contains(head)),
             reportIsSibling: !!(ws && ws.parentElement.querySelector(':scope > #sessionReportView')) };
  });
  ok(nested.insideWorkspace, 'its heading and triangle live inside #sessionsWorkspace, not above it');
  ok(nested.reportIsSibling, 'and the report view is still a sibling of that workspace');

  console.log('\n=== 7. No page errors ===');
  eq(errs, [], 'no console or page errors');

  await browser.close();
  server.close();
  await pool.end();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
