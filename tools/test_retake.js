/* One sitting per exam, and the instructor's way of granting another.
 *
 * The rule has to hold in two places, and the second is the one that matters:
 * the app refuses to draw a second paper, but that is the browser's opinion.
 * The write itself must refuse too, or anyone who can post JSON has unlimited
 * attempts. */
const { makeSpreadsheet, loadBackend, get, post } = require('/tmp/energytech_app/gas_stub.js');
let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const { ss, api } = loadBackend(makeSpreadsheet());
api.setup();

const T = get(api, 'auth_login', { username: 'adnen', password: '12341234' }).token;
get(api, 'intake_save', { token: T, label: 'JAN26' });
get(api, 'group_save', { token: T, intake: 'JAN26', name: 'G1' });
get(api, 'trainee_save', { token: T, energytechId: 'ET1001', name: 'Mohammed Al-Otaibi', intake: 'JAN26', group: 'G1' });
get(api, 'trainee_save', { token: T, energytechId: 'ET1002', name: 'Fahad Al-Qahtani', intake: 'JAN26', group: 'G1' });
get(api, 'trainee_save', { token: T, energytechId: 'ET1003', name: 'Sultan Al-Harbi', intake: 'JAN26', group: 'G1' });
const MINE = get(api, 'trainee_signup', { energytechId: 'ET1001', password: 'secret1' }).token;
const OTHER = get(api, 'trainee_signup', { energytechId: 'ET1002', password: 'secret2' }).token;
// Never sits anything: the control for "may sit it" being genuinely reported.
const UNSAT = get(api, 'trainee_signup', { energytechId: 'ET1003', password: 'secret3' }).token;

function session(code, mode, extra) {
  post(api, { type: 'quiz_session', token: T, session: Object.assign({
    sessionCode: code, sessionName: code, intake: 'JAN26', group: 'G1', mode: mode,
    questionSetKey: 'ch12:original_pdf', seed: 'S', questionCount: 2, orderMode: 'original'
  }, extra || {}) });
}

let n = 0;
function sit(code, mode, token, walkIn) {
  n++;
  const body = { type: 'quiz_attempt', attemptId: 'A' + n,
    quiz: { sessionCode: code, sessionName: code, mode: mode, questionSet: 's',
            questionSetKey: 'ch12:original_pdf', seed: 'S', questionCount: 1, orderMode: 'original' },
    score: { correct: 1, total: 1, percent: 100, wrongQuestions: [], unansweredQuestions: [] },
    items: [{ quizNumber: 1, originalNumber: 3, lesson: '1-1.1', studentAnswer: 'a', correctAnswer: 'a', result: 'correct' }] };
  if (walkIn) body.student = walkIn; else body.traineeToken = token;
  return post(api, body);
}

const rowsFor = code => ss.sheets.Attempts.rows.slice(1)
  .filter(r => String(r[5]).toUpperCase() === code).length;

session('G1-EXAM', 'assessment');
session('G1-PRAC', 'practice');

console.log('\n=== 1. The first sitting goes through ===');
let r = sit('G1-EXAM', 'assessment', MINE);
ok(r.ok !== false, 'the exam is accepted');
eq(rowsFor('G1-EXAM'), 1, 'and one row is on the Sheet');

console.log('\n=== 2. The second does not ===');
r = sit('G1-EXAM', 'assessment', MINE);
ok(r.ok === false, 'a second submission is refused');
ok(/already been submitted/i.test(r.error || ''), `and says why (got "${r.error}")`);
eq(rowsFor('G1-EXAM'), 1, 'the Sheet still has exactly one row');

console.log('\n=== 3. It is per trainee, not per exam ===');
r = sit('G1-EXAM', 'assessment', OTHER);
ok(r.ok !== false, 'a different trainee may still sit it');
eq(rowsFor('G1-EXAM'), 2, 'and their row is written');

console.log('\n=== 4. Practice is unlimited ===');
sit('G1-PRAC', 'practice', MINE);
sit('G1-PRAC', 'practice', MINE);
sit('G1-PRAC', 'practice', MINE);
eq(rowsFor('G1-PRAC'), 3, 'three practice sittings, all kept -- that is what practice is for');

console.log('\n=== 5. The session load tells the app before it draws a paper ===');
let s = get(api, 'session', { code: 'G1-EXAM', token: MINE });
ok(s.ok, 'the session loads');
eq(s.sitting.maySit, false, 'and reports that this trainee may not sit it');
eq([s.sitting.sat, s.sitting.allowed], [1, 1], 'one sitting used of one allowed');
eq(get(api, 'session', { code: 'G1-EXAM', token: UNSAT }).sitting.maySit, true,
  'while a trainee who has not sat it may');
eq(get(api, 'session', { code: 'G1-PRAC', token: MINE }).sitting.maySit, true,
  'and a practice session is always open');
eq(get(api, 'session', { code: 'G1-EXAM' }).sitting, null,
  'with no token there is no sitting record to report');

console.log('\n=== 6. The instructor can allow one more ===');
r = get(api, 'retake_allow', { token: T, sessionCode: 'G1-EXAM', energytechId: 'ET1001' });
ok(r.ok, 'the retake is granted');
eq([r.sat, r.allowed], [1, 2], 'one sitting used, two now allowed');
eq(get(api, 'session', { code: 'G1-EXAM', token: MINE }).sitting.maySit, true, 'the trainee may sit it again');
r = sit('G1-EXAM', 'assessment', MINE);
ok(r.ok !== false, 'and the second sitting is accepted');
eq(rowsFor('G1-EXAM'), 3, 'written to the Sheet');

console.log('\n=== 7. A grant is spent by being used ===');
// The point of counting grants instead of setting a flag: one grant is one
// sitting, not an open door.
eq(get(api, 'session', { code: 'G1-EXAM', token: MINE }).sitting.maySit, false,
  'the door closes again behind them');
r = sit('G1-EXAM', 'assessment', MINE);
ok(r.ok === false, 'a third sitting is refused');
eq(rowsFor('G1-EXAM'), 3, 'and nothing more is written');

console.log('\n=== 8. Who may grant ===');
get(api, 'auth_signup', { username: 'sara', password: 'password1', displayName: 'Sara' });
get(api, 'admin_set_status', { token: T, targetUsername: 'sara', status: 'approved' });
const SARA = get(api, 'auth_login', { username: 'sara', password: 'password1' }).token;
ok(!get(api, 'retake_allow', { token: SARA, sessionCode: 'G1-EXAM', energytechId: 'ET1001' }).ok,
  'another instructor cannot grant on someone else\'s exam');
ok(!get(api, 'retake_allow', { token: MINE, sessionCode: 'G1-EXAM', energytechId: 'ET1001' }).ok,
  'and a trainee certainly cannot grant themselves one');
ok(!get(api, 'retake_allow', {}).ok, 'nor can an anonymous caller');
ok(!get(api, 'retake_allow', { token: T, sessionCode: 'G1-EXAM', energytechId: 'ET9999' }).ok,
  'a trainee who is not on the roster is refused');
ok(!get(api, 'retake_allow', { token: T, sessionCode: 'NOPE', energytechId: 'ET1001' }).ok,
  'and so is an unknown session');
eq(rowsFor('G1-EXAM'), 3, 'after all of which nothing extra has been written');
eq(get(api, 'session', { code: 'G1-EXAM', token: MINE }).sitting.maySit, false,
  'and the trainee is still locked out');

console.log('\n=== 9. Who sat it ===');
r = get(api, 'retake_list', { token: T, sessionCode: 'G1-EXAM' });
ok(r.ok, 'the list loads');
eq(r.trainees.map(t => `${t.energytechId}:${t.sat}/${t.allowed}:${t.maySitAgain}`),
  ['ET1001:2/2:false', 'ET1002:1/1:false'],
  'both trainees, with sittings used, allowed, and whether they may go again');
eq(r.trainees[0].name, 'Mohammed Al-Otaibi', 'named, so the instructor knows who they are looking at');
ok(!get(api, 'retake_list', { token: MINE, sessionCode: 'G1-EXAM' }).ok, 'a trainee cannot read it');

console.log('\n=== 10. A guest sitting is not covered by any of this ===');
// A walk-in types their own ID and holds no token, so there is nothing to
// identify them by. Exams should not allow guests; this records the behaviour
// rather than pretending it is solved.
session('G1-OPEN', 'assessment', { allowWalkIn: true });
sit('G1-OPEN', 'assessment', null, { name: 'Guest', group: 'G1', energytechId: 'ET1001' });
sit('G1-OPEN', 'assessment', null, { name: 'Guest', group: 'G1', energytechId: 'ET1001' });
eq(rowsFor('G1-OPEN'), 2, 'two guest sittings both go through -- turn walk-ins off for an exam');

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
