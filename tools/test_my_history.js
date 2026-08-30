/* The trainee looking at their own record.
 *
 * The instructor route and the trainee route share one body, so the interesting
 * questions are all about who is allowed to see what: a trainee must see every
 * one of their own attempts regardless of which instructor ran the session, and
 * must see nothing at all belonging to anybody else. */
const { makeSpreadsheet, loadBackend, get, post } = require('/tmp/energytech_app/gas_stub.js');
let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const { ss, api } = loadBackend(makeSpreadsheet());
api.setup();

const ADNEN = get(api, 'auth_login', { username: 'adnen', password: '12341234' }).token;
get(api, 'intake_save', { token: ADNEN, label: 'JAN26' });
get(api, 'group_save', { token: ADNEN, intake: 'JAN26', name: 'G1' });
get(api, 'trainee_save', { token: ADNEN, energytechId: 'ET1001', name: 'Mohammed Abdullah Saleh Al-Otaibi', intake: 'JAN26', group: 'G1' });
get(api, 'trainee_save', { token: ADNEN, energytechId: 'ET1002', name: 'Fahad Al-Qahtani', intake: 'JAN26', group: 'G1' });

// A second instructor, so "sessions run by someone else" can be tested.
get(api, 'auth_signup', { username: 'sara', password: 'password1', displayName: 'Sara' });
get(api, 'admin_set_status', { token: ADNEN, targetUsername: 'sara', status: 'approved' });
const SARA = get(api, 'auth_login', { username: 'sara', password: 'password1' }).token;

const MINE = get(api, 'trainee_signup', { energytechId: 'ET1001', password: 'secret1' }).token;
const THEIRS = get(api, 'trainee_signup', { energytechId: 'ET1002', password: 'secret2' }).token;

const session = (token, code, name) => post(api, { type: 'quiz_session', token, session: {
  sessionCode: code, sessionName: name, intake: 'JAN26', group: 'G1', mode: 'practice',
  questionSetKey: 'ch12:original_pdf', seed: '111', questionCount: 2, orderMode: 'original' } });

session(ADNEN, 'G1-1111', 'Adnane week 1');
session(SARA, 'G1-2222', 'Sara week 2');

const item = (q, orig, lesson, ans, correct) =>
  ({ quizNumber: q, originalNumber: orig, lesson, studentAnswer: ans, correctAnswer: correct,
     result: ans === correct ? 'correct' : (ans ? 'wrong' : 'unanswered') });

function attempt(id, code, traineeToken, items, when, walkIn) {
  const correct = items.filter(i => i.result === 'correct').length;
  const body = { type: 'quiz_attempt', attemptId: id,
    quiz: { sessionCode: code, sessionName: '', mode: 'practice', questionSet: 'set',
            questionSetKey: 'ch12:original_pdf', seed: '111', questionCount: items.length, orderMode: 'original' },
    score: { correct, total: items.length, percent: Math.round(correct / items.length * 100),
             wrongQuestions: [], unansweredQuestions: [] },
    items };
  if (walkIn) body.student = walkIn; else body.traineeToken = traineeToken;
  post(api, body);
  if (when) {
    const rows = ss.sheets.Attempts.rows;
    rows[rows.length - 1][0] = when;
  }
}

attempt('A1', 'G1-1111', MINE, [item(1, 3, '1-1.1', 'a', 'a'), item(2, 7, '1-1.1', 'b', 'c')],
  new Date('2026-08-01T09:00:00Z'));
attempt('A2', 'G1-2222', MINE, [item(1, 3, '1-2.3', 'd', 'd'), item(2, 7, '1-2.3', 'a', 'a')],
  new Date('2026-08-08T09:00:00Z'));
attempt('B1', 'G1-1111', THEIRS, [item(1, 3, '1-1.1', 'c', 'a'), item(2, 7, '1-1.1', 'c', 'c')],
  new Date('2026-08-02T09:00:00Z'));

console.log('\n=== 1. A trainee sees their own record, named by the token alone ===');
let r = get(api, 'my_history', { token: MINE });
ok(r.ok, 'the history loads');
eq(r.trainee.energytechId, 'ET1001', 'it is their own record');
eq(r.trainee.name, 'Mohammed Abdullah Saleh Al-Otaibi', 'with their name');
eq(r.attempts.map(a => a.attemptId), ['A2', 'A1'], 'both attempts, newest first');

console.log('\n=== 2. Which includes sessions run by other instructors ===');
// This is the point of the separate route: for an instructor A2 belongs to
// Sara, but for the trainee it is simply a quiz they sat.
eq(get(api, 'trainee_history', { token: SARA, energytechId: 'ET1001' }).attempts.map(a => a.attemptId),
  ['A2'], 'Sara sees only the one she ran');
ok(r.attempts.some(a => a.attemptId === 'A1') && r.attempts.some(a => a.attemptId === 'A2'),
  'but the trainee sees both');
eq(r.lessons.map(l => `${l.lesson}:${l.correct}/${l.total}`), ['1-1.1:1/2', '1-2.3:2/2'],
  'and the lesson tally counts every question they answered, weakest first');

console.log('\n=== 3. And nothing belonging to anybody else ===');
ok(!r.attempts.some(a => a.attemptId === 'B1'), 'the other trainee\'s attempt is absent');
eq(get(api, 'my_history', { token: THEIRS }).attempts.map(a => a.attemptId), ['B1'],
  'and they see only theirs');

console.log('\n=== 4. Opening one of their own attempts ===');
r = get(api, 'my_attempt', { token: MINE, attemptId: 'A1' });
ok(r.ok, 'the attempt loads');
eq(r.attempt.attemptId, 'A1', 'the right one');
eq(r.items.length, 2, 'with both questions');
eq(r.items[1], { quizNumber: 2, originalNumber: 7, lesson: '1-1.1', answer: 'b', correctAnswer: 'c', result: 'wrong' },
  'each carrying what they answered, the right answer, and the verdict');
ok(get(api, 'my_attempt', { token: MINE, attemptId: 'A2' }).ok,
  'including the one another instructor ran');

console.log('\n=== 5. Knowing an attempt id is not enough ===');
// The whole guard: B1 is a real id, and the caller holds a real token.
r = get(api, 'my_attempt', { token: MINE, attemptId: 'B1' });
ok(!r.ok, 'another trainee\'s attempt is refused');
ok(!/Fahad/.test(JSON.stringify(r)), 'and the refusal leaks no part of it');
ok(!get(api, 'my_attempt', { token: THEIRS, attemptId: 'A1' }).ok, 'and it is refused the other way round too');

console.log('\n=== 6. The two routes do not accept each other\'s tokens ===');
ok(!get(api, 'my_history', { token: ADNEN }).ok, 'an instructor token is not a trainee token');
ok(!get(api, 'my_attempt', { token: ADNEN, attemptId: 'A1' }).ok, 'not for an attempt either');
ok(!get(api, 'trainee_history', { token: MINE, energytechId: 'ET1001' }).ok,
  'and a trainee token cannot drive the instructor route');
ok(!get(api, 'attempt_detail', { token: MINE, attemptId: 'A1' }).ok, 'nor open an attempt through it');

console.log('\n=== 7. No token, wrong token, no attempt ===');
ok(!get(api, 'my_history', {}).ok, 'no token, no history');
ok(!get(api, 'my_history', { token: 'made-up' }).ok, 'an invented token is refused');
ok(!get(api, 'my_attempt', { token: MINE }).ok, 'an attempt id is required');
ok(!get(api, 'my_attempt', { token: MINE, attemptId: 'NOPE' }).ok, 'an unknown attempt is refused');

console.log('\n=== 8. Losing the account closes the record ===');
const revoke = get(api, 'trainee_set_account', { token: ADNEN, energytechId: 'ET1001', status: 'revoked' });
ok(revoke.ok, 'the instructor can turn the account off');
ok(!get(api, 'my_history', { token: MINE }).ok, 'a revoked trainee cannot read their history');
ok(!get(api, 'my_attempt', { token: MINE, attemptId: 'A1' }).ok, 'nor open an attempt');
// Revoking clears the token, so turning the account back on is not enough on
// its own -- they have to log in again. Checking both halves separately is what
// makes this test mean something.
get(api, 'trainee_set_account', { token: ADNEN, energytechId: 'ET1001', status: 'active' });
ok(!get(api, 'my_history', { token: MINE }).ok, 'the old token stays dead after it is turned back on');
const BACK = get(api, 'trainee_login', { energytechId: 'ET1001', password: 'secret1' }).token;
ok(get(api, 'my_history', { token: BACK }).ok, 'but a fresh login reads it again');

console.log('\n=== 8b. The status is re-read on every call, not just at login ===');
// Turning the account off through the app also clears the token, which would
// hide a broken status check behind a dead token. So this switches the cell the
// way an instructor typing straight into the Sheet would, leaving the token
// alive, and checks the guard on its own.
function setStatusCell(id, status) {
  const rows = ss.sheets.Trainees.rows;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][1]) === id) { rows[i][5] = status; return true; }
  }
  return false;
}
ok(setStatusCell('ET1001', 'revoked'), 'the status cell was found and changed');
ok(!get(api, 'my_history', { token: BACK }).ok, 'a live token on a revoked row reads nothing');
ok(!get(api, 'my_attempt', { token: BACK, attemptId: 'A1' }).ok, 'and opens nothing');
setStatusCell('ET1001', 'active');
ok(get(api, 'my_history', { token: BACK }).ok, 'and works again the moment the cell says active');

console.log('\n=== 8c. The record is chosen by the token, never by a parameter ===');
// A trainee who edits the request cannot read someone else's record.
let sneak = get(api, 'my_history', { token: BACK, energytechId: 'ET1002' });
ok(sneak.ok, 'the call still succeeds');
eq(sneak.trainee.energytechId, 'ET1001', 'but it is still their own record');
eq(sneak.attempts.map(a => a.attemptId), ['A2', 'A1'], 'with their own attempts, not ET1002\'s');
ok(!sneak.attempts.some(a => a.attemptId === 'B1'), 'the other trainee\'s attempt is still absent');

console.log('\n=== 9. Logging out ends it ===');
get(api, 'trainee_logout', { token: BACK });
ok(!get(api, 'my_history', { token: BACK }).ok, 'the retired token no longer reads the history');
const AGAIN = get(api, 'trainee_login', { energytechId: 'ET1001', password: 'secret1' }).token;
eq(get(api, 'my_history', { token: AGAIN }).attempts.length, 2, 'a fresh login sees the same two attempts');

console.log('\n=== 10. A guest sitting under someone else\'s ID is shown, and labelled ===');
// A walk-in types whatever ID they like, so the row can land on a real
// trainee's record. Hiding it would be worse: the trainee would never know.
attempt('W1', 'G1-1111', null, [item(1, 3, '1-1.1', 'a', 'b'), item(2, 7, '1-1.1', 'a', 'b')],
  new Date('2026-08-09T09:00:00Z'), { name: 'Someone Else', group: 'G1', energytechId: 'ET1001' });
r = get(api, 'my_history', { token: AGAIN });
eq(r.attempts.map(a => a.attemptId), ['W1', 'A2', 'A1'], 'it appears in the list');
eq(r.attempts.find(a => a.attemptId === 'W1').registered, 'walk-in', 'flagged as a guest sitting');
eq(r.attempts.find(a => a.attemptId === 'A1').registered, 'yes', 'while their own are flagged as registered');

console.log('\n=== 11. The trainee route and the instructor route agree ===');
// Same trainee, same visible rows (the admin sees everything the trainee does),
// so any difference means the two have drifted apart.
const asAdmin = get(api, 'trainee_history', { token: ADNEN, energytechId: 'ET1001' });
const asSelf = get(api, 'my_history', { token: AGAIN });
eq(asSelf.attempts.map(a => a.attemptId), asAdmin.attempts.map(a => a.attemptId), 'the same attempts in the same order');
eq(asSelf.lessons, asAdmin.lessons, 'and exactly the same lesson analysis');

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
