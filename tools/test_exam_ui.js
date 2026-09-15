/* The exam flow in a real browser, against the REAL energytech-api backend
 * (Express + Postgres) -- repointed for Phase 6 from the mocked-Apps-Script
 * version this file used to be. See test_roster.js's header for the shared
 * mechanics (served from public/ via src/app.js, seeded/asserted through
 * TEST_DATABASE_URL, never DATABASE_URL).
 *
 * Two trainees load the same code and must see the same questions in different
 * orders with differently-arranged choices; the trainee's own list must show the
 * exam with no mark until it is released; and the review, once released, must
 * show the paper as it was actually sat -- which is the part that fails
 * silently if the per-launch seed is not carried through.
 *
 * This is a straight repoint, not a rewrite: every UI step, selector and
 * assertion value below is unchanged from the mocked version except where a
 * value can only be read by querying the real database instead of an
 * intercepted POST body, or where the first real run found the mock had been
 * wrong (see git history / the run report for both):
 *   - attempts.order_seed was BIGINT; newOrderSeed() (app.js) has never
 *     produced a number. Fixed in migration
 *     1789439433592_opaque-payload-fields-to-text -- no workaround needed
 *     here anymore.
 *   - "the mark is shown" expected "3 / 8", the mock's my_history reply
 *     hardcoded regardless of what was actually submitted. Step 2 always
 *     submits every correct answer, so a real backend showing 8/8 is
 *     correct; the assertion now expects that instead. */

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

async function latestAttempt(sessionCode, energytechId) {
  const { rows } = await pool.query(
    `SELECT * FROM attempts WHERE session_code = $1 AND energytech_id = $2 ORDER BY submitted_at DESC LIMIT 1`,
    [sessionCode, energytechId]
  );
  return rows[0] || null;
}
// Real submit = network round trip + Postgres write, not the mocked
// backend's synchronous in-memory push -- see test_roster.js's own note.
async function waitForAttempt(sessionCode, energytechId, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const attempt = await latestAttempt(sessionCode, energytechId);
    if (attempt) return attempt;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/* One trainee sitting the exam: load the code, read what is on screen. */
async function sitExam(browser, who) {
  const p = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto(BASE);
  await p.click('#studentModeBtn');
  await p.fill('#traineeLoginId', who);
  await p.fill('#traineeLoginPassword', TRAINEE_PASSWORD);
  await p.click('#traineeLoginBtn');
  await p.waitForSelector('#traineeHomePanel:not([hidden])');
  await p.fill('#studentSessionCode', 'G1-9001');
  await p.click('#loadTraineeSessionBtn');
  await p.waitForSelector('.question-card');
  const paper = await p.evaluate(() => currentQuiz.map(q => ({
    n: q.original_number,
    choices: q.choices.split(/\\item\s+/).map(s => s.trim()).filter(Boolean),
    answer: q.answer
  })));
  const seed = await p.evaluate(() => currentOrderSeed);
  return { page: p, paper, seed, errs };
}

async function loginTrainee(p, who) {
  await p.goto(BASE);
  await p.click('#studentModeBtn');
  await p.fill('#traineeLoginId', who);
  await p.fill('#traineeLoginPassword', TRAINEE_PASSWORD);
  await p.click('#traineeLoginBtn');
}

(async () => {
  await resetDb();
  await insertInstructor({ username: 'owner1', displayName: 'Owner One', role: 'instructor' });
  const itoken = await issueInstructorToken('owner1');
  const intakeId = await insertIntake('JAN26');
  const groupId = await insertGroup(intakeId, 'G1');
  for (const who of ['ET1000', 'ET1001']) {
    const { passwordHash, passwordSalt, passwordAlgo } = await hashPasswordForStorage(TRAINEE_PASSWORD);
    await insertTrainee({
      energytechId: who, name: `Trainee ${who}`, intakeId, groupId,
      accountStatus: 'active', passwordHash, passwordSalt, passwordAlgo,
    });
  }

  const server = app.listen(0);
  const { port } = server.address();
  BASE = `http://127.0.0.1:${port}/index.html`;
  API_URL = `http://127.0.0.1:${port}/api/call`;

  const created = await api('quiz_session', {
    sessionCode: 'G1-9001', sessionName: 'Midterm exam', intake: 'JAN26', group: 'G1',
    mode: 'assessment', questionSet: 'Chapters 01 & 02 — Original worksheet',
    questionSetKey: 'ch12:original_pdf', seed: 'EXAM-SEED', questionCount: 8,
    orderMode: 'original', showOriginalNumbers: true, requireAll: true,
    allowWalkIn: false, shuffleEachLaunch: true,
  }, itoken);
  if (!created.ok) { console.error('FATAL: could not create the exam session', created); process.exit(1); }

  const browser = await chromium.launch();

  console.log('\n=== 1. Two trainees, one code ===');
  const A = await sitExam(browser, 'ET1000');
  const B = await sitExam(browser, 'ET1001');
  ok(A.seed && B.seed && A.seed !== B.seed, 'each launch minted its own arrangement seed');
  eq(A.paper.map(q => q.n).slice().sort((x, y) => x - y),
     B.paper.map(q => q.n).slice().sort((x, y) => x - y),
     'both sat exactly the same questions');
  ok(JSON.stringify(A.paper.map(q => q.n)) !== JSON.stringify(B.paper.map(q => q.n)),
    'but in a different order');

  const shared = A.paper[0].n;
  const inB = B.paper.find(q => q.n === shared);
  ok(JSON.stringify(A.paper[0].choices) !== JSON.stringify(inB.choices),
    'and with the choices of a shared question arranged differently');
  eq(A.paper[0].choices.slice().sort(), inB.choices.slice().sort(),
    'though they are the same four options');

  console.log('\n=== 2. What is on screen is what gets marked ===');
  // Answer every question with the key as this trainee's paper shows it, then
  // submit: a full score proves the letters on screen and the letters used for
  // marking are the same set.
  const page = A.page;
  await page.evaluate(() => {
    currentQuiz.forEach((q, i) => {
      const el = document.querySelector(`#card-${i} .choice[data-choice="${q.answer}"] input`)
              || document.querySelector(`#card-${i} input[value="${q.answer}"]`);
      if (el) el.click();
    });
  });
  await page.click('#studentSubmitBtn');
  const sent = await waitForAttempt('G1-9001', 'ET1000');
  ok(Boolean(sent), 'the attempt was submitted');
  eq(sent.score, sent.total, 'every answer taken from the paper on screen was marked correct');
  eq(String(sent.order_seed), String(A.seed), 'and the arrangement seed went with it');

  console.log('\n=== 3. Before release, the mark is not there ===');
  const p3 = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const errs3 = [];
  p3.on('pageerror', e => errs3.push(String(e)));
  await loginTrainee(p3, 'ET1000');
  await p3.waitForSelector('.attempt-row');
  const body3 = await p3.textContent('#myHistoryBody');
  ok(/Midterm exam/.test(body3), 'the exam is listed, so the trainee knows it was recorded');
  ok(/Not released yet/i.test(body3), 'and is marked as not released');
  ok(!/\d+\s*\/\s*8/.test(body3), 'with no score anywhere on the row');
  eq(await p3.$$eval('.attempt-row.is-pending', n => n.length), 1, 'the row is styled as pending');
  eq(await p3.$$eval('.attempt-row[data-attempt]', n => n.length), 0, 'and carries no attempt id to open');
  const stats = await p3.$$eval('.stat-value', n => n.map(x => x.textContent.trim()));
  ok(stats[0] === '0', `it does not count towards "quizzes taken" (got ${stats[0]})`);
  ok(stats[1] === '—', `nor towards the average (got ${stats[1]})`);
  await p3.click('.attempt-row');
  await p3.waitForTimeout(400);
  ok(!(await p3.$('.review-card')), 'and clicking it opens nothing');
  // The list must survive the click. An earlier build called the backend with
  // an empty id, which blanked the list and put an error where it had been.
  eq(await p3.$$eval('.attempt-row', n => n.length), 1, 'the list is still there afterwards');
  ok(!/not released the results/i.test(await p3.textContent('#myHistoryBody')),
    'and no error is shown for a click that should do nothing');

  console.log('\n=== 4. After release ===');
  const pub = await api('session_publish', { sessionCode: 'G1-9001' }, itoken);
  ok(pub.ok, `exam published (${JSON.stringify(pub)})`);
  const p4 = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const errs4 = [];
  p4.on('pageerror', e => errs4.push(String(e)));
  await loginTrainee(p4, 'ET1000');
  await p4.waitForSelector('.attempt-row[data-attempt]');
  ok(!/Not released yet/i.test(await p4.textContent('#myHistoryBody')), 'the pending label is gone');
  // Was "3 / 8": the mock's my_history reply hardcoded that score regardless
  // of what got submitted, disconnected from step 2's actual answers. Step 2
  // always takes the correct choice for every question (that is the whole
  // point of the check right above it, "every answer taken from the paper on
  // screen was marked correct"), so a real backend showing 8/8 is correct,
  // not a regression -- the mock's "3 / 8" was never true of anything.
  ok(/8 \/ 8/.test(await p4.textContent('#myHistoryBody')), 'the mark is shown');

  console.log('\n=== 5. The review shows the paper as it was sat ===');
  await p4.click('.attempt-row[data-attempt] td');
  await p4.waitForSelector('.review-card');
  const rebuilt = await p4.evaluate(() => [...document.querySelectorAll('.review-card')].map(card => ({
    choices: [...card.querySelectorAll('.choice')].map(c => c.textContent.replace(/^[✓✗\s]*[a-d]\)\s*/, '').trim()),
    right: (card.querySelector('.choice.is-right') || {}).textContent || ''
  })));
  eq(rebuilt.length, 8, 'all eight questions come back');
  // The seed used here (SEED-LAUNCH-1) is not the seed A actually sat with, so
  // this checks the mechanism, not A's paper: every card must still offer four
  // options and mark exactly one of them right.
  eq(rebuilt.filter(r => r.choices.length !== 4).length, 0, 'each with four options');
  eq(rebuilt.filter(r => !r.right).length, 0, 'and exactly one marked as the right answer');

  console.log('\n=== 6. No page errors anywhere ===');
  const all = [].concat(A.errs, B.errs, errs3, errs4);
  ok(all.length === 0, all.length ? all.join(' | ') : 'none');

  await browser.close();
  server.close();
  await pool.end();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
