/* What a trainee sees when they try to sit an exam twice, and the double-submit
 * fix, against the REAL energytech-api backend -- repointed for Phase 6. See
 * test_roster.js's header for the shared mechanics.
 *
 * Straight repoint, not a rewrite -- but the first real run found two things
 * (see git history / the run report for both):
 *   - load()'s waitForTimeout(600) and two post-submit waitForTimeout(500)s
 *     were tuned against the mock's synchronous replies. Against a real
 *     network + Postgres round trip they fired early often enough to
 *     cascade-fail most of the file (a paper not there yet reads as "no
 *     paper", clicks land on stale UI, everything downstream is checking a
 *     page that hadn't caught up). Replaced with a wait for whichever real
 *     outcome actually happens, and a DB poll for the actual attempt count,
 *     rather than a guessed delay.
 *   - Every submission here crashed quiz_attempt server-side (BIGINT
 *     order_seed vs. app.js's non-numeric newOrderSeed()) until migration
 *     1789439433592_opaque-payload-fields-to-text; no workaround needed here
 *     anymore.
 * Step 6 ("offline") is the one deliberate mock-shaped exception: it is
 * simulated with a real route-abort on /api/call, testing the front-end's
 * handling of a genuine network failure rather than mocking backend business
 * logic -- there is no other way to make a real, shared, in-process server
 * appear offline for one step without taking it down for the whole file. */

const path = require('path');
const { chromium } = require('playwright');

const ENERGYTECH_API_ROOT = path.join(__dirname, '..', '..', 'energytech-api');
require('dotenv').config({ path: path.join(ENERGYTECH_API_ROOT, '.env') });

const {
  pool, resetDb, insertInstructor, insertIntake, insertGroup, insertTrainee, issueInstructorToken,
} = require(path.join(ENERGYTECH_API_ROOT, 'tests', 'helpers', 'db'));
const { hashPasswordForStorage } = require(path.join(ENERGYTECH_API_ROOT, 'src', 'lib', 'passwords'));
const app = require(path.join(ENERGYTECH_API_ROOT, 'src', 'app'));

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const TRAINEE_PASSWORD = 'secret1';

let BASE, API_URL;
async function api(action, params, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify({ action, ...params }) });
  return res.json();
}

async function countAttempts(sessionCode, energytechId) {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM attempts WHERE session_code = $1 AND energytech_id = $2',
    [sessionCode, energytechId]
  );
  return rows[0].n;
}
// CONFIRMED FINDING, not fixed in the app (see the run report): the two call
// sites below were waitForTimeout(500) after a submit click, tuned against
// the mock's synchronous reply. Step 2's later checks (400ms x2, after this
// same submission) already prove the write does land -- just not inside
// 500ms -- so this polls instead of guessing, purely to let steps 5-6 run on
// their own merits rather than cascade-fail from stale counts.
async function waitForAttemptCount(sessionCode, energytechId, expected, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const n = await countAttempts(sessionCode, energytechId);
    if (n >= expected) return n;
    await new Promise((r) => setTimeout(r, 100));
  }
  return countAttempts(sessionCode, energytechId);
}

/* Reload and get back to the trainee's home screen. The login survives in local
 * storage, so after the first time there is no form to fill in. */
async function login(p) {
  await p.goto(BASE);
  await p.click('#studentModeBtn');
  if (await p.isVisible('#traineeLoginId')) {
    await p.fill('#traineeLoginId', 'ET1000');
    await p.fill('#traineeLoginPassword', TRAINEE_PASSWORD);
    await p.click('#traineeLoginBtn');
  }
  await p.waitForSelector('#traineeHomePanel:not([hidden])');
}

// CONFIRMED FINDING, not fixed in the app (see the run report): this was
// waitForTimeout(600), tuned against the mock's synchronous replies. Against
// a real network + Postgres round trip it fired early often enough to cascade
// failures through most of the file -- '.question-card' not there yet reads
// as "no paper", clicks land on hidden/stale elements, and every assertion
// downstream is checking a page that hadn't caught up. Replaced with a wait
// for whichever real outcome actually happens, bounded per branch so one
// timing out doesn't starve Promise.race of the other.
async function load(p, code) {
  await p.fill('#studentSessionCode', code);
  await p.click('#loadTraineeSessionBtn');
  await Promise.race([
    p.waitForSelector('.question-card', { timeout: 15000 }).catch(() => {}),
    p.waitForFunction(() => {
      const s = document.getElementById('studentStatus');
      return s && /already sat|cannot reach|session not found/i.test(s.textContent);
    }, null, { timeout: 15000 }).catch(() => {}),
  ]);
}

(async () => {
  await resetDb();
  await insertInstructor({ username: 'owner1', displayName: 'Owner One', role: 'instructor' });
  const itoken = await issueInstructorToken('owner1');
  const intakeId = await insertIntake('JAN26');
  const groupId = await insertGroup(intakeId, 'G1');
  const { passwordHash, passwordSalt, passwordAlgo } = await hashPasswordForStorage(TRAINEE_PASSWORD);
  await insertTrainee({
    energytechId: 'ET1000', name: 'Mohammed', intakeId, groupId,
    accountStatus: 'active', passwordHash, passwordSalt, passwordAlgo,
  });

  const server = app.listen(0);
  const { port } = server.address();
  BASE = `http://127.0.0.1:${port}/index.html`;
  API_URL = `http://127.0.0.1:${port}/api/call`;

  const EXAM = {
    sessionCode: 'G1-9001', sessionName: 'Midterm exam', intake: 'JAN26', group: 'G1',
    mode: 'assessment', questionSet: 'Ch 1 & 2', questionSetKey: 'ch12:original_pdf', seed: 'S',
    questionCount: 4, orderMode: 'original', showOriginalNumbers: true, requireAll: true,
    allowWalkIn: false, shuffleEachLaunch: true,
  };
  const PRACTICE = Object.assign({}, EXAM, { sessionCode: 'G1-7001', sessionName: 'Practice', mode: 'practice', shuffleEachLaunch: false });
  for (const s of [EXAM, PRACTICE]) {
    const created = await api('quiz_session', s, itoken);
    if (!created.ok) { console.error('FATAL: could not create session', s.sessionCode, created); process.exit(1); }
  }

  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  // The offline section aborts requests on purpose, so a failed fetch is not a
  // page error worth reporting -- but anything the page itself throws is.
  p.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) errs.push(m.text());
  });
  await login(p);

  console.log('\n=== 1. The first sitting works ===');
  await load(p, 'G1-9001');
  ok(Boolean(await p.$('.question-card')), 'the paper is drawn');
  await p.evaluate(() => currentQuiz.forEach((q, i) => {
    const el = document.querySelector(`#card-${i} input[value="${q.answer}"]`);
    if (el) el.click();
  }));
  await p.click('#studentSubmitBtn');
  eq(await waitForAttemptCount('G1-9001', 'ET1000', 1), 1, 'one attempt posted');

  console.log('\n=== 2. There is nothing left to press ===');
  // A handed-in exam has its paper and its buttons taken away, so the
  // press-it-twice case cannot arise through the interface at all.
  ok(!(await p.isVisible('#studentSubmitBtn')), 'Submit is gone once the exam is in');
  ok(!(await p.isVisible('#studentClearBtn')), 'and so is Clear answers');
  // The rule underneath, called the way a console would call it.
  await p.evaluate(() => submitOnlineResult('student'));
  await p.waitForTimeout(400);
  await p.evaluate(() => submitOnlineResult('student'));
  await p.waitForTimeout(400);
  eq(await countAttempts('G1-9001', 'ET1000'), 1, 'still one attempt, however many times it is called');
  ok(/already submitted/i.test(await p.textContent('#studentFeedback')),
    'and the trainee is told it already went through');

  console.log('\n=== 3. Entering the code again refuses, without drawing a paper ===');
  await login(p);
  await load(p, 'G1-9001');
  const status = await p.textContent('#studentStatus');
  ok(/already sat this exam/i.test(status), `the trainee is told (got "${status.trim().slice(0, 80)}")`);
  ok(/ask your instructor/i.test(status), 'and pointed at the way out');
  ok(!(await p.$('.question-card')), 'no paper is drawn -- seeing the questions again is itself worth something');
  eq(await countAttempts('G1-9001', 'ET1000'), 1, 'and nothing more was posted');

  console.log('\n=== 4. A practice quiz is not limited ===');
  await load(p, 'G1-7001');
  ok(Boolean(await p.$('.question-card')), 'the practice paper loads');
  await load(p, 'G1-7001');
  ok(Boolean(await p.$('.question-card')), 'and loads again, as often as they like');

  console.log('\n=== 5. After the instructor allows another sitting ===');
  const granted = await api('retake_allow', { sessionCode: 'G1-9001', energytechId: 'ET1000' }, itoken);
  ok(granted.ok, `retake granted (${JSON.stringify(granted)})`);
  await login(p);
  await load(p, 'G1-9001');
  ok(Boolean(await p.$('.question-card')), 'the exam paper is drawn again');
  await p.evaluate(() => currentQuiz.forEach((q, i) => {
    const el = document.querySelector(`#card-${i} input[value="${q.answer}"]`);
    if (el) el.click();
  }));
  await p.click('#studentSubmitBtn');
  eq(await waitForAttemptCount('G1-9001', 'ET1000', 2), 2, 'the second sitting is recorded');
  await login(p);
  await load(p, 'G1-9001');
  ok(!(await p.$('.question-card')), 'and the door closes behind them again');

  console.log('\n=== 6. With no backend, an exam does not start ===');
  // Guessing is the one thing not to do: without the server there is no way to
  // know whether they have already sat it. Aborting the request is a genuine
  // network failure, not a mocked reply -- there is no other way to make a
  // real, shared, in-process server look offline for one step only.
  await p.route(/\/api\/call$/, r => r.abort());
  await load(p, 'G1-9001');
  const off = await p.textContent('#studentStatus');
  ok(!(await p.$('.question-card')), 'no paper is drawn');
  ok(/cannot reach the server|cannot confirm/i.test(off), `and it says why (got "${off.trim().slice(0, 70)}")`);
  ok(!/session not found/i.test(off), 'and does not blame the code, which was fine');
  await p.unroute(/\/api\/call$/);

  console.log('\n=== 7. No page errors ===');
  ok(errs.length === 0, errs.length ? errs.join(' | ') : 'none');

  await browser.close();
  server.close();
  await pool.end();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
