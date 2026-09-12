/* The instructor page's cards: their order, and folding them away.
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
 */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8901/index.html';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const ORDER = ['setupPanel', 'resultPanel', 'dashboardPanel', 'sessionsPanel',
               'intakePanelSection', 'adminPanelSection', 'passwordPanel', 'connectionPanel'];

function mock(page) {
  return page.route(/script\.google\.com/, r => {
    const q = Object.fromEntries(new URL(r.request().url()).searchParams);
    const d = q.action === 'auth_login'
      ? { ok: true, token: 'T', username: 'adnen', displayName: 'Adnane Khalifa', role: 'admin' }
      : q.action === 'roster_list' ? { ok: true, intakes: [], groups: [] }
      : { ok: true, message: 'mock' };
    return r.fulfill({ status: 200, contentType: 'application/javascript',
                       body: `${q.callback}(${JSON.stringify(d)});` });
  });
}

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
  const browser = await chromium.launch({ executablePath: EXEC });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const errs = [];

  async function signIn() {
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await mock(page);
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
  eq(titles[titles.length - 1], 'Instructor connection setup', 'and the backend URL is the last thing');

  console.log('\n=== 2. Every card can be folded; the account bar is not a card ===');
  const state = await cardState(page);
  eq(state.length, 8, 'eight cards carry a fold triangle');
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

  console.log('\n=== 3. Only the connection setup starts folded ===');
  const folded = state.filter(c => c.collapsed).map(c => c.id);
  eq(folded, ['connectionPanel'],
    'the URL is baked into the build, so that card is out of the way until it is needed');
  ok(state.filter(c => !c.collapsed).every(c => c.ariaExpanded === 'true' && !c.bodyHidden),
    'and every other card is open, with aria and the body agreeing');
  const conn = state.find(c => c.id === 'connectionPanel');
  ok(conn.ariaExpanded === 'false' && conn.bodyHidden,
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
  await page.click('#sessionsPanel .panel-toggle');       // fold one
  await page.click('#connectionPanel .panel-toggle');     // and unfold the one that starts folded
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
  ok(!back.find(c => c.id === 'connectionPanel').collapsed,
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

  console.log('\n=== 7. The connection card still works when opened ===');
  const connWorks = await page2.evaluate(() => {
    const panel = document.getElementById('connectionPanel');
    if (panel.classList.contains('is-collapsed')) panel.querySelector('.panel-toggle').click();
    const input = document.getElementById('webAppUrl');
    return { hasInput: !!input, hasValue: !!(input && input.value),
             hasSave: !!document.getElementById('saveWebAppUrlBtn'),
             hasStatus: !!document.getElementById('onlineStatus') };
  });
  ok(connWorks.hasInput && connWorks.hasSave && connWorks.hasStatus,
    'the URL field, its Save button and the status line all survived the move');
  ok(connWorks.hasValue, 'and the field is still populated with the embedded URL');

  console.log('\n=== 8. No page errors ===');
  eq(errs, [], 'no console or page errors');

  await browser.close();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})();
