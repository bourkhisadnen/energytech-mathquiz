/* Clicking a trainee's name opens their record; clicking an attempt in it shows
 * that paper back question by question, the way they saw it on submitting. */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8902/energytech-mathquiz/index.html';
let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };

const lessons = [
  { lesson: '1-1.1', correct: 2, total: 9, percent: 22 },
  { lesson: '1-10.1', correct: 5, total: 11, percent: 45 },
  { lesson: '3-2.3', correct: 7, total: 12, percent: 58 },
  { lesson: '1-2.3', correct: 8, total: 10, percent: 80 },
  { lesson: '3-1.2', correct: 6, total: 6, percent: 100 }
];
const attempts = [
  { attemptId: 'A3', timestamp: '2026-08-22T09:15:00Z', sessionCode: 'G1-4826', sessionName: 'Week 5 assessment', mode: 'assessment', questionSet: 'Chapter 03 · Version B', questionSetKey: 'ch03:version_b', seed: '333', questionCount: 5, orderMode: 'original', score: 3, total: 5, percent: 60 },
  { attemptId: 'A2', timestamp: '2026-08-15T10:00:00Z', sessionCode: 'G1-2213', sessionName: 'Week 3 practice', mode: 'practice', questionSet: 'Chapters 01 & 02', questionSetKey: 'ch12:original_pdf', seed: '222', questionCount: 5, orderMode: 'original', score: 4, total: 5, percent: 80 },
  { attemptId: 'A1', timestamp: '2026-08-08T08:30:00Z', sessionCode: 'G1-1101', sessionName: 'Week 1 practice', mode: 'practice', questionSet: 'Chapters 01 & 02', questionSetKey: 'ch12:original_pdf', seed: '111', questionCount: 5, orderMode: 'original', score: 2, total: 5, percent: 40 }
];
const items = [
  { quizNumber: 1, originalNumber: 1, lesson: '1-1.1', answer: 'b', correctAnswer: 'b', result: 'correct' },
  { quizNumber: 2, originalNumber: 2, lesson: '1-1.1', answer: 'a', correctAnswer: 'c', result: 'wrong' },
  { quizNumber: 3, originalNumber: 3, lesson: '1-1.1', answer: '', correctAnswer: 'd', result: 'unanswered' },
  { quizNumber: 4, originalNumber: 4, lesson: '1-1.1', answer: 'd', correctAnswer: 'd', result: 'correct' },
  { quizNumber: 5, originalNumber: 5, lesson: '1-1.2', answer: 'a', correctAnswer: 'b', result: 'wrong' }
];
const TRAINEE = { energytechId: 'ET1000', name: 'Mohammed Abdullah Saleh Al-Otaibi', intake: 'JAN26', group: 'G1', accountStatus: 'active' };
const NEWBIE = { energytechId: 'ET1001', name: 'Fahad Al-Qahtani', intake: 'JAN26', group: 'G1', accountStatus: 'none' };

let mismatch = false;      // force the rebuild to disagree with the stored items

function reply(q) {
  if (q.action === 'auth_login') return { ok: true, token: 'T', username: 'adnen', displayName: 'Adnane Khalifa', role: 'admin' };
  if (q.action === 'roster_list') return { ok: true, intakes: [{ label: 'JAN26', status: 'active' }], groups: [{ intake: 'JAN26', name: 'G1', trainees: 2, withAccount: 1 }] };
  if (q.action === 'trainee_list') return { ok: true, trainees: [TRAINEE, NEWBIE] };
  if (q.action === 'trainee_history') {
    return q.energytechId === 'ET1000'
      ? { ok: true, trainee: TRAINEE, attempts, lessons }
      : { ok: true, trainee: NEWBIE, attempts: [], lessons: [] };
  }
  if (q.action === 'attempt_detail') {
    const a = attempts.find(x => x.attemptId === q.attemptId);
    // A count that does not match the stored items is what a changed question
    // bank looks like from here.
    return { ok: true, attempt: Object.assign({ name: TRAINEE.name }, a, mismatch ? { questionCount: 3 } : {}), items };
  }
  return { ok: true, message: 'ok' };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(/script\.google\.com/, r => {
    const q = Object.fromEntries(new URL(r.request().url()).searchParams);
    return r.fulfill({ status: 200, contentType: 'application/javascript', body: `${q.callback}(${JSON.stringify(reply(q))});` });
  });
  await page.goto(BASE);
  await page.click('#teacherModeBtn');
  await page.fill('#teacherLoginUsername', 'adnen');
  await page.fill('#teacherLoginPassword', 'x');
  await page.click('#teacherLoginBtn');
  await page.waitForSelector('#teacherInterface:not([hidden])');
  await page.waitForSelector('.pane-item[data-intake="JAN26"]');
  await page.click('.pane-item[data-intake="JAN26"]');
  await page.click('.pane-item[data-group="G1"]');
  await page.waitForSelector('.roster-table tbody tr');

  console.log('\n=== 1. The name is the way in ===');
  ok(await page.isVisible('.open-profile[data-id="ET1000"]'), 'the trainee name is a button');
  await page.click('.open-profile[data-id="ET1000"]');
  await page.waitForSelector('#traineeProfileView:not([hidden])');
  // The pane is unhidden before the record has been fetched, so waiting on the
  // container alone reads a half-drawn profile: an empty crumb and no stat
  // tiles. Wait for the record itself to land.
  await page.waitForSelector('#profileBody .stat');
  ok(await page.isHidden('#rosterWorkspace'), 'the roster panes give way to the profile');
  ok(/Mohammed Abdullah Saleh Al-Otaibi/.test(await page.textContent('#profileCrumb')), 'the breadcrumb names them');

  console.log('\n=== 2. The figures at the top ===');
  const stats = await page.$$eval('.stat', n => n.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  ok(/^3\s*quiz/i.test(stats[0]), `three quizzes taken (${stats[0]})`);
  ok(/^60%\s*average/i.test(stats[1]), `average of the three percentages (${stats[1]})`);
  ok(/^80%\s*best/i.test(stats[2]), `best score (${stats[2]})`);
  ok(/^48\s*questions/i.test(stats[3]), `questions answered, summed from the lessons (${stats[3]})`);

  console.log('\n=== 3. Weakest lessons, worst first ===');
  const bars = await page.$$eval('.lesson-bars li .lesson-name', n => n.map(x => x.textContent.trim()));
  ok(bars[0] === 'Lesson 1-1.1', `the worst lesson leads (${bars[0]})`);
  ok(bars.join('|') === 'Lesson 1-1.1|Lesson 1-10.1|Lesson 3-2.3|Lesson 1-2.3', `ranked by percentage (${bars.join(', ')})`);
  ok(!bars.includes('Lesson 3-1.2'), 'a lesson they get right every time is not listed as weak');
  const worst = await page.textContent('.lesson-bars li:first-child');
  ok(/22%/.test(worst) && /2 of 9/.test(worst), 'each shows the percentage and the counts');

  console.log('\n=== 4. History, newest first ===');
  const rows = await page.$$eval('.history-table tbody tr', n => n.map(x => x.textContent.replace(/\s+/g, ' ')));
  ok(rows.length === 3, `three attempts listed (${rows.length})`);
  ok(/Week 5 assessment/.test(rows[0]) && /Week 1 practice/.test(rows[2]), 'newest at the top');
  ok(/G1-4826/.test(rows[0]), 'the session code is shown');
  ok(/ASSESSMENT/.test(rows[0]) && /PRACTICE/.test(rows[1]), 'and the mode');
  ok(/3 \/ 5/.test(rows[0]) && /60%/.test(rows[0]), 'with the score both ways');

  console.log('\n=== 5. One attempt, question by question ===');
  await page.click('.open-attempt[data-attempt="A1"]');
  await page.waitForSelector('.review-card');
  const cards = await page.$$('.review-card');
  ok(cards.length === 5, `five questions shown (${cards.length})`);
  ok((await page.$$('.review-card.correct')).length === 2, 'two marked correct');
  ok((await page.$$('.review-card.wrong')).length === 2, 'two marked wrong');
  ok((await page.$$('.review-card.skipped')).length === 1, 'one marked not answered');
  ok((await page.$$eval('.review-card .q-body', n => n.length)) === 5, 'every card shows the real question, rebuilt from the seed');
  const q2 = await page.textContent('.review-card:nth-child(2)');
  ok(/Original Q2/.test(q2), 'the original question number is carried');
  ok((await page.$$('.review-card:nth-child(2) .is-right')).length === 1, 'the right answer is marked on a wrong question');
  ok((await page.$$('.review-card:nth-child(2) .is-picked-wrong')).length === 1, 'and so is what they actually picked');
  ok((await page.$$('.review-card:nth-child(3) .is-picked-wrong')).length === 0, 'an unanswered question marks nothing as picked');
  ok((await page.$$('.review-card:nth-child(3) .is-right')).length === 1, 'but still shows the right answer');
  ok(/2 \/ 5/.test(await page.textContent('.attempt-score')), 'the score is repeated at the top');

  console.log('\n=== 6. Getting back out ===');
  await page.click('.back-to-profile');
  await page.waitForSelector('.lesson-bars');
  ok(true, 'back returns to the profile');
  await page.click('#profileBackBtn');
  await page.waitForSelector('#rosterWorkspace:not([hidden])');
  ok(await page.isHidden('#traineeProfileView'), 'and back again returns to the roster');
  ok(await page.isVisible('.roster-table tbody tr'), 'with the group still open');

  console.log('\n=== 7. A trainee who has not sat anything ===');
  await page.click('.open-profile[data-id="ET1001"]');
  await page.waitForSelector('#traineeProfileView:not([hidden])');
  await page.waitForFunction(() => /Fahad/.test(document.querySelector('#profileCrumb').textContent));
  const empty = await page.textContent('#profileBody');
  ok(/has not sat a quiz yet/.test(empty), 'the history says so plainly');
  ok(/nothing to analyse/.test(empty), 'and so does the lesson section');
  ok(/—/.test(await page.textContent('.stat:nth-child(2)')), 'the average shows a dash rather than 0%');

  console.log('\n=== 8. When the questions cannot be rebuilt ===');
  await page.click('#profileBackBtn');
  await page.waitForSelector('#rosterWorkspace:not([hidden])');
  mismatch = true;
  await page.click('.open-profile[data-id="ET1000"]');
  await page.waitForSelector('.history-table');
  await page.click('.open-attempt[data-attempt="A1"]');
  await page.waitForSelector('.review-card');
  const warned = await page.textContent('#profileBody');
  ok(/could not be rebuilt/.test(warned), 'it says the paper could not be rebuilt');
  ok((await page.$$eval('.review-card .q-body', n => n.length)) === 0, 'and shows no question text rather than the wrong text');
  ok(/Answered/.test(warned), 'falling back to the letters that were recorded');
  ok((await page.$$('.review-card')).length === 5, 'all five answers are still listed');

  console.log('\n=== 9. No page errors ===');
  ok(errors.length === 0, 'none' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));

  await browser.close();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
