/* The per-session report, and the setup() that used to destroy the thing it
 * reports on.
 *
 * The report itself is read-only, so the interesting parts are the boundaries:
 * whose sessions an instructor may open, that a retake does not become a second
 * trainee in every average, and that an exam still held back from the trainees
 * is nonetheless shown to the instructor who has to decide whether to release
 * it. */
const { makeSpreadsheet, loadBackend, get, post } = require('/tmp/energytech_app/gas_stub.js');

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const { ss, api } = loadBackend(makeSpreadsheet());
api.setup();

const T = get(api, 'auth_login', { username: 'adnen', password: '12341234' }).token;
get(api, 'auth_signup', { username: 'sara', password: 'password1', displayName: 'Sara' });
get(api, 'admin_set_status', { token: T, targetUsername: 'sara', status: 'approved' });
const SARA = get(api, 'auth_login', { username: 'sara', password: 'password1' }).token;

get(api, 'intake_save', { token: T, label: 'JAN26' });
get(api, 'group_save', { token: T, intake: 'JAN26', name: 'G1' });
get(api, 'group_save', { token: T, intake: 'JAN26', name: 'G2' });
const ROSTER = [
  ['ET1001', 'Mohammed Al-Otaibi', 'G1'],
  ['ET1002', 'Fahad Al-Qahtani', 'G1'],
  ['ET1003', 'Yousef Al-Harbi', 'G1'],
  ['ET1004', 'Khalid Al-Dossari', 'G2'],
  ['ET1005', 'Nasser Al-Shehri', 'G2'],
  ['ET1006', 'Absent Trainee', 'G1']
];
const TOK = {};
ROSTER.forEach(([id, name, group]) => {
  get(api, 'trainee_save', { token: T, energytechId: id, name, intake: 'JAN26', group });
  TOK[id] = get(api, 'trainee_signup', { energytechId: id, password: 'secret1' }).token;
});

function session(code, name, mode, owner, group) {
  post(api, { type: 'quiz_session', token: owner || T, session: {
    sessionCode: code, sessionName: name, intake: 'JAN26', group: group || 'G1', mode,
    questionSetKey: 'ch12:original_pdf', seed: '111', questionCount: 10, orderMode: 'original'
  } });
}

/* `at` fixes the timestamp so "the latest sitting" is a fact rather than a race
 * between two writes in the same millisecond. */
function attempt(id, code, mode, token, correct, total, at) {
  const items = [];
  for (let i = 1; i <= total; i++) {
    const right = i <= correct;
    items.push({ quizNumber: i, originalNumber: i, lesson: '1-1.1',
      studentAnswer: right ? 'a' : 'b', correctAnswer: 'a', result: right ? 'correct' : 'wrong' });
  }
  post(api, { type: 'quiz_attempt', attemptId: id, traineeToken: token,
    quiz: { sessionCode: code, sessionName: '', mode, questionSet: 'Chapters 01 & 02',
            questionSetKey: 'ch12:original_pdf', seed: '111', questionCount: total,
            orderMode: 'original', orderSeed: '' },
    score: { correct, total, percent: Math.round(correct / total * 100),
             wrongQuestions: [], unansweredQuestions: [] },
    items });
  if (at) {
    const rows = ss.sheets.Attempts.rows;
    rows[rows.length - 1][0] = new Date(at);
  }
}

session('G1-9001', 'Midterm exam', 'assessment');
session('G1-7001', 'Week 3 practice', 'practice');
session('G2-9002', "Sara's exam", 'assessment', SARA, 'G2');

attempt('E-1001', 'G1-9001', 'assessment', TOK.ET1001, 4, 10, '2026-03-01T08:00:00Z');   // 40%
attempt('E-1002', 'G1-9001', 'assessment', TOK.ET1002, 7, 10, '2026-03-01T08:05:00Z');   // 70%
attempt('E-1003', 'G1-9001', 'assessment', TOK.ET1003, 10, 10, '2026-03-01T08:10:00Z');  // 100%
attempt('E-1004', 'G1-9001', 'assessment', TOK.ET1004, 6, 10, '2026-03-01T08:15:00Z');   // 60%, G2
attempt('E-1005', 'G1-9001', 'assessment', TOK.ET1005, 9, 10, '2026-03-01T08:20:00Z');   // 90%, G2

console.log('\n=== 1. setup() does not throw the records away ===');
// This is the whole reason this file exists. setup() used to clear Sessions,
// Attempts and ItemResponses on every run, so pressing Run in the Apps Script
// editor -- the ordinary way to check a deployment is alive -- erased every
// paper anybody had sat.
const attemptsBefore = ss.sheets.Attempts.rows.length;
const sessionsBefore = ss.sheets.Sessions.rows.length;
const itemsBefore = ss.sheets.ItemResponses.rows.length;
ok(attemptsBefore > 1 && itemsBefore > 1, 'there are records to lose in the first place');
api.setup();
eq(ss.sheets.Attempts.rows.length, attemptsBefore, 'the attempts are all still there after setup()');
eq(ss.sheets.Sessions.rows.length, sessionsBefore, 'and the sessions');
eq(ss.sheets.ItemResponses.rows.length, itemsBefore, 'and every item response');
api.setup(); api.setup();
eq(ss.sheets.Attempts.rows.length, attemptsBefore, 'running it three more times changes nothing');
eq(ss.sheets.Attempts.rows[0][0], 'Timestamp', 'and the header row is still a header row');
ok(get(api, 'session_report', { token: T, sessionCode: 'G1-9001' }).trainees.length === 5,
  'and the report still finds all five papers');

console.log('\n=== 1b. A sheet emptied by hand gets its headers back ===');
// The old ensureSheets_ called setup() only when a sheet was MISSING, so a
// sheet somebody had selected-all-and-deleted stayed headerless for ever.
ss.sheets.ItemResponses.rows.length = 0;
api.setup();
eq(ss.sheets.ItemResponses.rows.length, 1, 'the header row is restored');
eq(ss.sheets.ItemResponses.rows[0][1], 'Attempt ID', 'and it is the right header row');

console.log('\n=== 1c. Erasing is possible, but only on purpose ===');
let threw = '';
try { api.eraseAllRecords_(); } catch (e) { threw = String(e.message || e); }
ok(/not armed/i.test(threw), `an unarmed erase refuses and says so (got "${threw.slice(0, 60)}")`);
ok(/copy/i.test(threw), 'and tells you to take a copy first');
eq(ss.sheets.Attempts.rows.length, attemptsBefore, 'and it really did not touch the records');

console.log('\n=== 2. The report of one session ===');
let r = get(api, 'session_report', { token: T, sessionCode: 'G1-9001' });
ok(r.ok, 'the report loads');
eq(r.session.sessionName, 'Midterm exam', 'the session is named');
eq(r.session.mode, 'assessment', 'and its mode is reported');
eq(r.session.intake + '/' + r.session.group, 'JAN26/G1', 'and where it was run');
eq(r.trainees.length, 5, 'five trainees sat it');
const byId = {};
r.trainees.forEach(t => { byId[t.energytechId] = t; });
eq(byId.ET1001.percent, 40, 'the weakest scored 40%');
eq(byId.ET1003.percent, 100, 'and one had full marks');
eq([byId.ET1001.score, byId.ET1001.total], [4, 10], 'the raw score is there too');
eq(byId.ET1001.name, 'Mohammed Al-Otaibi', 'the trainee is named');
eq(byId.ET1004.group, 'G2', 'and a trainee from another group keeps their own group');
ok(byId.ET1001.attemptId, 'every row carries the id needed to open the paper');

console.log('\n=== 3. The marks are shown even though the trainees cannot see them ===');
// Releasing is what lets the TRAINEES see a mark. The instructor is the one
// deciding whether to release, and cannot decide with the figures hidden.
eq(r.session.published, false, 'this exam has not been released');
ok(r.trainees.every(t => typeof t.percent === 'number'), 'yet every mark is reported to the instructor');
ok(get(api, 'my_history', { token: TOK.ET1001 }).attempts.every(a => a.percent === null),
  'while the trainee still sees no mark at all');

console.log('\n=== 4. Who did not sit it ===');
eq(r.absent.map(a => a.energytechId), ['ET1006'],
  'the one G1 trainee who did not sit is listed as absent');
ok(!r.absent.some(a => a.group === 'G2'), 'and G2, who were never expected, are not called absent');

console.log('\n=== 5. A retake is one trainee, not two ===');
// The backend refuses a second sitting outright, so the only way to get one is
// the way it happens in real life: the instructor grants it.
ok(get(api, 'retake_allow', { token: T, sessionCode: 'G1-9001', energytechId: 'ET1001' }).ok,
  'the instructor allows ET1001 another sitting');
attempt('E-1001b', 'G1-9001', 'assessment', TOK.ET1001, 8, 10, '2026-03-02T09:00:00Z');
r = get(api, 'session_report', { token: T, sessionCode: 'G1-9001' });
eq(r.trainees.length, 5, 'still five trainees, not six');
const resat = r.trainees.find(t => t.energytechId === 'ET1001');
eq(resat.sittingCount, 2, 'the one who sat twice is marked as having done so');
eq(resat.percent, 80, 'and stands on the later sitting');
eq(resat.attemptId, 'E-1001b', 'which is the paper the report opens');
eq(resat.sittings.map(s => s.percent), [80, 40], 'both sittings are kept, newest first');

console.log('\n=== 6. Whose report it is ===');
r = get(api, 'session_report', { token: SARA, sessionCode: 'G1-9001' });
ok(!r.ok && /another instructor/i.test(r.error || ''), 'a colleague cannot open a session they did not run');
r = get(api, 'session_report', { token: SARA, sessionCode: 'G2-9002' });
ok(r.ok, 'but can open their own');
r = get(api, 'session_report', { token: T, sessionCode: 'G2-9002' });
ok(r.ok, 'and an admin can open anybody\'s');
r = get(api, 'session_report', { sessionCode: 'G1-9001' });
ok(!r.ok, 'no token, no report');
r = get(api, 'session_report', { token: T, sessionCode: 'G1-0000' });
ok(!r.ok && /not found/i.test(r.error || ''), 'an unknown code is refused by name');
r = get(api, 'session_report', { token: T, sessionCode: '' });
ok(!r.ok, 'and so is no code at all');

console.log('\n=== 6b. A row the viewer could not open is not listed either ===');
// Saving a session again appends a row, so a session can end up owned by one
// instructor while attempts sat under the earlier row are stamped with
// another. The report must not offer a paper that attempt_detail will then
// refuse -- a row that cannot be opened is worse than a row left out.
attempt('X-1', 'G2-9002', 'assessment', TOK.ET1004, 5, 10, '2026-03-03T08:00:00Z');
const rows = ss.sheets.Attempts.rows;
rows[rows.length - 1][19] = 'adnen';          // stamped with the other instructor
r = get(api, 'session_report', { token: SARA, sessionCode: 'G2-9002' });
eq(r.trainees.length, 0, 'Sara does not see a paper she could not open');
r = get(api, 'session_report', { token: T, sessionCode: 'G2-9002' });
eq(r.trainees.length, 1, 'while the admin, who can open anything, sees it');
ok(!get(api, 'attempt_detail', { token: SARA, attemptId: 'X-1' }).ok,
  'and attempt_detail agrees -- Sara really cannot open it');

console.log('\n=== 7. A session nobody has sat ===');
r = get(api, 'session_report', { token: T, sessionCode: 'G1-7001' });
ok(r.ok, 'the report still loads');
eq(r.trainees.length, 0, 'with nobody in it');
eq(r.absent.length, 4, 'and the whole group listed as not having sat it');

console.log('\n=== 8. The roster is the authority on a name ===');
// A walk-in types their own name. If it is later corrected on the roster, the
// report should show the corrected one -- the row on the day is not the record
// of who somebody is.
post(api, { type: 'quiz_attempt', attemptId: 'W-1',
  student: { name: 'mohd alotibi', group: 'G1', energytechId: 'ET1007' },
  quiz: { sessionCode: 'G1-7001', sessionName: 'Week 3 practice', mode: 'practice',
          questionSet: 'x', questionSetKey: 'ch12:original_pdf', seed: '111',
          questionCount: 2, orderMode: 'original' },
  score: { correct: 1, total: 2, percent: 50, wrongQuestions: [], unansweredQuestions: [] },
  items: [] });
r = get(api, 'session_report', { token: T, sessionCode: 'G1-7001' });
eq(r.trainees[0].name, 'mohd alotibi', 'before they are on the roster, the typed name stands');
eq(r.trainees[0].onRoster, false, 'and the row says they are not on it');
get(api, 'trainee_save', { token: T, energytechId: 'ET1007', name: 'Mohammed Al-Otaibi (2)', intake: 'JAN26', group: 'G1' });
r = get(api, 'session_report', { token: T, sessionCode: 'G1-7001' });
eq(r.trainees[0].name, 'Mohammed Al-Otaibi (2)', 'once they are, the roster name wins');
eq(r.trainees[0].onRoster, true, 'and the row says so');

console.log('\n=== 9. One session at a time ===');
r = get(api, 'session_report', { token: T, sessionCode: 'G1-9001' });
ok(r.trainees.every(t => t.sittings.every(s => s.attemptId.indexOf('W-') !== 0)),
  'the practice attempt does not leak into the exam report');

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
