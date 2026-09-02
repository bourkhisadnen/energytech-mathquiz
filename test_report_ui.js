/* The report of one session, in a real browser.
 *
 * The arithmetic is the point. A report that quietly counts a retake twice, or
 * puts a 69 in the passes because the colour bands elsewhere in the app start
 * at 50, is worse than no report: it is a wrong number an instructor will act
 * on. So every figure on the page is checked against a hand-worked total, and
 * the order the rows come out in is checked as an order, not as a set. */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8902/energytech-mathquiz/index.html';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

/* Marks out of 100, so 69 and 70 fall either side of the pass mark exactly
 * rather than by rounding.
 *
 * G2 averages 50 and G1 82, so weakest-group-first puts G2 above G1 -- the
 * opposite of alphabetical order, which is the point. With G1 weaker, sorting
 * by name and sorting by mark would produce the same page and neither would be
 * under test. */
const T = (id, name, group, score, sittings) =>
  ({ energytechId: id, name, group, intake: 'JAN26', onRoster: true,
     attemptId: 'A-' + id, timestamp: '2026-03-01T08:00:00Z',
     score, total: 100, percent: score, registered: 'yes', sittingCount: sittings || 1,
     sittings: [] });

/* 299 out of 300 rounds to 100% and is not full marks. The difference only
 * shows if the count comes off the raw score rather than the percentage. */
const NEARLY = Object.assign(T('ET1008', 'Bandar Al-Mutairi', 'G3', 100),
  { score: 299, total: 300, percent: 100 });

const EXAM_TRAINEES = [
  T('ET1002', 'Fahad Al-Qahtani', 'G1', 70),        // exactly the pass mark
  T('ET1001', 'Mohammed Al-Otaibi', 'G1', 69, 2),   // one mark short, and sat twice
  T('ET1003', 'Yousef Al-Harbi', 'G1', 100),        // full marks
  T('ET1006', 'Salem Al-Amri', 'G1', 90),
  T('ET1005', 'Nasser Al-Shehri', 'G2', 60),
  T('ET1004', 'Khalid Al-Dossari', 'G2', 40),
  NEARLY
];

const SESSIONS = [
  { timestamp: '2026-03-01T07:30:00Z', sessionCode: 'G1-9001', sessionName: 'Midterm exam',
    group: 'G1', intake: 'JAN26', mode: 'assessment', questionSet: 'Chapters 01 & 02',
    shuffleEachLaunch: true, published: false, attempts: 6, owner: 'adnen' },
  { timestamp: '2026-02-20T07:30:00Z', sessionCode: 'G1-7001', sessionName: 'Week 3 practice',
    group: 'G1', intake: 'JAN26', mode: 'practice', questionSet: 'Chapters 01 & 02',
    shuffleEachLaunch: false, published: false, attempts: 0, owner: 'adnen' },
  { timestamp: '2026-02-10T07:30:00Z', sessionCode: 'G1-6001', sessionName: 'Broken session',
    group: 'G1', intake: 'JAN26', mode: 'practice', questionSet: 'Chapters 01 & 02',
    shuffleEachLaunch: false, published: false, attempts: 1, owner: 'adnen' }
];

const ITEMS = [
  { quizNumber: 1, originalNumber: 3, lesson: '1-1.1', answer: 'a', correctAnswer: 'a', result: 'correct' },
  { quizNumber: 2, originalNumber: 7, lesson: '1-1.1', answer: 'c', correctAnswer: 'b', result: 'wrong' },
  { quizNumber: 3, originalNumber: 9, lesson: '1-2.3', answer: 'd', correctAnswer: 'd', result: 'correct' },
  { quizNumber: 4, originalNumber: 12, lesson: '1-2.3', answer: '', correctAnswer: 'a', result: 'unanswered' }
];

let reportCalls = [];

function route(p) {
  return p.route(/script\.google\.com/, r => {
    const req = r.request();
    if (req.method() === 'POST') return r.fulfill({ status: 200, body: 'ok' });
    const q = Object.fromEntries(new URL(req.url()).searchParams);
    let d = { ok: true, message: 'ok' };
    if (q.action === 'auth_login') d = { ok: true, token: 'ADMTOK', username: 'adnen',
      displayName: 'Adnane Khalifa', role: 'admin' };
    if (q.action === 'admin_list_instructors') d = { ok: true, instructors: [] };
    if (q.action === 'roster_list') d = { ok: true, intakes: [{ label: 'JAN26', status: 'active' }],
      groups: [{ intake: 'JAN26', name: 'G1', trainees: 5, withAccount: 5 }] };
    if (q.action === 'trainee_list') d = { ok: true, trainees: [] };
    if (q.action === 'session_list') d = { ok: true, sessions: SESSIONS };
    if (q.action === 'session_report') {
      reportCalls.push(q.sessionCode);
      if (q.sessionCode === 'G1-9001') {
        d = { ok: true, session: SESSIONS[0], trainees: EXAM_TRAINEES,
              absent: [{ energytechId: 'ET1007', name: 'Absent Trainee', intake: 'JAN26', group: 'G1' }] };
      } else if (q.sessionCode === 'G1-7001') {
        d = { ok: true, session: SESSIONS[1], trainees: [],
              absent: [{ energytechId: 'ET1007', name: 'Absent Trainee', intake: 'JAN26', group: 'G1' }] };
      } else {
        // The backend refusing must reach the screen, not be swallowed.
        d = { ok: false, error: 'That session belongs to another instructor.' };
      }
    }
    if (q.action === 'attempt_detail') {
      // Answer as the real backend does -- with the paper actually asked for --
      // so a report that opens the wrong trainee's paper shows up as one.
      const who = EXAM_TRAINEES.find(t => t.attemptId === q.attemptId) || EXAM_TRAINEES[0];
      d = { ok: true,
        attempt: { attemptId: q.attemptId, timestamp: '2026-03-01T08:00:00Z',
          name: who.name, group: who.group, energytechId: who.energytechId,
          sessionCode: 'G1-9001', sessionName: 'Midterm exam', mode: 'assessment',
          questionSet: 'Chapters 01 & 02', questionSetKey: 'ch12:original_pdf', seed: 'S',
          questionCount: 4, orderMode: 'original', orderSeed: '',
          score: who.score, total: who.total, percent: who.percent },
        items: ITEMS };
    }
    return r.fulfill({ status: 200, contentType: 'application/javascript',
      body: q.callback + '(' + JSON.stringify(d) + ');' });
  });
}

const visible = (p, sel) => p.evaluate(s => {
  const el = document.querySelector(s);
  return Boolean(el && el.offsetParent !== null);
}, sel);

const textOf = (p, sel) => p.evaluate(s => {
  const el = document.querySelector(s);
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
}, sel);

/* The stat tiles, read as a label -> value map, so a check reads like the tile
 * does rather than like an index into a list. */
const stats = p => p.evaluate(() => {
  const out = {};
  document.querySelectorAll('.report-stats .stat').forEach(s => {
    out[s.querySelector('.stat-label').textContent.trim()] = s.querySelector('.stat-value').textContent.trim();
  });
  return out;
});

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const p = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await route(p);

  await p.goto(BASE);
  await p.click('#teacherModeBtn');
  await p.fill('#teacherLoginUsername', 'adnen');
  await p.fill('#teacherLoginPassword', 'x');
  await p.click('#teacherLoginBtn');
  await p.waitForSelector('#teacherInterface:not([hidden])');
  await p.click('#loadSessionsBtn');
  await p.waitForSelector('.sessions-table');

  console.log('\n=== 1. Every session has a Report button ===');
  eq(await p.$$eval('.open-report', n => n.length), 3, 'one per session');
  eq(await p.$$eval('.open-report', n => n.map(b => b.dataset.code)),
    ['G1-9001', 'G1-7001', 'G1-6001'], 'and each carries its own code');
  // Releasing is an exam-only idea; reporting is not. An instructor wants to
  // know how a practice quiz went just as much.
  ok(await p.$('tr:has(.mode-pill.practice) .open-report'), 'a practice session has one too');
  ok(await p.$('tr:has(.mode-pill.assessment) .open-report'), 'and so does an exam');
  eq(await p.$$eval('tr:has(.mode-pill.practice) .publish-session', n => n.length), 0,
    'while Release results stays exam-only');

  console.log('\n=== 2. Opening one replaces the list ===');
  await p.click('.open-report[data-code="G1-9001"]');
  await p.waitForSelector('.report-table');
  ok(!(await visible(p, '#sessionsWorkspace')), 'the sessions list is out of the way');
  ok(await visible(p, '#sessionReportView'), 'and the report has the panel');
  ok(await p.evaluate(() => document.body.classList.contains('report-open')),
    'the body is marked report-open, which is what the print stylesheet keys on');
  const head = await textOf(p, '.report-head');
  ok(/Midterm exam/.test(head), 'the session is named');
  ok(/G1-9001/.test(head) && /JAN26 \/ G1/.test(head), 'with its code and where it ran');
  ok(/ASSESSMENT/.test(head), 'and its mode');

  console.log('\n=== 3. The overall figures ===');
  // 70 + 69 + 100 + 90 + 60 + 40 + 100 = 529 over seven papers = 75.57, so 76.
  const s = await stats(p);
  eq(s['sat it'], '7', 'seven sat it');
  eq(s['average'], '76%', 'the average is the mean of the seven marks');
  // Only ET1003 scored every mark. ET1008 is 299 of 300, which prints as 100%.
  eq(s['full marks'], '1', 'one full mark, counted off the score and not the percentage');
  eq(s['passed'], '4', 'four passed');
  eq(s['below 70%'], '3', 'and three did not');
  const range = await textOf(p, '.report-range');
  ok(/Highest 100%/.test(range) && /lowest 40%/.test(range), 'the range is stated');
  ok(/pass is 70%/.test(range), 'and so is where the line is');

  console.log('\n=== 4. 70 is the pass mark, not the 80/50 used elsewhere ===');
  // The trainee on 69 and the trainee on 70 are one mark apart and must fall on
  // opposite sides. Under the app's other bands both would be amber "warn".
  const band = id => p.evaluate(x => {
    const row = [...document.querySelectorAll('.report-table tr')].find(r => r.textContent.includes(x));
    const el = row && row.querySelector('.score-cell strong');
    return el ? el.className : null;
  }, id);
  eq(await band('ET1002'), 'good-text', '70% is a pass');
  eq(await band('ET1001'), 'bad-text', '69% is not');
  eq(await band('ET1006'), 'good-text', '90% is a pass');
  eq(await band('ET1005'), 'bad-text', 'and 60% is not');

  console.log('\n=== 5. Groups, weakest first ===');
  // G2 averages 50, G1 82, G3 100 -- so the order is G2, G1, G3, which is not
  // the order their names would give.
  eq(await p.$$eval('.report-group .group-th', n => n.map(h => h.textContent.trim().split(/\s+/).slice(0, 2).join(' '))),
    ['Group G2', 'Group G1', 'Group G3'], 'the weakest group is reported first, the strongest last');
  const worst = await textOf(p, '.report-group:first-of-type .group-th');
  ok(/2 sat/.test(worst), 'each group heading counts its own');
  ok(/average 50%/.test(worst), 'and averages only its own marks');
  ok(/2 below 70%/.test(worst), 'and counts its own failures');
  // Printed, a group can run over a page break. The name is in the table head
  // because that is what browsers repeat at the top of the next page; put it in
  // a heading above the table and page two is a list of names under nothing.
  eq(await p.$$eval('.report-table thead .group-th', n => n.length), 3,
    'every group name sits in the table head, where print will repeat it');

  console.log('\n=== 6. Worst to best inside each group ===');
  const order = g => p.$$eval(`.report-group:nth-of-type(${g}) .report-table tbody tr`,
    rows => rows.map(r => r.querySelector('.mono').textContent.trim()));
  eq(await order(1), ['ET1004', 'ET1005'], 'G2 runs 40 then 60');
  eq(await order(2), ['ET1001', 'ET1002', 'ET1006', 'ET1003'], 'and G1 runs 69, 70, 90, 100');
  eq(await p.$$eval('.report-group:nth-of-type(2) .rank-col', n => n.slice(1).map(c => c.textContent.trim())),
    ['1', '2', '3', '4'], 'and they are numbered in that order');

  console.log('\n=== 7. A trainee who sat twice is one trainee ===');
  eq(await p.$$eval('.report-table tbody tr', n => n.length), 7, 'seven rows for seven trainees');
  const resat = await p.evaluate(() => {
    const row = [...document.querySelectorAll('.report-table tr')].find(r => r.textContent.includes('ET1001'));
    return { tag: row.querySelector('.resat-tag') ? row.querySelector('.resat-tag').textContent.trim() : null };
  });
  eq(resat.tag, 'sitting 2', 'and the one who sat twice says so on their row');
  eq(await p.$$eval('.resat-tag', n => n.length), 1, 'nobody else is tagged');

  console.log('\n=== 8. Who did not sit it ===');
  const absent = await textOf(p, '.report-absent');
  ok(/Absent Trainee/.test(absent), 'the trainee who never turned up is named');
  ok(/ET1007/.test(absent), 'with their ID');

  console.log('\n=== 9. An exam still held back says so ===');
  const held = await textOf(p, '.report-held');
  ok(/not visible to the trainees/i.test(held || ''), 'the instructor is reminded the marks are not out');
  ok(/Held back/.test(head), 'and the header carries the same tag as the sessions list');

  console.log('\n=== 10. Opening one trainee\'s paper ===');
  await p.click('.report-table tbody tr:first-child .open-attempt');
  await p.waitForSelector('.review-list');
  eq(await p.$$eval('.review-card', n => n.length), 4, 'every question is shown');
  eq(await p.$$eval('.review-card.correct', n => n.length), 2, 'two right');
  eq(await p.$$eval('.review-card.wrong', n => n.length), 1, 'one wrong');
  eq(await p.$$eval('.review-card.skipped', n => n.length), 1, 'and one not answered');
  // Both halves of "what they put and what it should have been" have to be on
  // the page, or the review is only half a review.
  eq(await p.$$eval('.choice.is-right', n => n.length), 4, 'the correct choice is marked on every card');
  eq(await p.$$eval('.choice.is-picked-wrong', n => n.length), 1, 'and the wrong one they picked is marked as theirs');
  // The first row of the first group is the weakest trainee in the weakest
  // group. Printed, a paper with no name on it is no use to anybody.
  const paper = await textOf(p, '.profile-head') || '';
  ok(/Khalid Al-Dossari/.test(paper), 'the paper says whose it is');
  ok(/ET1004/.test(paper), 'with their ID, and it is the trainee whose row was clicked');

  console.log('\n=== 11. Back from a paper returns to the report ===');
  // Not to a trainee profile: the instructor never opened one, and landing
  // somewhere they did not come from is how a Back button loses their place.
  await p.click('.back-to-profile');
  await p.waitForSelector('.report-table');
  ok(await visible(p, '.report-stats'), 'the figures are back');
  eq(await p.$$eval('.report-table tbody tr', n => n.length), 7, 'and so is every row');
  eq(reportCalls.filter(c => c === 'G1-9001').length, 1,
    'without asking the backend again -- the report was still in hand');

  console.log('\n=== 12. Back to the sessions list ===');
  await p.click('#reportBackBtn');
  await p.waitForSelector('.sessions-table');
  ok(await visible(p, '#sessionsWorkspace'), 'the list is back');
  ok(!(await visible(p, '#sessionReportView')), 'and the report is put away');
  ok(!(await p.evaluate(() => document.body.classList.contains('report-open'))),
    'and the print marker is cleared, so printing prints the page again');

  console.log('\n=== 13. A session nobody has sat ===');
  await p.click('.open-report[data-code="G1-7001"]');
  await p.waitForSelector('#sessionReportBody .pane-empty');
  ok(/nothing to report/i.test(await textOf(p, '#sessionReportBody .pane-empty')),
    'it says so plainly');
  eq(await p.$$eval('.report-stats', n => n.length), 0, 'with no figures invented to fill the space');
  ok(/Absent Trainee/.test(await textOf(p, '.report-absent') || ''),
    'but the group is still listed as not having sat it');

  console.log('\n=== 14. A refusal reaches the screen ===');
  await p.click('#reportBackBtn');
  await p.waitForSelector('.sessions-table');
  await p.click('.open-report[data-code="G1-6001"]');
  await p.waitForSelector('#sessionReportBody .feedback.bad');
  ok(/another instructor/i.test(await textOf(p, '#sessionReportBody .feedback.bad')),
    'the reason the backend gave is the reason shown');

  console.log('\n=== 15. Printed, the report is the whole page ===');
  // The print stylesheet is code like any other, and it broke once already: a
  // rule that hid "the last header cell" to drop the See-answers column also
  // hit each group's heading, because that heading is a single cell spanning
  // the table and is therefore last in its own row.
  await p.click('#reportBackBtn');
  await p.waitForSelector('.sessions-table');
  await p.click('.open-report[data-code="G1-9001"]');
  await p.waitForSelector('.report-table');
  await p.emulateMedia({ media: 'print' });
  ok(!(await visible(p, '.app-header')), 'the app header does not print');
  ok(!(await visible(p, '#sessionsWorkspace')), 'nor the sessions list behind it');
  ok(!(await visible(p, '.report-crumbs')), 'nor the Back and Print buttons');
  ok(!(await visible(p, '.report-table .row-actions')), 'nor the See answers column');
  ok(await visible(p, '.report-stats'), 'the figures do print');
  ok(await visible(p, '.report-table'), 'and so does every group table');
  eq(await p.$$eval('.report-table thead .group-th', n => n.filter(e => e.offsetParent !== null).length), 3,
    'each still saying which group it is');
  await p.emulateMedia({ media: 'screen' });
  ok(await visible(p, '.report-crumbs'), 'and the buttons come back on screen');

  console.log('\n=== 16. No page errors ===');
  ok(errs.length === 0, errs.length ? errs.join(' | ') : 'none');

  await browser.close();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})();
