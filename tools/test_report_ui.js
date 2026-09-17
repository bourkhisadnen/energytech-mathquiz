/* The report of one session, in a real browser against the REAL
 * energytech-api backend (Express + Postgres) -- repointed for Phase 6 from
 * the mocked-Apps-Script version this file used to be. See test_roster.js's
 * header for the shared mechanics (served from public/ via src/app.js,
 * seeded/asserted through TEST_DATABASE_URL, never DATABASE_URL).
 *
 * The arithmetic is the point. A report that quietly counts a retake twice, or
 * puts a 69 in the passes because the colour bands elsewhere in the app start
 * at 50, is worse than no report: it is a wrong number an instructor will act
 * on. So every figure on the page is checked against a hand-worked total, and
 * the order the rows come out in is checked as an order, not as a set.
 *
 * This is a straight repoint, not a rewrite, except for one thing the mock
 * could get away with that a real backend cannot: session_list only ever
 * returns the CALLING instructor's own sessions (src/actions/sessions.js),
 * so a session owned by someone else can never appear in the list to click.
 * The mock had all three sessions -- including the one it refused to open --
 * owned by the same instructor, standing in for some other kind of failure.
 * Here "belongs to another instructor" is tested the way it actually happens:
 * a session genuinely owned by a second instructor, opened directly by code
 * rather than by clicking a row that was never listed. Everything else --
 * every score, every ordering, every selector -- is unchanged. */

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

let BASE, API_URL;
async function api(action, params, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify({ action, ...params }) });
  return res.json();
}

// A minimal legal attempts row (see tests/helpers/db.js's own insertAttempt),
// but with the score, group and sitting this report's arithmetic depends on.
// trainee_id is left NULL throughout -- onRoster and the roster name/group
// come from a LEFT JOIN on energytech_id (src/actions/reports.js), not from
// this column, so there is nothing to resolve and no FK/uniqueness to manage
// for a trainee who sat twice.
let attemptSeq = 0;
async function insertReportAttempt({
  sessionCode, sessionName, owner, name, energytechId, groupId, groupName, intakeId,
  mode = 'assessment', score, total, submittedAt, sittingNumber = 1,
}) {
  const attemptId = `ATT-${++attemptSeq}-${energytechId}`;
  await pool.query(
    `INSERT INTO attempts
       (attempt_id, session_code, session_name, owner_username, owner_display_name,
        name, energytech_id, registered, sitting_number, group_id, group_name, intake_id,
        mode, question_set, question_set_key, question_count, seed, order_mode,
        score, total, submitted_at)
     VALUES ($1,$2,$3,$4,$4,
             $5,$6,TRUE,$7,$8,$9,$10,
             $11,'Chapters 01 & 02','ch12:original_pdf',4,1,'original',
             $12,$13,$14)`,
    [attemptId, sessionCode, sessionName, owner,
     name, energytechId, sittingNumber, groupId, groupName, intakeId,
     mode, score, total, submittedAt]
  );
  return attemptId;
}

async function insertItemResponse(attemptId, { sessionCode, sessionName, owner, name, energytechId, groupName, mode }, item) {
  await pool.query(
    `INSERT INTO item_responses
       (attempt_id, quiz_question, original_question, lesson, session_code, session_name,
        owner_username, owner_display_name, name, energytech_id, group_name, mode,
        question_set, question_set_key, seed, chosen, correct_letter, is_correct)
     VALUES ($1,$2,$3,$4,$5,$6,
             $7,$7,$8,$9,$10,$11,
             'Chapters 01 & 02','ch12:original_pdf',1,$12,$13,$14)`,
    [attemptId, item.quizNumber, item.originalNumber, item.lesson, sessionCode, sessionName,
     owner, name, energytechId, groupName, mode,
     item.chosen || null, item.correctLetter, item.isCorrect]
  );
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
  await resetDb();

  const adnenPw = await hashPasswordForStorage('x');
  await insertInstructor({ username: 'adnen', displayName: 'Adnane Khalifa', role: 'instructor',
    passwordHash: adnenPw.passwordHash, passwordSalt: adnenPw.passwordSalt, passwordAlgo: adnenPw.passwordAlgo });
  await insertInstructor({ username: 'sara', displayName: 'Sara', role: 'instructor' });
  const adnenToken = await issueInstructorToken('adnen');
  const saraToken = await issueInstructorToken('sara');

  const intakeId = await insertIntake('JAN26');
  const g1 = await insertGroup(intakeId, 'G1');
  const g2 = await insertGroup(intakeId, 'G2');
  const g3 = await insertGroup(intakeId, 'G3');
  const rosterOf = { G1: g1, G2: g2, G3: g3 };
  // The seven who sat it, plus the one who did not (ET1007) -- all on the
  // roster, so onRoster is true for every row and the absent list has someone
  // to name. accountStatus/password do not matter: only the instructor UI is
  // under test here.
  for (const [id, name, group] of [
    ['ET1002', 'Fahad Al-Qahtani', 'G1'], ['ET1001', 'Mohammed Al-Otaibi', 'G1'],
    ['ET1003', 'Yousef Al-Harbi', 'G1'], ['ET1006', 'Salem Al-Amri', 'G1'],
    ['ET1005', 'Nasser Al-Shehri', 'G2'], ['ET1004', 'Khalid Al-Dossari', 'G2'],
    ['ET1008', 'Bandar Al-Mutairi', 'G3'], ['ET1007', 'Absent Trainee', 'G1'],
  ]) {
    await insertTrainee({ energytechId: id, name, intakeId, groupId: rosterOf[group], accountStatus: 'none' });
  }

  const server = app.listen(0);
  const { port } = server.address();
  BASE = `http://127.0.0.1:${port}/index.html`;
  API_URL = `http://127.0.0.1:${port}/api/call`;

  // Created before the exam, so the exam -- the more recently saved of the
  // two -- is the one session_list's created_at DESC puts first (step 1).
  const createdPractice = await api('quiz_session', {
    sessionCode: 'G1-7001', sessionName: 'Week 3 practice', intake: 'JAN26', group: 'G1',
    mode: 'practice', questionSet: 'Chapters 01 & 02', questionSetKey: 'ch12:original_pdf',
    seed: 'S', questionCount: 4, orderMode: 'original', showOriginalNumbers: true,
    requireAll: true, allowWalkIn: false, shuffleEachLaunch: false,
  }, adnenToken);
  if (!createdPractice.ok) { console.error('FATAL: could not create the practice session', createdPractice); process.exit(1); }
  const created = await api('quiz_session', {
    sessionCode: 'G1-9001', sessionName: 'Midterm exam', intake: 'JAN26', group: 'G1',
    mode: 'assessment', questionSet: 'Chapters 01 & 02', questionSetKey: 'ch12:original_pdf',
    seed: 'S', questionCount: 4, orderMode: 'original', showOriginalNumbers: true,
    requireAll: true, allowWalkIn: false, shuffleEachLaunch: true,
  }, adnenToken);
  if (!created.ok) { console.error('FATAL: could not create the exam session', created); process.exit(1); }
  // Owned by a different instructor -- never listed for adnen, opened by code
  // in step 14 to prove the refusal itself, not the list, is what is real here.
  const createdBroken = await api('quiz_session', {
    sessionCode: 'G1-6001', sessionName: 'Broken session', intake: 'JAN26', group: 'G1',
    mode: 'practice', questionSet: 'Chapters 01 & 02', questionSetKey: 'ch12:original_pdf',
    seed: 'S', questionCount: 4, orderMode: 'original', showOriginalNumbers: true,
    requireAll: true, allowWalkIn: false, shuffleEachLaunch: false,
  }, saraToken);
  if (!createdBroken.ok) { console.error('FATAL: could not create the broken session', createdBroken); process.exit(1); }

  // Marks out of 100, so 69 and 70 fall either side of the pass mark exactly
  // rather than by rounding. Percents, and so the whole report's arithmetic,
  // match the original mocked figures: 70+69+100+90+60+40+100 = 529 over
  // seven papers = 75.57, so 76; G2 (40,60) averages 50, G1 (69,70,90,100)
  // averages 82, G3 (299/300 -> 100%) averages 100.
  const T0 = new Date('2026-03-01T08:00:00Z').getTime();
  const at = (mins) => new Date(T0 + mins * 60000);
  const base = { sessionCode: 'G1-9001', sessionName: 'Midterm exam', owner: 'adnen', intakeId, mode: 'assessment' };

  await insertReportAttempt({ ...base, name: 'Fahad Al-Qahtani', energytechId: 'ET1002', groupId: g1, groupName: 'G1', score: 70, total: 100, submittedAt: at(0) });
  // ET1001 sat twice: an earlier sitting that is not the one shown, and the
  // real (later) one at 69 -- one mark short of the pass mark.
  await insertReportAttempt({ ...base, name: 'Mohammed Al-Otaibi', energytechId: 'ET1001', groupId: g1, groupName: 'G1', score: 50, total: 100, submittedAt: at(-30), sittingNumber: 1 });
  const et1001Attempt = await insertReportAttempt({ ...base, name: 'Mohammed Al-Otaibi', energytechId: 'ET1001', groupId: g1, groupName: 'G1', score: 69, total: 100, submittedAt: at(1), sittingNumber: 2 });
  await insertReportAttempt({ ...base, name: 'Yousef Al-Harbi', energytechId: 'ET1003', groupId: g1, groupName: 'G1', score: 100, total: 100, submittedAt: at(2) });
  await insertReportAttempt({ ...base, name: 'Salem Al-Amri', energytechId: 'ET1006', groupId: g1, groupName: 'G1', score: 90, total: 100, submittedAt: at(3) });
  await insertReportAttempt({ ...base, name: 'Nasser Al-Shehri', energytechId: 'ET1005', groupId: g2, groupName: 'G2', score: 60, total: 100, submittedAt: at(4) });
  // The weakest trainee in the weakest group: G2's row-1 (see order() in step
  // 6), and so the one whose paper step 10 opens.
  const et1004Attempt = await insertReportAttempt({ ...base, name: 'Khalid Al-Dossari', energytechId: 'ET1004', groupId: g2, groupName: 'G2', score: 40, total: 100, submittedAt: at(5) });
  // 299 out of 300 rounds to 100% and is not full marks. The difference only
  // shows if the count comes off the raw score rather than the percentage.
  await insertReportAttempt({ ...base, name: 'Bandar Al-Mutairi', energytechId: 'ET1008', groupId: g3, groupName: 'G3', score: 299, total: 300, submittedAt: at(6) });
  void et1001Attempt;

  // The paper behind ET1004's row: two right, one wrong, one skipped.
  const et1004Ctx = { sessionCode: 'G1-9001', sessionName: 'Midterm exam', owner: 'adnen',
    name: 'Khalid Al-Dossari', energytechId: 'ET1004', groupName: 'G2', mode: 'assessment' };
  await insertItemResponse(et1004Attempt, et1004Ctx, { quizNumber: 1, originalNumber: 3, lesson: '1-1.1', chosen: 'a', correctLetter: 'a', isCorrect: true });
  await insertItemResponse(et1004Attempt, et1004Ctx, { quizNumber: 2, originalNumber: 7, lesson: '1-1.1', chosen: 'c', correctLetter: 'b', isCorrect: false });
  await insertItemResponse(et1004Attempt, et1004Ctx, { quizNumber: 3, originalNumber: 9, lesson: '1-2.3', chosen: 'd', correctLetter: 'd', isCorrect: true });
  await insertItemResponse(et1004Attempt, et1004Ctx, { quizNumber: 4, originalNumber: 12, lesson: '1-2.3', chosen: null, correctLetter: 'a', isCorrect: false });

  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  // Real requests still go to the real server (route.continue()); this only
  // watches for how often session_report is asked for a given code, standing
  // in for the mock's reportCalls array.
  const apiCalls = [];
  await p.route('**/api/call', async route => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch { /* not JSON */ }
    apiCalls.push(body.action + (body.sessionCode ? ':' + body.sessionCode : ''));
    await route.continue();
  });

  await p.goto(BASE);
  await p.click('#teacherModeBtn');
  await p.fill('#teacherLoginUsername', 'adnen');
  await p.fill('#teacherLoginPassword', 'x');
  await p.click('#teacherLoginBtn');
  await p.waitForSelector('#teacherInterface:not([hidden])');
  await p.click('#loadSessionsBtn');
  await p.waitForSelector('.sessions-table');

  console.log('\n=== 1. Every session adnen owns has a Report button ===');
  // G1-6001 belongs to sara and is never listed for adnen -- see this file's
  // header for why that, not a third row, is the real-backend equivalent.
  eq(await p.$$eval('.open-report', n => n.length), 2, 'one per session adnen owns');
  eq(await p.$$eval('.open-report', n => n.map(b => b.dataset.code)),
    ['G1-9001', 'G1-7001'], 'and each carries its own code');
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
  eq(await p.$$eval('.report-group .group-th', n => n.map(h => h.textContent.trim().split(/\s+/).slice(0, 2).join(' '))),
    ['Group G2', 'Group G1', 'Group G3'], 'the weakest group is reported first, the strongest last');
  const worst = await textOf(p, '.report-group:first-of-type .group-th');
  ok(/2 sat/.test(worst), 'each group heading counts its own');
  ok(/average 50%/.test(worst), 'and averages only its own marks');
  ok(/2 below 70%/.test(worst), 'and counts its own failures');
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
  eq(await p.$$eval('.choice.is-right', n => n.length), 4, 'the correct choice is marked on every card');
  eq(await p.$$eval('.choice.is-picked-wrong', n => n.length), 1, 'and the wrong one they picked is marked as theirs');
  const paper = await textOf(p, '.profile-head') || '';
  ok(/Khalid Al-Dossari/.test(paper), 'the paper says whose it is');
  ok(/ET1004/.test(paper), 'with their ID, and it is the trainee whose row was clicked');

  console.log('\n=== 11. Back from a paper returns to the report ===');
  await p.click('.back-to-profile');
  await p.waitForSelector('.report-table');
  ok(await visible(p, '.report-stats'), 'the figures are back');
  eq(await p.$$eval('.report-table tbody tr', n => n.length), 7, 'and so is every row');
  eq(apiCalls.filter(c => c === 'session_report:G1-9001').length, 1,
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
  await p.waitForSelector('#sessionReportBody .pane-empty:not(.is-loading)');
  ok(/nothing to report/i.test(await textOf(p, '#sessionReportBody .pane-empty:not(.is-loading)')),
    'it says so plainly');
  eq(await p.$$eval('.report-stats', n => n.length), 0, 'with no figures invented to fill the space');
  ok(/Absent Trainee/.test(await textOf(p, '.report-absent') || ''),
    'but the group is still listed as not having sat it');

  console.log('\n=== 14. A refusal reaches the screen ===');
  // Not reachable by clicking a row -- G1-6001 was never listed for adnen, see
  // this file's header -- so this calls the same function the click would,
  // with the code a real refusal actually has to come from the backend for.
  await p.click('#reportBackBtn');
  await p.waitForSelector('.sessions-table');
  await p.evaluate(() => openSessionReport('G1-6001'));
  await p.waitForSelector('#sessionReportBody .feedback.bad');
  ok(/another instructor/i.test(await textOf(p, '#sessionReportBody .feedback.bad')),
    'the reason the backend gave is the reason shown');

  console.log('\n=== 15. Printed, the report is the whole page ===');
  await p.evaluate(() => openSessionReport('G1-9001'));
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
  server.close();
  await pool.end();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
