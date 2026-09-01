/* The page a trainee sees while sitting an exam.
 *
 * Two things are being checked. The first is that the screen is cleared to just
 * the paper and a strip saying whose it is. The second matters more: nothing on
 * that screen may hand them the answers -- and one thing used to. */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8902/energytech-mathquiz/index.html';

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const COMMON = {
  intake: 'JAN26', group: 'G1', questionSet: 'Chapters 01 & 02',
  questionSetKey: 'ch12:original_pdf', seed: 'S', questionCount: 4,
  orderMode: 'original', showOriginalNumbers: true, requireAll: true, allowWalkIn: false
};
const EXAM = Object.assign({ sessionCode: 'G1-9001', sessionName: 'Midterm exam',
  mode: 'assessment', shuffleEachLaunch: true }, COMMON);
const PRACTICE = Object.assign({ sessionCode: 'G1-7001', sessionName: 'Week 3 practice',
  mode: 'practice', shuffleEachLaunch: false }, COMMON);

let sat = 0;

function route(p) {
  return p.route(/script\.google\.com/, r => {
    const req = r.request();
    if (req.method() === 'POST') {
      try { if (JSON.parse(req.postData() || '{}').quiz.mode === 'assessment') sat++; } catch { /* */ }
      return r.fulfill({ status: 200, body: 'ok' });
    }
    const q = Object.fromEntries(new URL(req.url()).searchParams);
    let d = { ok: true, message: 'ok' };
    if (q.action === 'session') {
      const s = q.code === 'G1-7001' ? PRACTICE : EXAM;
      d = { ok: true, session: s,
        sitting: q.token ? { sat, allowed: 1, maySit: s.mode === 'assessment' ? sat < 1 : true } : null };
    }
    if (q.action === 'trainee_login') d = { ok: true, token: 'TTOK',
      trainee: { energytechId: 'ET1000', name: 'Mohammed Abdullah Saleh Al-Otaibi',
                 intake: 'JAN26', group: 'G1', accountStatus: 'active' } };
    if (q.action === 'my_history') d = { ok: true,
      trainee: { energytechId: 'ET1000', name: 'Mohammed Abdullah Saleh Al-Otaibi' },
      attempts: [], lessons: [] };
    return r.fulfill({ status: 200, contentType: 'application/javascript', body: q.callback + '(' + JSON.stringify(d) + ');' });
  });
}

const visible = (p, sel) => p.evaluate(s => {
  const el = document.querySelector(s);
  return Boolean(el && el.offsetParent !== null);
}, sel);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await route(p);

  await p.goto(BASE);
  await p.click('#studentModeBtn');
  await p.fill('#traineeLoginId', 'ET1000');
  await p.fill('#traineeLoginPassword', 'x');
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
  await p.waitForTimeout(600);
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
  const practice = await p.evaluate(() => {
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
  ok(practice.gotFile, 'a practice result does download');
  eq(practice.marked, 0, 'without marking the correct choice on the paper');
  eq(practice.flagged, 0, 'and without flagging any card right, wrong or unanswered');

  console.log('\n=== 8. No page errors ===');
  ok(errs.length === 0, errs.length ? errs.join(' | ') : 'none');

  await browser.close();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})();
