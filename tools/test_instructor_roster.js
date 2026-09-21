/* The roster as an instructor sees it, and the admin control that decides.
 *
 * The rules live in the backend -- energytech-api's tests/roster.test.js proves
 * them against Postgres (test_backend.js §14 did, against Code.gs, before it
 * retired). This suite is about the page: that an instructor is SHOWN the
 * groups assigned to them and nothing else, that the controls they must not
 * use are not drawn, and that the admin can hand a group over and take it back.
 *
 * One check here is security-relevant rather than cosmetic. The search box
 * used to build its index by asking for every trainee in one unscoped call.
 * The backend now refuses that from a non-admin, so the page has to ask group
 * by group instead; §5 pins that it never makes the unscoped call, because a
 * page that did would look fine right up until someone relaxed the backend.
 *
 * Repointed for Phase 6, like the other browser suites: it now drives the app
 * served by energytech-api's src/app.js against the real backend on
 * TEST_DATABASE_URL (see test_roster.js's header for the shared mechanics). It
 * used to load http://127.0.0.1:8901/index.html in a Linux chromium path and
 * answer JSONP calls from an in-memory mock, so on this machine it could not
 * even start -- and mutate_backend.js counted "could not start" as a caught
 * mutation (claude/33-harness-counted-a-dead-suite-as-caught.md in
 * energytech-api).
 *
 * What changed, and only this: the mock backend became seeded Postgres rows,
 * the JSONP sign-in became the real login form, and "what the page asked for"
 * is read off the wire instead of out of the mock. Every UI step and selector
 * is as it was. Three things are deliberately stronger than the mock allowed:
 * section 4 also checks the backend recorded the assignment, not just that the
 * page sent it; section 6 checks the password the page shows really opens that
 * trainee's account (the mock always said ABCD-2345); and the fixed sleeps are
 * waits on the condition, because Postgres does not answer in the same tick.
 */
const path = require('path');
const { chromium } = require('playwright');

const ENERGYTECH_API_ROOT = path.join(__dirname, '..', '..', 'energytech-api');
require('dotenv').config({ path: path.join(ENERGYTECH_API_ROOT, '.env') });

// Must be required before src/app, so the app under test and these fixtures
// land on the same (test) database -- see tests/helpers/db.js's own comment.
const {
  pool, resetDb, insertIntake, insertGroup, insertTrainee, insertInstructor, assignGroup,
} = require(path.join(ENERGYTECH_API_ROOT, 'tests', 'helpers', 'db'));
const { hashPasswordForStorage, verifyPassword } = require(path.join(ENERGYTECH_API_ROOT, 'src', 'lib', 'passwords'));
const app = require(path.join(ENERGYTECH_API_ROOT, 'src', 'app'));

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

/* The three groups the mock's roster held. Each gets two trainees -- one with a
 * login, one without -- which is what the mock's trainee_list returned for
 * whichever group was asked about, and what the assertions below count. The
 * mock reported 24/19/21 trainees per group; nothing here reads those numbers,
 * so the real rows are only as many as the checks need. Ids differ per group
 * because the real backend, unlike the mock, keeps energytech_id unique. */
const GROUPS = [
  { intake: 'JAN26', name: 'G1', trainees: [['ET1001', 'Ahmed Al-Rashid', true], ['ET1002', 'Bilal Hakim', false]] },
  { intake: 'JAN26', name: 'G2', trainees: [['ET2001', 'Karim Saleh', true], ['ET2002', 'Layla Omar', false]] },
  { intake: 'MAR26', name: 'G1', trainees: [['ET3001', 'Nadia Farouk', true], ['ET3002', 'Omar Haddad', false]] },
];

/* Rebuilds the database for one scenario: the same instructors the mock
 * hardcoded (adnen the admin, sara the instructor), the three groups, and
 * sara's assignments. The real backend filters where Code.gs filtered, in SQL,
 * so a page that filtered in the browser instead would still show nothing here
 * that the backend did not send -- the mock had to promise that; Postgres
 * simply does it. */
async function seed(role, assignedAtStart) {
  await resetDb();
  const pw = await hashPasswordForStorage('x');
  const cred = { passwordHash: pw.passwordHash, passwordSalt: pw.passwordSalt, passwordAlgo: pw.passwordAlgo };
  await insertInstructor({ username: 'adnen', displayName: 'Adnane Khalifa', role: 'admin', status: 'approved', ...cred });
  await insertInstructor({ username: 'sara', displayName: 'Sara Nasser', role: 'instructor', status: 'approved', ...cred });
  const intakes = {};
  const groupIds = {};
  for (const g of GROUPS) {
    if (!intakes[g.intake]) intakes[g.intake] = await insertIntake(g.intake);
    const gid = await insertGroup(intakes[g.intake], g.name);
    groupIds[g.intake + '/' + g.name] = gid;
    for (const [id, name, active] of g.trainees) {
      await insertTrainee({
        energytechId: id, name, intakeId: intakes[g.intake], groupId: gid,
        accountStatus: active ? 'active' : 'none', ...(active ? cred : {}),
      });
    }
  }
  for (const key of assignedAtStart) await assignGroup('sara', groupIds[key]);
  return { role };
}

const assignedNow = async () => (await pool.query(
  `SELECT ik.label || '/' || g.name AS key
     FROM instructor_group_assignments a
     JOIN groups g ON g.id = a.group_id JOIN intakes ik ON ik.id = g.intake_id
    WHERE a.username = 'sara' ORDER BY 1`)).rows.map(r => r.key);

/* Signs in through the real login form and hands back the page plus a log of
 * every call it makes to /api/call. The mock's `state.calls` was the record of
 * what the page asked for; a request listener is the same record, taken from
 * the wire instead of from inside a fake. */
async function signIn(ctx, state, who) {
  const page = await ctx.newPage();
  state.calls = [];
  state.errs = state.errs || [];
  page.on('pageerror', e => state.errs.push(String(e)));
  page.on('request', req => {
    if (req.method() !== 'POST' || !req.url().endsWith('/api/call')) return;
    try { state.calls.push(JSON.parse(req.postData() || '{}')); } catch { /* not JSON */ }
  });
  await page.goto(state.BASE);
  await page.click('#teacherModeBtn');
  await page.fill('#teacherLoginUsername', who);
  await page.fill('#teacherLoginPassword', 'x');
  await page.click('#teacherLoginBtn');
  await page.waitForSelector('#teacherInterface:not([hidden])');
  // The roster card is loaded once its intake pane says anything at all, be it
  // the list or "no groups are assigned to you".
  await page.waitForFunction(() => document.getElementById('intakeList').textContent.trim().length > 0,
    null, { timeout: CEILING });
  return page;
}

/* The mock answered in the same tick, so this file used to sleep a fixed 300-900ms
 * after each click and read the page. Postgres over the network does not answer
 * on a schedule, and a sleep that is long enough today is a flaky failure next
 * month (test_roster.js polls for the same reason). So every wait below is on
 * the thing being waited for, with a generous ceiling -- a real failure still
 * fails, it just takes the ceiling to say so. */
const CEILING = 15000;
async function until(fn, what) {
  const start = Date.now();
  while (Date.now() - start < CEILING) {
    if (await fn()) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(`  (gave up waiting for ${what} after ${CEILING}ms)`);
  return false;
}

const controls = page => page.evaluate(() => ({
  cardShown: !document.getElementById('intakePanelSection').hidden,
  addIntake: !document.getElementById('showAddIntake').hidden,
  addGroup: !document.getElementById('showAddGroup').hidden,
  addTrainee: !document.getElementById('showAddTrainee').hidden,
  importCsv: !document.getElementById('importCsvBtn').hidden,
  edits: document.querySelectorAll('.trainee-edit').length,
  deletes: document.querySelectorAll('.trainee-delete').length,
  resets: document.querySelectorAll('.trainee-reset-pw').length,
  names: document.querySelectorAll('.open-profile').length,
  ticks: document.querySelectorAll('.pick-trainee').length,
  headerTicks: document.querySelectorAll('#traineeList th.pick').length
}));

const drillIn = async page => {
  await page.click('#intakeList .pane-item');
  await page.waitForSelector('#groupList .pane-item', { timeout: CEILING });
  await page.click('#groupList .pane-item');
  await page.waitForSelector('#traineeList .roster-table tbody tr', { timeout: CEILING });
};

(async () => {
  const server = app.listen(0);
  const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
  const errs = [];
  const browser = await chromium.launch();

  console.log('\n=== 1. An instructor with a group assigned sees it, read-only ===');
  {
    const state = await seed('instructor', ['JAN26/G1']); state.BASE = BASE; state.errs = errs;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await signIn(ctx, state, 'sara');
    ok((await controls(page)).cardShown, 'the roster card is shown to a non-admin at all -- it used to be hidden');
    const panes = await page.evaluate(() => ({
      intakes: [...document.querySelectorAll('#intakeList .pane-item-name')].map(e => e.textContent.trim()),
      groups: [...document.querySelectorAll('#groupList .pane-item-name')].map(e => e.textContent.trim())
    }));
    eq(panes.intakes, ['JAN26'], 'only the intake her group sits in -- MAR26 is not listed');
    await drillIn(page);
    const c = await controls(page);
    eq([c.addIntake, c.addGroup, c.addTrainee, c.importCsv], [false, false, false, false],
      'nothing that creates anything is offered');
    eq([c.edits, c.deletes, c.ticks, c.headerTicks], [0, 0, 0, 0],
      'no edit, no delete, and no tick boxes -- including the one in the header, which would leave the row misaligned');
    ok(c.names === 2, 'both names are still links, which is how a record is opened');
    ok(c.resets === 1, 'and the one trainee with a login can have their password reset');
    const hint = await page.evaluate(() => document.getElementById('rosterHint').textContent);
    ok(/assigned to you/i.test(hint) && /only an admin/i.test(hint),
      'the card says whose groups these are and who may change them');
    await ctx.close();
  }

  console.log('\n=== 2. An instructor with nothing assigned ===');
  {
    const state = await seed('instructor', []); state.BASE = BASE; state.errs = errs;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await signIn(ctx, state, 'sara');
    const c = await controls(page);
    ok(c.cardShown, 'still sees the card rather than a missing feature');
    const empty = await page.evaluate(() => document.getElementById('intakeList').textContent);
    ok(/no groups are assigned to you/i.test(empty),
      'and is told why it is empty, and who can fix it');
    ok(!/\+ New/.test(empty), 'not invited to create an intake she is not allowed to create');
    await ctx.close();
  }

  console.log('\n=== 3. The admin still has the whole roster ===');
  {
    const state = await seed('admin', []); state.BASE = BASE; state.errs = errs;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await signIn(ctx, state, 'adnen');
    const panes = await page.evaluate(() =>
      [...document.querySelectorAll('#intakeList .pane-item-name')].map(e => e.textContent.trim()));
    eq(panes, ['JAN26', 'MAR26'], 'every intake');
    await drillIn(page);
    const c = await controls(page);
    eq([c.addIntake, c.addGroup, c.addTrainee, c.importCsv], [true, true, true, true], 'all the creating controls');
    ok(c.edits === 2 && c.deletes === 2 && c.ticks === 2 && c.headerTicks === 1,
      'edit, delete and the tick boxes on every row, with the select-all in the header');
    // The actions column is meant to shrink to its buttons. It did not: making
    // the cell a flex container defeated `width: 1%` and the buttons spilled
    // over the account badge. Long-standing, and invisible until a group had
    // trainees in it.
    const fits = await page.evaluate(() => {
      const td = document.querySelector('#traineeList tbody tr .row-actions');
      const wanted = [...td.querySelectorAll('button')]
        .reduce((a, b) => a + b.getBoundingClientRect().width, 0);
      return td.getBoundingClientRect().width >= wanted;
    });
    ok(fits, 'and the row actions fit inside their own column instead of over the badge');
    await ctx.close();
  }

  console.log('\n=== 4. The admin hands a group over, and takes it back ===');
  {
    const state = await seed('admin', []); state.BASE = BASE; state.errs = errs;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await signIn(ctx, state, 'adnen');
    await page.click('#loadInstructorAccountsBtn');
    await page.waitForSelector('#instructorAccountsOutput tr .covers-cell', { timeout: CEILING });
    const before = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#instructorAccountsOutput tr')];
      const sara = rows.find(r => r.textContent.includes('sara'));
      const admin = rows.find(r => r.textContent.includes('adnen'));
      return { sara: sara.querySelector('.covers-cell').textContent.trim(),
               admin: admin.querySelector('.covers-cell').textContent.trim(),
               adminHasButton: !!admin.querySelector('.account-groups-btn') };
    });
    ok(/no groups yet/i.test(before.sara), 'sara covers nothing to begin with');
    ok(/every group/i.test(before.admin), 'the admin row says they already see everything');
    ok(!before.adminHasButton, 'and offers no control to assign an admin groups they would not use');

    await page.click('.account-groups-btn');
    await page.waitForSelector('.covers-box', { timeout: CEILING });
    const offered = await page.evaluate(() =>
      [...document.querySelectorAll('.covers-box')].map(b => b.value));
    eq(offered, ['JAN26/G1', 'JAN26/G2', 'MAR26/G1'], 'the editor offers every group in the centre');
    await page.check('.covers-box[value="JAN26/G1"]');
    await page.check('.covers-box[value="MAR26/G1"]');
    await page.click('.save-groups');
    await until(async () => (await assignedNow()).length === 2, 'the two groups to be recorded');
    const sent = state.calls.filter(c => c.action === 'admin_set_instructor_groups').pop();
    eq(sent.groups, 'JAN26/G1;MAR26/G1', 'the two ticked groups are sent, as one string');
    eq(sent.username, 'sara', 'for the right instructor');
    eq(await assignedNow(), ['JAN26/G1', 'MAR26/G1'], 'and the backend really recorded both -- not just the request');
    // The backend answers, THEN the row redraws -- the database can hold the
    // change a moment before the page shows it (this read raced that gap and
    // came back empty on a mutation run). Wait for the redraw; the editor is
    // only reachable again once it has happened.
    await page.waitForFunction(() => [...document.querySelectorAll('#instructorAccountsOutput tr')]
      .some(r => r.textContent.includes('sara') && r.querySelector('.covers-chip')), null, { timeout: CEILING })
      .catch(() => { /* the check below reports it */ });
    const after = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#instructorAccountsOutput tr')]
        .find(r => r.textContent.includes('sara'));
      return [...row.querySelectorAll('.covers-chip')].map(c => c.textContent.trim());
    });
    eq(after, ['JAN26/G1', 'MAR26/G1'], 'and the row now shows what she covers');

    await page.click('.account-groups-btn');
    await page.waitForSelector('.covers-box', { timeout: CEILING });
    await page.uncheck('.covers-box[value="MAR26/G1"]');
    await page.uncheck('.covers-box[value="JAN26/G1"]');
    await page.click('.save-groups');
    await until(async () => (await assignedNow()).length === 0, 'her cover to end');
    eq(state.calls.filter(c => c.action === 'admin_set_instructor_groups').pop().groups, '',
      'unticking everything sends an empty list, which is how cover ends');
    eq(await assignedNow(), [], 'and the backend really ends her cover');
    await ctx.close();
  }

  console.log('\n=== 5. The search never asks for the whole centre ===');
  {
    const state = await seed('instructor', ['JAN26/G1', 'MAR26/G1']); state.BASE = BASE; state.errs = errs;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await signIn(ctx, state, 'sara');
    await page.fill('#rosterSearch', 'Ahmed');
    // The index is built one group at a time, so wait for both of hers to be
    // asked about (and for the answer to reach the page) rather than for a
    // fixed while. If the page never asks, this runs to the ceiling and the
    // checks below fail as they should.
    await until(async () => {
      const asked = new Set(state.calls.filter(c => c.action === 'trainee_list').map(c => `${c.intake}/${c.group}`));
      return asked.has('JAN26/G1') && asked.has('MAR26/G1')
        && /Ahmed Al-Rashid/.test(await page.evaluate(() => document.getElementById('traineeList').textContent));
    }, 'the search index to be built');
    const listCalls = state.calls.filter(c => c.action === 'trainee_list');
    const unscoped = listCalls.filter(c => !c.intake || !c.group);
    eq(unscoped.length, 0, 'not one unscoped trainee_list -- the backend would refuse it, and the page must not rely on that');
    const asked = listCalls.map(c => `${c.intake}/${c.group}`);
    ok(asked.includes('JAN26/G1') && asked.includes('MAR26/G1'),
      `the index is built from her own groups instead (${[...new Set(asked)].join(', ')})`);
    const hits = await page.evaluate(() => document.getElementById('traineeList').textContent);
    ok(/Ahmed Al-Rashid/.test(hits), 'and the search still finds a trainee');
    await ctx.close();
  }

  console.log('\n=== 6. Resetting a password is still offered to the instructor ===');
  {
    const state = await seed('instructor', ['JAN26/G1']); state.BASE = BASE; state.errs = errs;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await signIn(ctx, state, 'sara');
    await drillIn(page);
    page.once('dialog', d => d.accept());
    await page.click('.trainee-reset-pw');
    await page.waitForFunction(() => /\b[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}\b/.test(document.body.textContent),
      null, { timeout: CEILING }).catch(() => { /* the check below reports it */ });
    const call = state.calls.filter(c => c.action === 'admin_reset_trainee_password').pop();
    ok(call && call.energytechId === 'ET1001', 'the reset reaches the backend for the right trainee');
    // The mock always answered ABCD-2345. The real backend makes up a new
    // password each time, so the check is stronger, not weaker: what the page
    // shows must be a temporary password, and must be the one that now opens
    // that trainee's account.
    const shown = await page.evaluate(() => document.body.textContent);
    const shownPw = (shown.match(/\b[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}\b/) || [])[0];
    ok(!!shownPw, `and a temporary password is shown to read out (${shownPw})`);
    const row = (await pool.query(
      `SELECT password_hash AS "passwordHash", password_salt AS "passwordSalt", password_algo AS "passwordAlgo",
              must_change_password AS must FROM trainees WHERE energytech_id = 'ET1001'`)).rows[0];
    ok(shownPw && await verifyPassword(shownPw, row), 'which really is now that trainee\'s password');
    ok(row.must, 'and they will be made to choose their own on first use');
    await ctx.close();
  }

  console.log('\n=== 7. No page errors ===');
  eq(errs, [], 'no uncaught error on any page above');

  await browser.close();
  server.close();
  await pool.end();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
