/* The trainee profile: everything one person has done, and which lessons they
 * are weakest at. Instructors see only their own trainees; admins see all. */
const { makeSpreadsheet, loadBackend, get, post } = require('/tmp/energytech_app/gas_stub.js');
let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const { ss, api } = loadBackend(makeSpreadsheet());
api.setup();
const T = get(api, 'auth_login', { username: 'adnen', password: '12341234' }).token;
get(api, 'intake_save', { token: T, label: 'JAN26' });
get(api, 'group_save', { token: T, intake: 'JAN26', name: 'G1' });
get(api, 'trainee_save', { token: T, energytechId: 'ET1001', name: 'Mohammed Abdullah Saleh Al-Otaibi', intake: 'JAN26', group: 'G1' });
get(api, 'trainee_save', { token: T, energytechId: 'ET1002', name: 'Fahad Al-Qahtani', intake: 'JAN26', group: 'G1' });
const TOK = get(api, 'trainee_signup', { energytechId: 'ET1001', password: 'secret1' }).token;

post(api, { type: 'quiz_session', token: T, session: { sessionCode: 'G1-1111', sessionName: 'Week 1', intake: 'JAN26', group: 'G1', mode: 'practice', questionSetKey: 'ch12:original_pdf', seed: '111', questionCount: 4, orderMode: 'original' } });
post(api, { type: 'quiz_session', token: T, session: { sessionCode: 'G1-2222', sessionName: 'Week 2', intake: 'JAN26', group: 'G1', mode: 'assessment', questionSetKey: 'ch03:version_b', seed: '222', questionCount: 3, orderMode: 'shuffled' } });

const item = (q, orig, lesson, ans, correct) =>
  ({ quizNumber: q, originalNumber: orig, lesson, studentAnswer: ans, correctAnswer: correct,
     result: ans === correct ? 'correct' : (ans ? 'wrong' : 'unanswered') });

function attempt(id, code, seed, key, count, order, items, when) {
  post(api, { type: 'quiz_attempt', attemptId: id, traineeToken: TOK,
    quiz: { sessionCode: code, sessionName: '', mode: 'practice', questionSet: 'set',
            questionSetKey: key, seed, questionCount: count, orderMode: order },
    score: { correct: items.filter(i => i.result === 'correct').length, total: items.length,
             percent: Math.round(items.filter(i => i.result === 'correct').length / items.length * 100),
             wrongQuestions: [], unansweredQuestions: [] },
    items });
  if (when) {           // make the ordering deterministic
    const rows = ss.sheets.Attempts.rows;
    rows[rows.length - 1][0] = when;
  }
}

attempt('A1', 'G1-1111', '111', 'ch12:original_pdf', 4, 'original', [
  item(1, 3, '1-1.1', 'a', 'a'), item(2, 7, '1-1.1', 'b', 'c'),
  item(3, 12, '1-2.3', 'd', 'd'), item(4, 20, '1-2.3', 'a', 'a')],
  new Date('2026-08-01T09:00:00Z'));
attempt('A2', 'G1-2222', '222', 'ch03:version_b', 3, 'shuffled', [
  item(1, 5, '1-1.1', '', 'b'), item(2, 9, '3-2.3', 'c', 'a'),
  item(3, 14, '3-2.3', 'b', 'b')],
  new Date('2026-08-08T09:00:00Z'));

console.log('\n=== 1. The history comes back newest first ===');
let r = get(api, 'trainee_history', { token: T, energytechId: 'ET1001' });
ok(r.ok, 'history loads');
eq(r.trainee.name, 'Mohammed Abdullah Saleh Al-Otaibi', 'it names the trainee');
eq(r.trainee.group, 'G1', 'and says where they are');
eq(r.attempts.map(a => a.attemptId), ['A2', 'A1'], 'attempts are newest first');
eq(r.attempts[1].score + '/' + r.attempts[1].total, '3/4', 'the first attempt scored 3 of 4');
eq(r.attempts[0].sessionCode, 'G1-2222', 'the session code is carried');
ok(r.attempts[0].seed === '222' && r.attempts[0].questionSetKey === 'ch03:version_b' && r.attempts[0].orderMode === 'shuffled',
  'and everything needed to rebuild the paper');

console.log('\n=== 2. Weakest lessons first ===');
// 1-1.1: 1 of 3 correct (33%). 1-2.3: 2 of 2 (100%). 3-2.3: 1 of 2 (50%).
eq(r.lessons.map(l => `${l.lesson}:${l.correct}/${l.total}:${l.percent}%`),
  ['1-1.1:1/3:33%', '3-2.3:1/2:50%', '1-2.3:2/2:100%'],
  'lessons ranked worst first, across every attempt');

console.log('\n=== 3. An unanswered question counts against the lesson ===');
ok(r.lessons.find(l => l.lesson === '1-1.1').total === 3, 'the skipped question is still counted in the total');
ok(r.lessons.find(l => l.lesson === '1-1.1').correct === 1, 'but not as correct');

console.log('\n=== 4. One attempt in full ===');
r = get(api, 'attempt_detail', { token: T, attemptId: 'A1' });
ok(r.ok, 'the attempt loads');
eq(r.attempt.score + '/' + r.attempt.total, '3/4', 'with its score');
eq(r.attempt.name, 'Mohammed Abdullah Saleh Al-Otaibi', 'and the trainee it belongs to');
eq(r.items.length, 4, 'four questions');
eq(r.items.map(i => i.quizNumber), [1, 2, 3, 4], 'in quiz order');
eq(r.items[1], { quizNumber: 2, originalNumber: 7, lesson: '1-1.1', answer: 'b', correctAnswer: 'c', result: 'wrong' },
  'each carries the answer given, the right one, and the verdict');

console.log('\n=== 5. A trainee with nothing on record ===');
r = get(api, 'trainee_history', { token: T, energytechId: 'ET1002' });
ok(r.ok, 'still succeeds');
eq(r.attempts.length, 0, 'no attempts');
eq(r.lessons.length, 0, 'and no lesson tallies to show');
eq(r.trainee.name, 'Fahad Al-Qahtani', 'but the trainee is still named');

console.log('\n=== 6. Guards ===');
ok(!get(api, 'trainee_history', { energytechId: 'ET1001' }).ok, 'no token, no history');
ok(!get(api, 'attempt_detail', { token: T, attemptId: 'NOPE' }).ok, 'an unknown attempt is refused');
ok(!get(api, 'trainee_history', { token: T, energytechId: '' }).ok, 'an empty ID is refused');

console.log('\n=== 7. An instructor sees only their own trainees\' attempts ===');
get(api, 'auth_signup', { username: 'sara', password: 'password1', displayName: 'Sara' });
get(api, 'admin_set_status', { token: T, targetUsername: 'sara', status: 'approved' });
const INSTR = get(api, 'auth_login', { username: 'sara', password: 'password1' }).token;
r = get(api, 'trainee_history', { token: INSTR, energytechId: 'ET1001' });
ok(r.ok, 'another instructor may look');
eq(r.attempts.length, 0, 'but sees no attempts, since both sessions are Adnane\'s');
eq(r.lessons.length, 0, 'and no lesson tallies either');
ok(!get(api, 'attempt_detail', { token: INSTR, attemptId: 'A1' }).ok, 'and cannot open one directly');
// Sara runs her own session; then she sees that one and only that one.
post(api, { type: 'quiz_session', token: INSTR, session: { sessionCode: 'G1-3333', sessionName: 'Sara', intake: 'JAN26', group: 'G1', mode: 'practice', questionSetKey: 'ch12:original_pdf', seed: '333', questionCount: 2, orderMode: 'original' } });
attempt('A3', 'G1-3333', '333', 'ch12:original_pdf', 2, 'original', [
  item(1, 1, '1-1.1', 'a', 'a'), item(2, 2, '1-1.1', 'b', 'a')]);
r = get(api, 'trainee_history', { token: INSTR, energytechId: 'ET1001' });
eq(r.attempts.map(a => a.attemptId), ['A3'], 'she sees her own session only');
eq(r.lessons.map(l => `${l.lesson}:${l.correct}/${l.total}`), ['1-1.1:1/2'], 'and only her own questions count');
eq(get(api, 'trainee_history', { token: T, energytechId: 'ET1001' }).attempts.length, 3, 'the admin sees all three');

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
