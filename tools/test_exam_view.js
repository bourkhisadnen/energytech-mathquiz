/* The page a trainee sees while sitting an exam, in a real browser against
 * the REAL energytech-api backend (Express + Postgres) -- repointed for
 * Phase 6 from the mocked-Apps-Script version this file used to be. See
 * test_roster.js's header for the shared mechanics (served from public/ via
 * src/app.js, seeded/asserted through TEST_DATABASE_URL, never DATABASE_URL).
 *
 * Two things are being checked. The first is that the screen is cleared to just
 * the paper and a strip saying whose it is. The second matters more: nothing on
 * that screen may hand them the answers -- and one thing used to.
 *
 * This is a straight repoint, not a rewrite: every UI step, selector and
 * assertion value below is unchanged from the mocked version except where the
 * mock's own bookkeeping (a `posted` counter incremented from an intercepted
 * script.google.com POST, a fixed 1800/2600ms wait standing in for the old
 * Apps Script round trip) is replaced with the real thing it was standing in
 * for: a row in Postgres, and confirmExamRecorded's own real network read,
 * waited for instead of guessed at. */

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

const TRAINEE_PASSWORD = 'x';

let BASE, API_URL;
async function api(action, params, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify({ action, ...params }) });
  return res.json();
}

async function attemptCount(sessionCode, energytechId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM attempts WHERE session_code = $1 AND energytech_id = $2`,
    [sessionCode, energytechId]
  );
  return rows[0].n;
}
// Real submit = network round trip + Postgres write, not the mocked
// backend's synchronous in-memory push -- see test_roster.js's own note.
async function waitForAttempt(sessionCode, energytechId, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const n = await attemptCount(sessionCode, energytechId);
    if (n > 0) return n;
    await new Promise((r) => setTimeout(r, 100));
  }
  return 0;
}

const visible = (p, sel) => p.evaluate(s => {
  const el = document.querySelector(s);
  return Boolean(el && el.offsetParent !== null);
}, sel);

(async () => {
  await resetDb();
  await insertInstructor({ username: 'owner1', displayName: 'Owner One', role: 'instructor' });
  const itoken = await issueInstructorToken('owner1');
  const intakeId = await insertIntake('JAN26');
  const groupId = await insertGroup(intakeId, 'G1');
  const { passwordHash, passwordSalt, passwordAlgo } = await hashPasswordForStorage(TRAINEE_PASSWORD);
  await insertTrainee({
    energytechId: 'ET1000', name: 'Mohammed Abdullah Saleh Al-Otaibi', intakeId, groupId,
    accountStatus: 'active', passwordHash, passwordSalt, passwordAlgo,
  });

  const server = app.listen(0);
  const { port } = server.address();
  BASE = `http://127.0.0.1:${port}/index.html`;
  API_URL = `http://127.0.0.1:${port}/api/call`;

  const COMMON = {
    intake: 'JAN26', group: 'G1', questionSet: 'Chapters 01 & 02',
    questionSetKey: 'ch12:original_pdf', seed: 'S', questionCount: 4,
    orderMode: 'original', showOriginalNumbers: true, requireAll: true, allowWalkIn: false
  };
  const exam = await api('quiz_session', Object.assign({ sessionCode: 'G1-9001', sessionName: 'Midterm exam',
    mode: 'assessment', shuffleEachLaunch: true }, COMMON), itoken);
  if (!exam.ok) { console.error('FATAL: could not create the exam session', exam); process.exit(1); }
  const practice = await api('quiz_session', Object.assign({ sessionCode: 'G1-7001', sessionName: 'Week 3 practice',
    mode: 'practice', shuffleEachLaunch: false }, COMMON), itoken);
  if (!practice.ok) { console.error('FATAL: could not create the practice session', practice); process.exit(1); }

  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await p.goto(BASE);
  await p.click('#studentModeBtn');
  await p.fill('#traineeLoginId', 'ET1000');
  await p.fill('#traineeLoginPassword', TRAINEE_PASSWORD);
  await p.click('#traineeLoginBtn');
  await p.waitForSelector('#traineeHomePanel:not([hidden])');

  console.log('\n=== 1. Before the exam, the home screen is its normal self ===');
  ok(await visible(p, '#traineeHomePanel'), 'the home panel is there');
  ok(await visible(p, '#myHistoryPanel'), 'and their results');

  await p.fill('#studentSessionCode', 'G1-9001');
  await p.click('#loadTraineeSessionBtn');
  await p.waitForSelector('.question-card');

  console.log('\n=== 2. During the exam, everything else is gone ===');
  for (const [sel, what] of [
    ['#traineeHomePanel', 'the home panel'],
    ['#myHistoryPanel', 'their results'],
    ['#studentSessionCode', 'the session code box'],
    ['#traineeChangePasswordToggle', 'change password'],
    ['#backFromTraineeHomeBtn', 'the Back button'],
    ['.header-actions', 'the header buttons'],
    ['footer', 'the footer']
  ]) {
    ok(!(await visible(p, sel)), `${what} is hidden`);
  }
  ok(await visible(p, '#studentQuizArea'), 'the paper itself is there');
  ok(await p.evaluate(() => document.body.classList.contains('exam-mode')), 'the page is in exam mode');

  console.log('\n=== 3. The header says whose paper it is ===');
  const head = (await p.textContent('.exam-head')).replace(/\s+/g, ' ');
  ok(/Mohammed Abdullah Saleh Al-Otaibi/.test(head), 'their name');
  ok(/ET1000/.test(head), 'their EnergyTech ID');
  ok(/JAN26/.test(head) && /G1/.test(head), 'their intake and group');
  ok(/Midterm exam/.test(head), 'what they are sitting');
  ok(/G1-9001/.test(head), 'and the session code');
  ok(/4 questions/.test(head), 'and how many questions');

  console.log('\n=== 4. Progress, so nothing is missed by accident ===');
  eq((await p.textContent('#examProgress')).trim(), '0 of 4 answered', 'starts at none');
  await p.click('#card-0 input');
  await p.waitForTimeout(120);
  eq((await p.textContent('#examProgress')).trim(), '1 of 4 answered', 'counts up as they answer');
  // One deliberately wrong, so a leaked mark reads as a distinctive 3 / 4.
  await p.evaluate(() => currentQuiz.forEach((q, i) => {
    const pick = i === 1 ? ['a', 'b', 'c', 'd'].find(L => L !== q.answer) : q.answer;
    const el = document.querySelector(`#card-${i} input[value="${pick}"]`);
    if (el) el.click();
  }));
  await p.waitForTimeout(120);
  eq((await p.textContent('#examProgress')).trim(), '4 of 4 answered', 'and reaches the full count');

  console.log('\n=== 5. Nothing on screen gives the answers away ===');
  eq(await p.$$eval('.choice.correct-choice', n => n.length), 0, 'no choice is marked as correct');
  eq(await p.$$eval('.question-card.flag-correct, .question-card.flag-wrong', n => n.length), 0,
    'and no card is flagged right or wrong');
  ok(!(await visible(p, '#studentDownloadResultBtn')), 'the download button is not on the page');

  // The button being hidden is not the fix -- calling it was the leak. Marking
  // the paper used to light up the correct choice on every card as a side
  // effect, so this presses it the way a trainee with a console would.
  const leaked = await p.evaluate(() => {
    const realCreate = URL.createObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    let blob = null;
    URL.createObjectURL = b => { blob = b; return 'blob:x'; };
    HTMLAnchorElement.prototype.click = function () {};
    try { downloadResult(); } catch (e) { /* fine */ }
    URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;
    return {
      marked: document.querySelectorAll('.choice.correct-choice').length,
      flagged: document.querySelectorAll('.question-card.flag-correct, .question-card.flag-wrong').length
    };
  });
  eq(leaked.marked, 0, 'and calling it directly still marks no correct answers');
  eq(leaked.flagged, 0, 'nor flags any card');

  console.log('\n=== 6. Submitting gives the screen back ===');
  await p.click('#studentSubmitBtn');
  const attempted = await waitForAttempt('G1-9001', 'ET1000');
  ok(attempted > 0, 'the attempt reached the database');
  await p.waitForFunction(() => !document.body.classList.contains('exam-mode'), null, { timeout: 5000 });
  ok(!(await p.evaluate(() => document.body.classList.contains('exam-mode'))), 'exam mode is over');
  ok(await visible(p, '#traineeHomePanel'), 'the home panel is back');
  ok(await visible(p, '.header-actions'), 'and the header buttons');

  console.log('\n=== 6b. But the mark does not come back with it ===');
  // This is where the first version of this feature failed. The download was
  // tied to exam-mode-the-screen-state, which ends at Submit, so the button
  // reappeared the instant the paper went in and handed over the score of an
  // exam whose results had not been released.
  ok(!(await visible(p, '#studentDownloadResultBtn')),
    'the download button does NOT come back after submitting an exam');
  // Checked as a property, not just as "invisible". The CSS hides the whole
  // button row on a handed-in paper, which would mask the JS rule going wrong
  // -- and a masked rule is an untested one.
  ok(await p.evaluate(() => document.getElementById('studentDownloadResultBtn').hidden),
    'and is marked hidden in its own right, not merely covered by CSS');
  const after = await p.evaluate(() => {
    let cap = null;
    const rc = URL.createObjectURL, rk = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = b => { cap = b; return 'blob:x'; };
    HTMLAnchorElement.prototype.click = function () {};
    try { downloadResult(); } catch (e) { /* fine */ }
    URL.createObjectURL = rc; HTMLAnchorElement.prototype.click = rk;
    return cap ? cap.text() : null;
  });
  ok(after === null, 'and calling it directly produces no file at all');
  ok(/not downloadable/i.test(await p.textContent('#studentFeedback')),
    'it says the mark comes from My results once released');
  const shown = await p.textContent('#studentQuizArea');
  ok(!/\b3\s*\/\s*4\b|75\s*%/.test(shown), 'and no score is anywhere on the page');

  console.log('\n=== 6c. And the paper cannot be sat again ===');
  // Clearing used to reset the submitted flag, which unlocked Submit: hand in,
  // clear, re-answer, submit again -- and the app said "submitted successfully"
  // while the backend refused the write. Four things stop that now, and each is
  // checked on its own, because any one of them could be undone by itself.
  ok(!(await p.$('.question-card')), 'the paper is taken off the screen');
  eq(await p.evaluate(() => currentQuiz.length), 0, 'and out of memory with it');
  ok(!(await visible(p, '#studentClearBtn')), 'Clear answers is gone');
  ok(!(await visible(p, '#studentSubmitBtn')), 'so is Submit answers');
  // Buttons being gone is presentation. These are the rules underneath, called
  // the way somebody with a browser console would call them.
  const cleared = await p.evaluate(() => {
    clearAnswers('student');
    return {
      stillSubmitted: studentSubmitted,
      msg: document.getElementById('studentFeedback').textContent
    };
  });
  ok(cleared.stillSubmitted, 'clearAnswers does not un-submit an exam');
  ok(/handed in/i.test(cleared.msg), 'and says the exam has been handed in');
  const before = await attemptCount('G1-9001', 'ET1000');
  await p.evaluate(() => submitOnlineResult('student'));
  await p.waitForTimeout(500);
  eq(await attemptCount('G1-9001', 'ET1000'), before, 'and a second submit sends nothing');

  console.log('\n=== 6d. The confirmation is checked, not assumed ===');
  // The write is confirmed by a second, real read -- fetchSessionByCode over
  // the network -- not assumed from the submit response alone. It is fired
  // without being awaited (submitOnlineResult intentionally does not block the
  // screen coming back on it), so this waits for the message rather than
  // guessing how long the round trip takes.
  await p.waitForFunction(() => /Recorded\./.test(document.getElementById('studentFeedback').textContent),
    null, { timeout: 10000 });
  const msg = (await p.textContent('#studentFeedback')).replace(/\s+/g, ' ');
  ok(/Recorded\./.test(msg), `the app confirms it read the record back (got "${msg.slice(0, 90)}")`);
  ok(!/may not have been recorded/i.test(msg), 'and does not warn, because it did register');

  console.log('\n=== 7. A practice quiz is not stripped down ===');
  // The clean page is an exam measure. In practice a trainee may well want to
  // load another code straight afterwards.
  await p.fill('#studentSessionCode', 'G1-7001');
  await p.click('#loadTraineeSessionBtn');
  await p.waitForSelector('.question-card');
  ok(!(await p.evaluate(() => document.body.classList.contains('exam-mode'))), 'no exam mode');
  ok(await visible(p, '#studentSessionCode'), 'the session code box stays');
  ok(await visible(p, '#myHistoryPanel'), 'and their results');
  ok(await visible(p, '#studentDownloadResultBtn'), 'and the download button, which is fine here');
  ok(!(await p.$('.exam-head')), 'and no exam header');

  // Downloading is not marking. Computing the score used to flag every card and
  // light up the correct choice as a side effect; in an exam that was the leak,
  // and in practice it is still wrong -- pressing "download" should not quietly
  // mark a paper the trainee is still working on. This is what keeps that fix
  // honest now that the exam path returns before ever reaching it.
  await p.click('#card-0 input');
  const practiceDl = await p.evaluate(() => {
    const rc = URL.createObjectURL, rk = HTMLAnchorElement.prototype.click;
    let blob = null;
    URL.createObjectURL = b => { blob = b; return 'blob:x'; };
    HTMLAnchorElement.prototype.click = function () {};
    try { downloadResult(); } catch (e) { /* fine */ }
    URL.createObjectURL = rc; HTMLAnchorElement.prototype.click = rk;
    return {
      gotFile: Boolean(blob),
      marked: document.querySelectorAll('.choice.correct-choice').length,
      flagged: document.querySelectorAll('.question-card.flag-correct, .question-card.flag-wrong, .question-card.flag-unanswered').length
    };
  });
  ok(practiceDl.gotFile, 'a practice result does download');
  eq(practiceDl.marked, 0, 'without marking the correct choice on the paper');
  eq(practiceDl.flagged, 0, 'and without flagging any card right, wrong or unanswered');

  console.log('\n=== 8. No page errors ===');
  ok(errs.length === 0, errs.length ? errs.join(' | ') : 'none');

  await browser.close();
  server.close();
  await pool.end();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
