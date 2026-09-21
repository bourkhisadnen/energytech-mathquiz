/* An exam submission the trainee is told about honestly, when the network
 * itself is what fails -- against the REAL energytech-api backend.
 *
 * Renamed from test_exam_confirm.js (Phase 6). That file existed because the
 * old no-cors POST was opaque, so "submitted successfully" was a guess
 * Code.gs's read-back had to verify -- including the case where the POST
 * *looked* fine to the browser but the write had silently not happened.
 * D3/D4 and the Phase 5 rewrite removed that: submitOnlineResult now awaits a
 * real fetch and reads data.ok synchronously, and quiz_attempt is one
 * transaction, so "ok:true, but nothing was actually written" cannot happen
 * anymore on its own.
 *
 * The risk did not go away, though -- it inverted. On unreliable classroom
 * WiFi the far likelier failure is the opposite one: the request reaches the
 * server, the server does the work and COMMITs it for real, and then the
 * *response* never makes it back -- the connection drops on the way out, not
 * the way in. That was a real gap: submitOnlineResult's catch block could not
 * tell that case apart from "nothing happened", and said "Submission failed"
 * either way -- true for a genuine network error before the server ever saw
 * the request, false for one that drops after COMMIT. Telling a trainee their
 * exam failed when it was recorded is the worse of the two mistakes
 * (claude/11-exam-handed-in.md): they re-sit, the backend refuses the second
 * attempt (one sitting per exam), and now they are told they have already sat
 * an exam they were just told had failed.
 *
 * Closed by having the catch branch call confirmExamRecorded too, the same
 * read-back the success branch already used for exactly this doubt, instead
 * of guessing from an error that only proves the response didn't arrive, not
 * that the write didn't. Three outcomes, three messages, per
 * claude/11-exam-handed-in.md's own table -- all three pinned below, plus the
 * confirmation read-back's own failure mode as a fourth case.
 *
 * See test_roster.js's header for the shared mechanics (served from public/
 * via src/app.js, seeded/asserted through TEST_DATABASE_URL, never
 * DATABASE_URL). Route interception here is never a mocked reply -- either
 * the real request is let through untouched, let through for real with only
 * the response back to the page discarded, or never sent at all -- never a
 * fabricated response body. */

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

const TRAINEE_PASSWORD = 'secret1';

let BASE, API_URL;
async function api(action, params, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify({ action, ...params }) });
  return res.json();
}
async function attemptCount(sessionCode, energytechId) {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM attempts WHERE session_code = $1 AND energytech_id = $2',
    [sessionCode, energytechId]
  );
  return rows[0].n;
}

/* `behaviour`:
 *   'records'          -- nothing intercepted; the real submit and the real
 *                          read-back both happen exactly as in production
 *   'response-dropped' -- the quiz_attempt request is sent for real and the
 *                          server really processes and COMMITs it, but the
 *                          route is then aborted instead of fulfilled, so the
 *                          page's fetch() rejects as if the connection had
 *                          dropped after the server was already done
 *   'never-arrived'    -- the quiz_attempt request is aborted before it is
 *                          ever sent, so nothing reaches the server and
 *                          nothing is written -- the genuinely-not-recorded
 *                          case, indistinguishable from 'response-dropped' on
 *                          the client alone (both are just "fetch rejected")
 *   'confirm-dropped'  -- the submit succeeds and the page sees it succeed;
 *                          only the follow-up confirmExamRecorded read-back
 *                          (a 'session' lookup, made after submission) is
 *                          aborted for real
 */
async function sitAndSubmit(browser, behaviour, sessionCode) {
  const p = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  let submitted = false;

  if (behaviour !== 'records') {
    await p.route(/\/api\/call$/, async (route) => {
      const req = route.request();
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch { /* not JSON */ }

      if (behaviour === 'never-arrived' && body.action === 'quiz_attempt') {
        return route.abort(); // never sent -- nothing for the server to commit
      }
      if (behaviour === 'response-dropped' && body.action === 'quiz_attempt') {
        await route.fetch(); // really sent, really processed, really committed
        submitted = true;
        return route.abort(); // ...and the page never finds out
      }
      if (body.action === 'quiz_attempt') submitted = true;

      // confirm-dropped only touches confirmExamRecorded's OWN read-back (a
      // 'session' lookup, made with a token, after a submission the page
      // already knows succeeded) -- login and the initial session load go
      // through untouched.
      if (behaviour === 'confirm-dropped' && submitted && body.action === 'session') {
        return route.abort();
      }
      return route.continue();
    });
  }

  await p.goto(BASE);
  await p.click('#studentModeBtn');
  await p.fill('#traineeLoginId', 'ET1000');
  await p.fill('#traineeLoginPassword', TRAINEE_PASSWORD);
  await p.click('#traineeLoginBtn');
  await p.waitForSelector('#traineeHomePanel:not([hidden])');
  await p.fill('#studentSessionCode', sessionCode);
  await p.click('#loadTraineeSessionBtn');
  await p.waitForSelector('.question-card');
  await p.evaluate(() => currentQuiz.forEach((q, i) => {
    const el = document.querySelector(`#card-${i} input[value="${q.answer}"]`);
    if (el) el.click();
  }));
  await p.click('#studentSubmitBtn');
  // This used to be a fixed 3.4s sleep ("the read-back waits ~1.8s first").
  // That was enough for the mock and is not enough for a real Postgres write of
  // thirty item responses followed by the read-back: about one run in four read
  // the panel too early, failed section 1 for a reason that had nothing to do
  // with the code under test, and -- worse for the mutation harness -- made this
  // suite look broken on clean code.
  //
  // "Not still saying Submitting..." is NOT enough of a signal: the success
  // message ("Your answers have been submitted...") appears first and the
  // read-back's verdict is appended to it afterwards, so a wait that stopped at
  // the first non-progress text read the panel before the very thing under test
  // had spoken (tried; failed every run). The read-back's verdict is one of the
  // four endings below. A page that never reaches one -- which is exactly what
  // the "success is only assumed" mutation does -- is given the panel staying
  // unchanged for 4s instead, and the checks below then say what is missing.
  const VERDICT = /Recorded\.|may not have been recorded|Could not confirm|Submission failed/i;
  const IN_PROGRESS = /Submitting result|Checking whether it was recorded/i;
  let last = null, since = Date.now();
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const t = ((await p.textContent('#studentFeedback')) || '').replace(/\s+/g, ' ').trim();
    if (VERDICT.test(t)) break;
    if (t !== last) { last = t; since = Date.now(); }
    else if (t && !IN_PROGRESS.test(t) && Date.now() - since >= 4000) break;
    await p.waitForTimeout(150);
  }
  const out = {
    cls: await p.getAttribute('#studentFeedback', 'class'),
    text: (await p.textContent('#studentFeedback')).replace(/\s+/g, ' ').trim(),
    errs: errs.filter(e => !/Failed to load resource|ERR_FAILED|ERR_ABORTED/.test(e))
  };
  await p.unrouteAll({ behavior: 'ignoreErrors' });   // a route.fetch still in flight must not crash the run when the page closes
  await p.close();
  return out;
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

  // Four independent sessions, one per scenario -- "one sitting per exam" is
  // scoped per session code, so this avoids one scenario being refused as an
  // already-sat exam because of another.
  const CODES = { records: 'G1-9001', dropped: 'G1-9002', neverArrived: 'G1-9003', confirmDropped: 'G1-9004' };
  for (const [name, code] of Object.entries(CODES)) {
    const created = await api('quiz_session', {
      sessionCode: code, sessionName: `Midterm exam (${name})`, intake: 'JAN26', group: 'G1',
      mode: 'assessment', questionSet: 'Chapters 01 & 02', questionSetKey: 'ch12:original_pdf',
      seed: 'S', questionCount: 4, orderMode: 'original', showOriginalNumbers: true,
      requireAll: true, allowWalkIn: false, shuffleEachLaunch: true,
    }, itoken);
    if (!created.ok) { console.error('FATAL: could not create session', code, created); process.exit(1); }
  }

  const browser = await chromium.launch();
  const allErrs = [];

  console.log('\n=== 1. The write landed, and the trainee saw it ===');
  let r = await sitAndSubmit(browser, 'records', CODES.records);
  allErrs.push(...r.errs);
  ok(/Recorded\./.test(r.text), `it says so, having checked (got "${r.text.slice(0, 80)}")`);
  ok(/My results/.test(r.text), 'and where the mark will appear');
  ok(!/may not have been recorded/i.test(r.text), 'with no warning');
  ok(!/\bbad\b/.test(r.cls || ''), 'and the panel is not an error');

  console.log('\n=== 2. The write landed, but the response was lost ===');
  // The scenario this file is now named for: COMMIT happened, the connection
  // dropped on the way back. confirmExamRecorded's read-back is what tells
  // this apart from a genuine failure -- verified against the real database,
  // not the page's own belief about what happened.
  r = await sitAndSubmit(browser, 'response-dropped', CODES.dropped);
  allErrs.push(...r.errs);
  ok((await attemptCount(CODES.dropped, 'ET1000')) === 1, 'the attempt is really on record');
  ok(/Recorded\./.test(r.text), `and the trainee is told so, not that it failed (got "${r.text.slice(0, 90)}")`);
  ok(!/Submission failed/i.test(r.text), 'never claiming a landed write failed');
  ok(!/\bbad\b/.test(r.cls || ''), 'and the panel is not shown as an error');

  console.log('\n=== 3. The write genuinely did not land ===');
  // The other half of the same ambiguity: the request never reached the
  // server at all, so there is really nothing to find. This is the ONE
  // outcome that should read as a failure (claude/11-exam-handed-in.md).
  r = await sitAndSubmit(browser, 'never-arrived', CODES.neverArrived);
  allErrs.push(...r.errs);
  ok((await attemptCount(CODES.neverArrived, 'ET1000')) === 0, 'nothing was written, for real');
  ok(/may not have been recorded/i.test(r.text), `the trainee is warned (got "${r.text.slice(0, 90)}")`);
  ok(/tell your instructor now/i.test(r.text), 'and told to raise it immediately');
  ok(/\bbad\b/.test(r.cls || ''), 'shown as an error, not a note');
  ok(!/Recorded\./.test(r.text), 'and it does not also claim success');

  console.log('\n=== 4. The write landed and was seen, but the check could not be made ===');
  r = await sitAndSubmit(browser, 'confirm-dropped', CODES.confirmDropped);
  allErrs.push(...r.errs);
  ok(/could not confirm/i.test(r.text), `it says the check failed (got "${r.text.slice(0, 90)}")`);
  ok(!/may not have been recorded/i.test(r.text), 'without claiming the paper was lost');
  ok(!/Recorded\./.test(r.text), 'and without claiming the check succeeded when it did not run');

  console.log('\n=== 5. No page errors in any of the four ===');
  ok(allErrs.length === 0, allErrs.length ? allErrs.join(' | ') : 'none');

  await browser.close();
  server.close();
  await pool.end();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
