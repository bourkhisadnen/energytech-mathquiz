/* Exam results are held back until the instructor releases them.
 *
 * The thing being tested is a leak, not a feature: an unreleased mark must not
 * reach the trainee by ANY route -- not the score, not the percentage, not the
 * lesson bars it could be reconstructed from, and not by asking for the attempt
 * directly with an id guessed from somewhere else. */
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
const MINE = get(api, 'trainee_signup', { energytechId: 'ET1001', password: 'secret1' }).token;
const OTHER = get(api, 'trainee_signup', { energytechId: 'ET1002', password: 'secret2' }).token;

function session(code, name, mode, extra) {
  post(api, { type: 'quiz_session', token: T, session: Object.assign({
    sessionCode: code, sessionName: name, intake: 'JAN26', group: 'G1', mode: mode,
    questionSetKey: 'ch12:original_pdf', seed: '111', questionCount: 2, orderMode: 'original'
  }, extra || {}) });
}

const item = (q, orig, lesson, ans, correct) =>
  ({ quizNumber: q, originalNumber: orig, lesson, studentAnswer: ans, correctAnswer: correct,
     result: ans === correct ? 'correct' : (ans ? 'wrong' : 'unanswered') });

function attempt(id, code, mode, token, items, orderSeed, name) {
  const correct = items.filter(i => i.result === 'correct').length;
  // The client posts the loaded session with the attempt, so the name travels
  // with it; sending '' here would test something the app never does.
  post(api, { type: 'quiz_attempt', attemptId: id, traineeToken: token,
    quiz: { sessionCode: code, sessionName: name || '', mode: mode, questionSet: 'set',
            questionSetKey: 'ch12:original_pdf', seed: '111', questionCount: items.length,
            orderMode: 'original', orderSeed: orderSeed || '' },
    score: { correct, total: items.length, percent: Math.round(correct / items.length * 100),
             wrongQuestions: [], unansweredQuestions: [] },
    items });
}

session('G1-1111', 'Practice one', 'practice');
session('G1-2222', 'Midterm exam', 'assessment', { shuffleEachLaunch: true });

attempt('P1', 'G1-1111', 'practice', MINE, [item(1, 3, '1-1.1', 'a', 'a'), item(2, 7, '1-1.1', 'b', 'b')], '', 'Practice one');
attempt('E1', 'G1-2222', 'assessment', MINE, [item(1, 3, '1-2.3', 'c', 'a'), item(2, 7, '1-2.3', 'd', 'd')], 'ORD-abc', 'Midterm exam');
attempt('E2', 'G1-2222', 'assessment', OTHER, [item(1, 3, '1-2.3', 'a', 'a'), item(2, 7, '1-2.3', 'd', 'd')], 'ORD-xyz', 'Midterm exam');

console.log('\n=== 1. The exam is listed, but carries no mark ===');
let r = get(api, 'my_history', { token: MINE });
ok(r.ok, 'the history loads');
eq(r.attempts.map(a => a.sessionCode).sort(), ['G1-1111', 'G1-2222'], 'both quizzes are listed');
const exam = r.attempts.find(a => a.sessionCode === 'G1-2222');
const prac = r.attempts.find(a => a.sessionCode === 'G1-1111');
eq(exam.released, false, 'the exam is marked as not released');
eq([exam.score, exam.total, exam.percent], [null, null, null], 'and carries no score, total or percentage');
eq(exam.attemptId, '', 'and no attempt id, so there is nothing to open');
eq(exam.sessionName, 'Midterm exam', 'but it is still named, so the trainee knows it was recorded');
eq(prac.released, true, 'the practice quiz is released');
eq([prac.score, prac.total], [2, 2], 'and shows its mark as usual');

console.log('\n=== 2. Nor can the mark be read out of the lesson bars ===');
// E1 scored 1 of 2 on lesson 1-2.3. If those items reached the tally, the
// trainee could read their exam mark straight off the weakest-lessons list.
ok(!r.lessons.some(l => l.lesson === '1-2.3'), 'the exam lesson is absent from the analysis entirely');
eq(r.lessons.map(l => `${l.lesson}:${l.correct}/${l.total}`), ['1-1.1:2/2'],
  'only the practice questions are counted');

console.log('\n=== 3. And the attempt cannot be opened, id or no id ===');
r = get(api, 'my_attempt', { token: MINE, attemptId: 'E1' });
ok(!r.ok, 'asking for it by id is refused');
ok(/not released/i.test(r.error || ''), `and says why (got "${r.error}")`);
ok(!/correctAnswer|"items"/.test(JSON.stringify(r)), 'no answers come back with the refusal');
ok(get(api, 'my_attempt', { token: MINE, attemptId: 'P1' }).ok, 'the practice attempt still opens');

console.log('\n=== 4. The instructor sees the mark all along ===');
r = get(api, 'trainee_history', { token: T, energytechId: 'ET1001' });
const iExam = r.attempts.find(a => a.sessionCode === 'G1-2222');
eq([iExam.score, iExam.total], [1, 2], 'the exam mark is on the instructor\'s copy');
eq(iExam.released, true, 'and is not gated for them');
ok(r.lessons.some(l => l.lesson === '1-2.3'), 'the exam lesson counts in their analysis');
ok(get(api, 'attempt_detail', { token: T, attemptId: 'E1' }).ok, 'and they can open the paper');

console.log('\n=== 5. Releasing it ===');
let pub = get(api, 'session_publish', { token: T, sessionCode: 'G1-2222' });
ok(pub.ok && pub.published === true, 'the session is released');
r = get(api, 'my_history', { token: MINE });
const now = r.attempts.find(a => a.sessionCode === 'G1-2222');
eq(now.released, true, 'the trainee\'s row is released');
eq([now.score, now.total, now.percent], [1, 2, 50], 'with the mark');
ok(now.attemptId === 'E1', 'and an id to open it with');
ok(get(api, 'my_attempt', { token: MINE, attemptId: 'E1' }).ok, 'the paper opens');
eq(get(api, 'my_attempt', { token: MINE, attemptId: 'E1' }).attempt.orderSeed, 'ORD-abc',
  'carrying the per-launch seed, so the paper rebuilds as it was sat');
ok(r.lessons.some(l => l.lesson === '1-2.3'), 'and the lesson bars now include it');

console.log('\n=== 6. Releasing releases the whole group, and only that group ===');
const theirs = get(api, 'my_history', { token: OTHER });
const t2 = theirs.attempts.find(a => a.sessionCode === 'G1-2222');
eq(t2.released, true, 'the other trainee in the group sees theirs too');
eq(t2.score, 2, 'with their own mark, not anyone else\'s');
ok(!get(api, 'my_attempt', { token: OTHER, attemptId: 'E1' }).ok,
  'but still cannot open a classmate\'s paper');

console.log('\n=== 7. Hiding it again ===');
ok(get(api, 'session_unpublish', { token: T, sessionCode: 'G1-2222' }).published === false, 'it can be withdrawn');
eq(get(api, 'my_history', { token: MINE }).attempts.find(a => a.sessionCode === 'G1-2222').released, false,
  'and the mark goes back into hiding');
ok(!get(api, 'my_attempt', { token: MINE, attemptId: 'E1' }).ok, 'the paper shuts again');

console.log('\n=== 8. Who may release ===');
get(api, 'auth_signup', { username: 'sara', password: 'password1', displayName: 'Sara' });
get(api, 'admin_set_status', { token: T, targetUsername: 'sara', status: 'approved' });
const SARA = get(api, 'auth_login', { username: 'sara', password: 'password1' }).token;
r = get(api, 'session_publish', { token: SARA, sessionCode: 'G1-2222' });
ok(!r.ok, 'another instructor cannot release someone else\'s exam');
ok(!get(api, 'session_publish', { token: MINE, sessionCode: 'G1-2222' }).ok, 'nor can a trainee');
ok(!get(api, 'session_publish', {}).ok, 'nor an anonymous caller');
eq(get(api, 'my_history', { token: MINE }).attempts.find(a => a.sessionCode === 'G1-2222').released, false,
  'and after all that the mark is still hidden');
ok(!get(api, 'session_publish', { token: T, sessionCode: 'NOPE-1' }).ok, 'an unknown code is refused');

console.log('\n=== 9. The session list ===');
r = get(api, 'session_list', { token: T });
ok(r.ok, 'it loads');
eq(r.sessions.map(s => s.sessionCode).sort(), ['G1-1111', 'G1-2222'], 'both sessions, newest first');
const se = r.sessions.find(s => s.sessionCode === 'G1-2222');
eq(se.attempts, 2, 'with how many trainees have sat it');
eq(se.published, false, 'and whether the marks are out');
eq(se.shuffleEachLaunch, true, 'and whether it shuffles per launch');
eq(get(api, 'session_list', { token: SARA }).sessions.length, 0, 'another instructor sees none of them');
ok(!get(api, 'session_list', { token: MINE }).ok, 'and a trainee token cannot list sessions at all');

console.log('\n=== 10. A re-saved exam is a new exam ===');
// Saving over a code appends a fresh row, and the release does not carry over.
get(api, 'session_publish', { token: T, sessionCode: 'G1-2222' });
eq(get(api, 'my_history', { token: MINE }).attempts.find(a => a.sessionCode === 'G1-2222').released, true,
  'released again');
session('G1-2222', 'Midterm exam, second run', 'assessment');
eq(get(api, 'my_history', { token: MINE }).attempts.find(a => a.sessionCode === 'G1-2222').released, false,
  'and re-saving the session puts the marks back under wraps');

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
