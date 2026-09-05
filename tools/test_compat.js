/* Can the CURRENT (live) front-end keep working after the new Code.gs is
 * deployed over the top of the existing Sheet?
 *
 * This replays the old front-end's exact request shapes -- no traineeToken on
 * an attempt, no intake or allowWalkIn on a session -- against the new backend,
 * on a Sheet that starts with the OLD column layout and real data already in
 * it. If every check here passes, one Sheet can serve both sites and the old
 * Netlify build stays usable as a fallback. */

const { makeSpreadsheet, loadBackend, get, post } = require('/tmp/energytech_app/gas_stub.js');

let failures = [], checks = 0;
function ok(cond, label) {
  checks++;
  if (cond) console.log('  PASS  ' + label);
  else { console.log('  FAIL  ' + label); failures.push(label); }
}
function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), `${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

/* ---------------- a Sheet as the live deployment left it ---------------- */

const OLD_ATTEMPT_HEADERS = [
  'Timestamp', 'Attempt ID', 'Name', 'Group', 'EnergyTech ID', 'Session Code', 'Session Name',
  'Mode', 'Question Set', 'Question Set Key', 'Seed', 'Question Count', 'Order Mode',
  'Score', 'Total', 'Percentage', 'Wrong Questions', 'Unanswered Questions',
  'User Agent', 'Owner Username', 'Owner Display Name'
];
const OLD_SESSION_HEADERS = [
  'Timestamp', 'Session Code', 'Session Name', 'Group', 'Mode',
  'Question Set', 'Question Set Key', 'Seed', 'Question Count',
  'Order Mode', 'Show Original Numbers', 'Require All',
  'Owner Username', 'Owner Display Name'
];
const OLD_ITEM_HEADERS = [
  'Timestamp', 'Attempt ID', 'Name', 'Group', 'EnergyTech ID',
  'Session Code', 'Session Name', 'Mode', 'Question Set', 'Question Set Key', 'Seed',
  'Quiz Question', 'Original Question', 'Lesson',
  'Trainee Answer', 'Correct Answer', 'Result', 'Owner Username', 'Owner Display Name'
];

const ss = makeSpreadsheet();
const sessions = ss.insertSheet('Sessions');
sessions.appendRow(OLD_SESSION_HEADERS);
sessions.appendRow([new Date('2026-08-01T08:00:00Z'), 'G4-1111', 'Week 3 practice', 'G4', 'practice',
  'Original PDF worksheet', 'ch12:original_pdf', '20260801', 30, 'original', true, true,
  'adnen', 'Adnane Khalifa']);

const attempts = ss.insertSheet('Attempts');
attempts.appendRow(OLD_ATTEMPT_HEADERS);
attempts.appendRow([new Date('2026-08-01T08:40:00Z'), 'ATT-OLD-1', 'Khalid Al-Dosari', 'G4', 'ET0500',
  'G4-1111', 'Week 3 practice', 'practice', 'Original PDF worksheet', 'ch12:original_pdf',
  '20260801', 30, 'original', 24, 30, 80, 'Q3, Q9', '', 'old-ua', 'adnen', 'Adnane Khalifa']);
attempts.appendRow([new Date('2026-08-01T08:45:00Z'), 'ATT-OLD-2', 'Nasser Al-Shehri', 'G4', 'ET0501',
  'G4-1111', 'Week 3 practice', 'practice', 'Original PDF worksheet', 'ch12:original_pdf',
  '20260801', 30, 'original', 27, 30, 90, 'Q7', '', 'old-ua', 'adnen', 'Adnane Khalifa']);

const items = ss.insertSheet('ItemResponses');
items.appendRow(OLD_ITEM_HEADERS);

// The Instructors sheet already exists with the real admin on it. Rather than
// hand-build the hash, let the new code create it and log in with the default.
const { api } = loadBackend(ss);

console.log('\n=== 1. Deploying the new code over the old Sheet ===');
let r = get(api, 'ping');
ok(r.ok, 'the backend answers after the upgrade');
eq(attempts.rows[0].length, 24, 'Attempts header grew to 24 columns');
eq(attempts.rows[0][21], 'Intake', 'column 22 is Intake');
eq(attempts.rows[0][22], 'Registered', 'column 23 is Registered');
eq(attempts.rows[0][23], 'Order Seed', 'column 24 is Order Seed');
eq(sessions.rows[0].length, 18, 'Sessions header grew to 18 columns');
eq(sessions.rows[0][15], 'Allow Walk-In', 'column 16 is Allow Walk-In');
eq(sessions.rows[0][16], 'Shuffle Each Launch', 'column 17 is Shuffle Each Launch');
eq(sessions.rows[0][17], 'Results Published', 'column 18 is Results Published');
// An exam sat before the release gate existed has an empty Results Published
// cell, which reads as "not released". Nothing on an upgraded Sheet is lost,
// but old exam marks do go quiet until the instructor releases them.
eq(String(sessions.rows[1][17] || ''), '', 'the historical session has no release stamp');
eq(attempts.rows.length, 3, 'the two historical attempts are still there');
eq(attempts.rows[1][2], 'Khalid Al-Dosari', 'the first historical row is untouched');
eq(sessions.rows[1][1], 'G4-1111', 'the historical session is untouched');
ok(Boolean(ss.getSheetByName('Intakes') && ss.getSheetByName('Groups') && ss.getSheetByName('Trainees')),
  'the three roster sheets were added alongside');

const ADMIN = get(api, 'auth_login', { username: 'adnen', password: '12341234' }).token;
ok(Boolean(ADMIN), 'the admin account still logs in');

console.log('\n=== 2. The OLD front-end can still load a session it made before ===');
r = get(api, 'session', { code: 'G4-1111' });
ok(r.ok, 'the pre-upgrade session code still resolves');
eq(r.session.questionSetKey, 'ch12:original_pdf', 'its question set survived');
eq(r.session.allowWalkIn, false, 'a session from before the flag existed keeps guests out');

console.log('\n=== 3. The OLD front-end can still create a session ===');
// Exactly the payload the live build sends: no intake, no allowWalkIn.
r = post(api, {
  type: 'quiz_session', token: ADMIN,
  session: {
    sessionCode: 'G4-2222', sessionName: 'Old build session', group: 'G4', mode: 'assessment',
    questionSet: 'Version B', questionSetKey: 'ch03:version_b', seed: '99', questionCount: 20,
    orderMode: 'shuffled', showOriginalNumbers: true, requireAll: true
  }
});
ok(r.ok, 'the old-shaped session payload is accepted');
r = get(api, 'session', { code: 'G4-2222' });
ok(r.ok && r.session.mode === 'assessment', 'and it reads back correctly');
eq(r.session.intake, '', 'no intake, as the old build sends none');

console.log('\n=== 4. The OLD front-end can still submit an attempt ===');
// The live build has no trainee accounts, so it types the identity and sends
// no token. That must still be recorded, and attributed to the right owner.
r = post(api, {
  type: 'quiz_attempt', attemptId: 'ATT-OLD-3',
  student: { name: 'Salem Al-Mutairi', group: 'G4', energytechId: 'ET0502', spspId: 'ET0502' },
  quiz: {
    sessionCode: 'G4-2222', sessionName: 'Old build session', mode: 'assessment',
    questionSet: 'Version B', questionSetKey: 'ch03:version_b', seed: '99',
    questionCount: 2, orderMode: 'shuffled'
  },
  score: { correct: 1, total: 2, percent: 50, wrongQuestions: ['Q2'], unansweredQuestions: [] },
  items: [
    { quizNumber: 1, originalNumber: 4, lesson: '3-1.1', studentAnswer: 'a', correctAnswer: 'a', result: 'correct' },
    { quizNumber: 2, originalNumber: 9, lesson: '3-1.2', studentAnswer: 'b', correctAnswer: 'c', result: 'wrong' }
  ],
  userAgent: 'old-build'
});
ok(r.ok, 'the old-shaped attempt payload is accepted');
const row = attempts.rows[attempts.rows.length - 1];
eq(row[2], 'Salem Al-Mutairi', 'the typed name was recorded');
eq(row[4], 'ET0502', 'the typed EnergyTech ID was recorded');
eq(row[19], 'adnen', 'the attempt was attributed to the session owner');
eq(row[21], '', 'Intake is left blank, as there is no roster behind it');
eq(row[22], 'walk-in', 'it is marked walk-in, which is what an accountless submission is');
eq(items.rows.length, 3, 'both item rows were written');

console.log('\n=== 5. Both builds writing to the same Sheet ===');
get(api, 'intake_save', { token: ADMIN, label: 'JAN26' });
get(api, 'group_save', { token: ADMIN, intake: 'JAN26', name: 'G4' });
get(api, 'trainee_save', { token: ADMIN, energytechId: 'ET0600', name: 'Omar Al-Harbi', intake: 'JAN26', group: 'G4' });
const TR = get(api, 'trainee_signup', { energytechId: 'ET0600', password: 'secret1' }).token;
ok(Boolean(TR), 'a trainee on the new build signs up on the same Sheet');
post(api, {
  type: 'quiz_attempt', attemptId: 'ATT-NEW-1', traineeToken: TR,
  student: { name: 'ignored', group: 'ignored', energytechId: 'ignored' },
  quiz: { sessionCode: 'G4-2222', questionSet: 'Version B', seed: '99', questionCount: 1, orderMode: 'shuffled', mode: 'assessment' },
  score: { correct: 1, total: 1, percent: 100, wrongQuestions: [], unansweredQuestions: [] },
  items: []
});
const newRow = attempts.rows[attempts.rows.length - 1];
eq(newRow[22], 'yes', 'the new build\'s attempt is marked registered');
eq(newRow[21], 'JAN26', 'and carries its intake');

console.log('\n=== 6. The dashboard reads old and new rows together ===');
const summary = get(api, 'summary', { token: ADMIN });
ok(summary.ok, 'the dashboard loads');
eq(summary.attempts.length, 4, 'all four attempts are listed: 2 historical, 1 old-build, 1 new-build');
const byId = Object.fromEntries(summary.attempts.map(a => [a.attemptId, a]));
ok(byId['ATT-OLD-1'] && byId['ATT-OLD-1'].name === 'Khalid Al-Dosari', 'a pre-upgrade row still reads correctly');
eq(byId['ATT-OLD-1'].registered, '', 'a pre-upgrade row simply has no Registered value');
eq(byId['ATT-OLD-3'].registered, 'walk-in', 'an old-build submission reads as walk-in');
eq(byId['ATT-NEW-1'].registered, 'yes', 'a new-build submission reads as registered');
ok(summary.attempts.every(a => a.score !== undefined && a.total !== undefined), 'every row still has its score');

console.log('\n=== 7. Instructor account actions the old build uses ===');
r = get(api, 'auth_signup', { username: 'omar', password: 'password1', displayName: 'Omar' });
ok(r.ok, 'a colleague can still request an account');
r = get(api, 'admin_list_instructors', { token: ADMIN });
ok(r.ok && r.instructors.length >= 2, 'the admin panel still lists accounts');
r = get(api, 'admin_set_status', { token: ADMIN, targetUsername: 'omar', status: 'approved' });
ok(r.ok, 'approving still works');
r = get(api, 'auth_change_password', { token: ADMIN, oldPassword: '12341234', newPassword: 'newpass1' });
ok(r.ok, 'changing an instructor password still works');
ok(get(api, 'auth_login', { username: 'adnen', password: 'newpass1' }).ok, 'and the new password works');

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
