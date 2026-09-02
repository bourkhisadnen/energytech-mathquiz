/* The trainee's own results, in a real browser.
 *
 * The backend rules are covered by test_my_history.js. This covers what the
 * trainee actually sees: that the panel is below the session code, that the
 * list is the simple three-column one and not the instructor's, that the whole
 * row opens the attempt, and that the answers shown are the real ones from the
 * question bank rather than anything this file invented. */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8902/energytech-mathquiz/index.html';

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };

const lessons = [
  { lesson: '1-1.1', correct: 2, total: 9, percent: 22 },
  { lesson: '1-10.1', correct: 5, total: 11, percent: 45 },
  { lesson: '1-2.3', correct: 8, total: 10, percent: 80 },
  { lesson: '3-1.2', correct: 6, total: 6, percent: 100 }
];
// Two on the same day, one on its own: enough to test when the time is shown.
const attempts = [
  { attemptId: 'A3', timestamp: '2026-08-22T09:15:00Z', sessionCode: 'G1-4826', sessionName: 'Week 5 assessment', mode: 'assessment', questionSet: 'Chapter 03 — Version B', questionSetKey: 'ch03:version_b', seed: '333', questionCount: 5, orderMode: 'original', score: 3, total: 5, percent: 60, registered: 'yes' },
  { attemptId: 'A2b', timestamp: '2026-08-15T13:40:00Z', sessionCode: 'G1-2299', sessionName: 'Week 3 retake', mode: 'practice', questionSet: 'Chapters 01 & 02 — Lessons 1-1.1, 1-1.2', questionSetKey: 'ch12:original_pdf', seed: '444', questionCount: 5, orderMode: 'original', score: 5, total: 5, percent: 100, registered: 'yes' },
  { attemptId: 'A2', timestamp: '2026-08-15T10:00:00Z', sessionCode: 'G1-2213', sessionName: 'Week 3 practice', mode: 'practice', questionSet: 'Chapters 01 & 02 — Original worksheet', questionSetKey: 'ch12:original_pdf', seed: '222', questionCount: 5, orderMode: 'original', score: 4, total: 5, percent: 80, registered: 'yes' },
  { attemptId: 'A1', timestamp: '2026-08-08T08:30:00Z', sessionCode: 'G1-1101', sessionName: 'Week 1 practice', mode: 'practice', questionSet: 'Chapters 01 & 02 — Original worksheet', questionSetKey: 'ch12:original_pdf', seed: '111', questionCount: 5, orderMode: 'original', score: 2, total: 5, percent: 40, registered: 'walk-in' },
  // Left at the name the app suggests, which is the content label itself. This
  // is the common case -- the instructor never typed anything -- and it must
  // not print the same words twice.
  { attemptId: 'A0', timestamp: '2026-08-01T08:30:00Z', sessionCode: 'G1-1001', sessionName: 'Chapters 01 & 02 — Original worksheet', mode: 'practice', questionSet: 'Chapters 01 & 02 — Original worksheet', questionSetKey: 'ch12:original_pdf', seed: '555', questionCount: 5, orderMode: 'original', score: 1, total: 5, percent: 20, registered: 'yes' }
];

let items = [];
function itemsFromBank(bank) {
  const pattern = ['correct', 'wrong', 'unanswered', 'correct', 'wrong'];
  return bank.map((q, i) => {
    const verdict = pattern[i % pattern.length];
    const wrongPick = ['a', 'b', 'c', 'd'].find(L => L !== q.answer);
    return {
      quizNumber: i + 1, originalNumber: q.original_number, lesson: q.lesson,
      correctAnswer: q.answer,
      answer: verdict === 'correct' ? q.answer : verdict === 'wrong' ? wrongPick : '',
      result: verdict
    };
  });
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 390, height: 1400 } });
  const errs = [], asked = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await p.route(/script\.google\.com/, r => {
    const q = Object.fromEntries(new URL(r.request().url()).searchParams);
    asked.push(q.action);
    let d = { ok: true, message: 'ok' };
    if (q.action === 'trainee_login') d = { ok: true, token: 'TTOK',
      trainee: { energytechId: 'ET1000', name: 'Mohammed Abdullah Saleh Al-Otaibi', intake: 'JAN26', group: 'G1', accountStatus: 'active' } };
    if (q.action === 'my_history') d = { ok: true,
      trainee: { energytechId: 'ET1000', name: 'Mohammed Abdullah Saleh Al-Otaibi', intake: 'JAN26', group: 'G1', accountStatus: 'active' },
      attempts, lessons };
    if (q.action === 'my_attempt') d = { ok: true,
      attempt: Object.assign({ name: 'Mohammed Abdullah Saleh Al-Otaibi' }, attempts[3]), items };
    return r.fulfill({ status: 200, contentType: 'application/javascript', body: q.callback + '(' + JSON.stringify(d) + ');' });
  });

  await p.goto(BASE);
  items = itemsFromBank(await p.evaluate(() => selectQuestionsFor(
    { questionSetKey: 'ch12:original_pdf', questionCount: 5, seed: '111', orderMode: 'original' }
  ).selected.map(q => ({ original_number: q.original_number, lesson: q.lesson, answer: q.answer }))));

  await p.click('#studentModeBtn');
  await p.fill('#traineeLoginId', 'ET1000');
  await p.fill('#traineeLoginPassword', 'secret1');
  await p.click('#traineeLoginBtn');
  await p.waitForSelector('#myHistoryPanel:not([hidden])');
  await p.waitForSelector('.attempt-row');

  console.log('\n=== 1. Where it sits ===');
  const y = await p.evaluate(() => ({
    code: document.getElementById('studentSessionCode').getBoundingClientRect().top,
    hist: document.getElementById('myHistoryPanel').getBoundingClientRect().top
  }));
  ok(y.hist > y.code, 'the record is below the session code, not above it');

  console.log('\n=== 2. Only the trainee\'s own backend route is used ===');
  ok(!asked.includes('trainee_history') && !asked.includes('attempt_detail'),
    'the instructor actions are never called');
  ok(asked.includes('my_history'), 'my_history is');

  console.log('\n=== 3. The list is simple ===');
  const heads = await p.$$eval('.history-table thead th', n => n.map(x => x.textContent.trim()));
  ok(JSON.stringify(heads) === JSON.stringify(['When', 'Quiz', 'Score']),
    `three columns: when, quiz, score (got ${JSON.stringify(heads)})`);
  const body = await p.textContent('#myHistoryBody');
  ok(!/G1-4826|G1-2213|G1-1101/.test(body), 'no session codes, which are join codes and mean nothing afterwards');
  ok(/Week 5 assessment/.test(body) && /Week 3 retake/.test(body),
    'each quiz leads with the name its instructor gave the session');
  ok(/Chapters 01 & 02 — Original worksheet/.test(body), 'with what it covered underneath');
  ok(/Chapter 03 — Version B/.test(body), 'including the Chapter 3 paper');
  const first = await p.$eval('.attempt-row[data-attempt="A3"] td:nth-child(2)', n => n.textContent.replace(/\s+/g, ' ').trim());
  ok(/^Week 5 assessment/.test(first), `the session name comes first (got "${first}")`);

  // A session named after its own content must not print the same line twice.
  const dup = await p.evaluate(() => {
    const tds = [...document.querySelectorAll('.attempt-row td:nth-child(2)')];
    return tds.some(td => {
      const name = td.querySelector('.quiz-name');
      const sub = td.querySelector('.hint');
      return name && sub && name.textContent.trim() === sub.textContent.trim();
    });
  });
  ok(!dup, 'and is never repeated on the line below it');

  console.log('\n=== 4. The time appears only where the date is ambiguous ===');
  const rows = await p.$$eval('.attempt-row', rs => rs.map(r => ({
    date: r.querySelector('.when-date').textContent.trim(),
    time: r.querySelector('.when-time') ? r.querySelector('.when-time').textContent.trim() : ''
  })));
  ok(rows.length === 5, 'five quizzes listed');
  const aug15 = rows.filter(r => /Aug 15/.test(r.date));
  ok(aug15.length === 2 && aug15.every(r => r.time), 'both quizzes on Aug 15 show their time');
  ok(rows.filter(r => !/Aug 15/.test(r.date)).every(r => !r.time),
    'and the days with only one quiz do not');

  console.log('\n=== 5. A guest sitting is flagged ===');
  ok((await p.$$('.attempt-row[data-attempt="A1"] .guest-tag')).length === 1,
    'the walk-in attempt carries a guest tag');
  ok((await p.$$('.attempt-row[data-attempt="A2"] .guest-tag')).length === 0,
    'and their own do not');

  console.log('\n=== 6. It fits a phone ===');
  const fit = await p.evaluate(() => {
    const t = document.querySelector('.history-table');
    const w = t.closest('.table-wrap');
    return { over: Math.round(t.getBoundingClientRect().width - w.getBoundingClientRect().width) };
  });
  ok(fit.over <= 1, `nothing runs off the right-hand edge at 390px (over by ${fit.over}px)`);

  console.log('\n=== 7. The whole row opens the answers ===');
  await p.locator('.attempt-row[data-attempt="A1"] td').first().click();
  await p.waitForSelector('.review-card');
  const cards = await p.$$eval('.review-card', n => n.length);
  const bodies = await p.$$eval('.review-card .q-body', n => n.length);
  ok(cards === 5, 'five questions shown');
  ok(bodies === 5, 'each rebuilt from the stored seed, not just the letters');
  ok((await p.$$('.review-card .is-right')).length === 5, 'the right answer is marked on every one');
  ok(/2 \/ 5/.test(await p.textContent('.attempt-score')), 'with the score at the top');

  console.log('\n=== 8. And back again ===');
  await p.click('.back-to-profile');
  await p.waitForSelector('.attempt-row');
  ok((await p.$$('.attempt-row')).length === 5, 'the list comes back');

  console.log('\n=== 9. No page errors ===');
  ok(errs.length === 0, errs.length ? errs.join(' | ') : 'none');

  await b.close();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})();
