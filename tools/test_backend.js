/* Runs the real Code.gs in Node against an in-memory stand-in for
 * SpreadsheetApp / Utilities, so the intake module's rules are checked against
 * the code that will actually be deployed rather than against a mock of it.
 * The stand-in lives in gas_stub.js and models Sheets' type coercion. */

const { loadBackend, get, post } = require('/tmp/energytech_app/gas_stub.js');

let failures = [], checks = 0;
function ok(cond, label) {
  checks++;
  if (cond) console.log('  PASS  ' + label);
  else { console.log('  FAIL  ' + label); failures.push(label); }
}
function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), `${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

/* ---------------- the run ---------------- */

const { ss, api } = loadBackend();
api.setup();

console.log('\n=== 1. Bootstrap admin and a second instructor ===');
let r = get(api, 'auth_login', { username: 'adnen', password: '12341234' });
ok(r.ok && r.token && r.role === 'admin', 'bootstrap admin can log in');
const ADMIN = r.token;

r = get(api, 'auth_signup', { username: 'sara', password: 'password1', displayName: 'Sara' });
ok(r.ok, 'a colleague can request an account');
r = get(api, 'auth_login', { username: 'sara', password: 'password1' });
ok(!r.ok, 'an unapproved colleague cannot log in yet');
r = get(api, 'admin_set_status', { token: ADMIN, targetUsername: 'sara', status: 'approved' });
ok(r.ok, 'admin approves the request');
r = get(api, 'auth_login', { username: 'sara', password: 'password1' });
ok(r.ok && r.role === 'instructor', 'approved colleague logs in as an instructor');
const INSTR = r.token;

console.log('\n=== 2. Only an admin may edit the roster ===');
r = get(api, 'intake_save', { token: INSTR, label: 'JAN26' });
ok(!r.ok && /[Aa]dmin/.test(r.error || ''), 'a plain instructor cannot create an intake');
r = get(api, 'roster_list', { token: INSTR });
ok(r.ok, 'a plain instructor can read the roster');
r = get(api, 'intake_save', { label: 'JAN26' });
ok(!r.ok, 'no token, no write');

console.log('\n=== 3. Intakes ===');
r = get(api, 'intake_save', { token: ADMIN, label: 'JAN26' });
ok(r.ok, 'admin creates JAN26');
r = get(api, 'intake_save', { token: ADMIN, label: 'jan26' });
ok(!r.ok, 'a duplicate label is refused, case-insensitively');
r = get(api, 'intake_save', { token: ADMIN, label: '' });
ok(!r.ok, 'an empty label is refused');
get(api, 'intake_save', { token: ADMIN, label: 'FEB26' });
eq(get(api, 'roster_list', { token: ADMIN }).intakes.map(i => i.label), ['JAN26', 'FEB26'], 'both intakes listed');

console.log('\n=== 4. Groups ===');
r = get(api, 'group_save', { token: ADMIN, intake: 'JAN26', name: 'G1' });
ok(r.ok, 'G1 created');
r = get(api, 'group_save', { token: ADMIN, intake: 'JAN26', name: 'g2' });
ok(r.ok, 'lower-case g2 accepted and normalised');
r = get(api, 'group_save', { token: ADMIN, intake: 'JAN26', name: 'G21' });
ok(!r.ok, 'G21 refused');
r = get(api, 'group_save', { token: ADMIN, intake: 'JAN26', name: 'G0' });
ok(!r.ok, 'G0 refused');
r = get(api, 'group_save', { token: ADMIN, intake: 'JAN26', name: 'G20' });
ok(r.ok, 'G20 accepted');
r = get(api, 'group_save', { token: ADMIN, intake: 'NOPE', name: 'G1' });
ok(!r.ok, 'a group cannot be attached to an unknown intake');
r = get(api, 'group_save', { token: ADMIN, intake: 'JAN26', name: 'G1' });
ok(!r.ok, 'a duplicate group in the same intake is refused');
r = get(api, 'group_save', { token: ADMIN, intake: 'FEB26', name: 'G1' });
ok(r.ok, 'the same group name is fine in a different intake');
eq(get(api, 'roster_list', { token: ADMIN }).groups.filter(g => g.intake === 'JAN26').map(g => g.name).sort(),
  ['G1', 'G2', 'G20'], 'JAN26 holds G1, G2 and G20');

console.log('\n=== 5. Trainees ===');
r = get(api, 'trainee_save', { token: ADMIN, energytechId: 'ET1001', name: 'Mohammed Abdullah Saleh Al-Otaibi', intake: 'JAN26', group: 'G1' });
ok(r.ok, 'a trainee is added to JAN26 / G1');
r = get(api, 'trainee_save', { token: ADMIN, energytechId: 'ET1001', name: 'X Y', intake: 'JAN26', group: 'G2' });
ok(!r.ok, 'saving an existing ID as if it were new is refused');
r = get(api, 'trainee_save', { token: ADMIN, energytechId: 'ET1001', previousId: 'ET1001', name: 'X Y', intake: 'JAN26', group: 'G2' });
ok(r.ok, 'naming previousId edits and moves the row');
let list = get(api, 'trainee_list', { token: ADMIN }).trainees;
eq(list.length, 1, 'still one row for that ID');
eq(list[0].group, 'G2', 'the trainee moved to G2');
// put them back
get(api, 'trainee_save', { token: ADMIN, energytechId: 'ET1001', previousId: 'ET1001', name: 'Mohammed Abdullah Saleh Al-Otaibi', intake: 'JAN26', group: 'G1' });
r = get(api, 'trainee_save', { token: ADMIN, energytechId: '', name: 'A B', intake: 'JAN26', group: 'G1' });
ok(!r.ok, 'a trainee with no ID is refused');
r = get(api, 'trainee_save', { token: ADMIN, energytechId: 'ET2', name: 'A B', intake: 'JAN26', group: 'G9' });
ok(!r.ok, 'a trainee cannot be attached to a group that does not exist');

console.log('\n=== 6. CSV import (POST) ===');
post(api, {
  type: 'trainee_import', token: ADMIN, intake: 'JAN26', group: 'G1',
  rows: [
    { energytechId: 'ET1002', name: 'Fahad Abdulrahman Nasser Al Qahtani' },
    { energytechId: 'et1003', name: 'Turki Saad Al-Ghamdi' },
    { energytechId: 'ET1001', name: 'Dup Dup' },
    { energytechId: '', name: 'No Id' }
  ]
});
list = get(api, 'trainee_list', { token: ADMIN, intake: 'JAN26', group: 'G1' }).trainees;
eq(list.length, 3, 'three trainees in G1 after the import');
ok(list.some(t => t.energytechId === 'ET1003'), 'a lower-case ID was normalised on import');
ok(/Al-Otaibi/.test(list.find(t => t.energytechId === 'ET1001').name), 'the duplicate did not overwrite the existing row');
ok(list.find(t => t.energytechId === 'ET1002').name === 'Fahad Abdulrahman Nasser Al Qahtani', 'a long name survives the round trip');
r = post(api, { type: 'trainee_import', token: INSTR, intake: 'JAN26', group: 'G2', rows: [{ energytechId: 'ET5', name: 'A B' }] });
ok(!r.ok, 'a plain instructor cannot import');

console.log('\n=== 7. Deleting is blocked while children exist ===');
r = get(api, 'intake_delete', { token: ADMIN, label: 'JAN26' });
ok(!r.ok && /group/i.test(r.error || ''), 'intake with groups is kept, and the reason says so');
r = get(api, 'group_delete', { token: ADMIN, intake: 'JAN26', name: 'G1' });
ok(!r.ok && /trainee/i.test(r.error || ''), 'group with trainees is kept, and the reason says so');
r = get(api, 'group_delete', { token: ADMIN, intake: 'JAN26', name: 'G20' });
ok(r.ok, 'an empty group is deleted');
r = get(api, 'intake_delete', { token: ADMIN, label: 'FEB26' });
ok(!r.ok, 'FEB26 still has G1, so it is kept');
get(api, 'group_delete', { token: ADMIN, intake: 'FEB26', name: 'G1' });
r = get(api, 'intake_delete', { token: ADMIN, label: 'FEB26' });
ok(r.ok, 'an empty intake is deleted');

console.log('\n=== 8. Renaming cascades ===');
get(api, 'intake_save', { token: ADMIN, label: 'MAR26' });
get(api, 'group_save', { token: ADMIN, intake: 'MAR26', name: 'G5' });
r = get(api, 'intake_save', { token: ADMIN, label: 'APR26', previousLabel: 'MAR26' });
ok(r.ok, 'intake renamed');
const rl = get(api, 'roster_list', { token: ADMIN });
ok(rl.intakes.some(i => i.label === 'APR26') && !rl.intakes.some(i => i.label === 'MAR26'), 'only the new label remains');
ok(rl.groups.some(g => g.intake === 'APR26' && g.name === 'G5'), 'the group followed the rename');

r = get(api, 'group_save', { token: ADMIN, intake: 'JAN26', name: 'G3', previousName: 'G2' });
ok(r.ok, 'group renamed');
ok(get(api, 'roster_list', { token: ADMIN }).groups.some(g => g.intake === 'JAN26' && g.name === 'G3'), 'G2 is now G3');

get(api, 'trainee_save', { token: ADMIN, energytechId: 'ET3001', name: 'Q W', intake: 'APR26', group: 'G5' });
get(api, 'intake_save', { token: ADMIN, label: 'MAY26', previousLabel: 'APR26' });
eq(get(api, 'trainee_list', { token: ADMIN, intake: 'MAY26' }).trainees.length, 1, 'the trainee followed the intake rename');

console.log('\n=== 9. Trainee accounts ===');
r = get(api, 'trainee_signup', { energytechId: 'ET9999', password: 'secret1' });
ok(!r.ok, 'an ID that is not on a list cannot sign up');
r = get(api, 'trainee_signup', { energytechId: 'ET1001', password: 'abc' });
ok(!r.ok, 'a short password is refused');
r = get(api, 'trainee_signup', { energytechId: 'et1001', password: 'secret1' });
ok(r.ok && r.token, 'signup works, and the ID is matched case-insensitively');
let TR = r.token;
ok(r.trainee && r.trainee.intake === 'JAN26' && r.trainee.group === 'G1', 'signup returns intake and group');
ok(r.trainee && r.trainee.password === undefined && r.trainee.passwordHash === undefined, 'no password material is returned');
ok(r.trainee && r.trainee.accountStatus === 'active', 'signup reports the account as active');
r = get(api, 'trainee_signup', { energytechId: 'ET1001', password: 'secret1' });
ok(!r.ok, 'signing up twice is refused');
r = get(api, 'trainee_login', { energytechId: 'ET1001', password: 'wrong' });
ok(!r.ok, 'a wrong password is refused');
const beforeRelogin = TR;
r = get(api, 'trainee_login', { energytechId: 'ET1001', password: 'secret1' });
ok(r.ok && r.token, 'login works');
TR = r.token;
ok(!get(api, 'trainee_me', { token: beforeRelogin }).ok, 'logging in again retires the previous token');
r = get(api, 'trainee_me', { token: TR });
ok(r.ok && r.trainee.energytechId === 'ET1001', 'trainee_me reports the profile');

r = get(api, 'trainee_change_password', { token: TR, oldPassword: 'nope', newPassword: 'secret2' });
ok(!r.ok, 'changing the password needs the current one');
r = get(api, 'trainee_change_password', { token: TR, oldPassword: 'secret1', newPassword: 'secret2' });
ok(r.ok, 'password changed');
ok(!get(api, 'trainee_login', { energytechId: 'ET1001', password: 'secret1' }).ok, 'the old password no longer works');
const TR2 = get(api, 'trainee_login', { energytechId: 'ET1001', password: 'secret2' }).token;
ok(Boolean(TR2), 'the new password works');
ok(get(api, 'trainee_signup', { energytechId: 'ET1001', password: 'secret1' }).error !== undefined, 'signup stays closed once an account exists');

console.log('\n=== 10. Revoking a login ===');
r = get(api, 'trainee_set_account', { token: INSTR, energytechId: 'ET1001', status: 'revoked' });
ok(!r.ok, 'a plain instructor cannot revoke');
r = get(api, 'trainee_set_account', { token: ADMIN, energytechId: 'ET1001', status: 'revoked' });
ok(r.ok, 'admin revokes the login');
ok(!get(api, 'trainee_login', { energytechId: 'ET1001', password: 'secret2' }).ok, 'a revoked trainee cannot log in');
ok(!get(api, 'trainee_me', { token: TR2 }).ok, 'a revoked trainee\'s existing token stops working');
get(api, 'trainee_set_account', { token: ADMIN, energytechId: 'ET1001', status: 'active' });
const TR3 = get(api, 'trainee_login', { energytechId: 'ET1001', password: 'secret2' }).token;
ok(Boolean(TR3), 'restoring lets them back in');

console.log('\n=== 11. Attempts take their identity from the token ===');
post(api, {
  type: 'quiz_session', token: ADMIN,
  session: { sessionCode: 'G1-1234', sessionName: 'Test', intake: 'JAN26', group: 'G1', mode: 'practice', questionSetKey: 'ch12:original_pdf', allowWalkIn: true }
});
const sess = get(api, 'session', { code: 'G1-1234' });
ok(sess.ok, 'the session was stored');
eq(sess.session.intake, 'JAN26', 'the session carries its intake');
eq(sess.session.allowWalkIn, true, 'the session carries the walk-in flag');
post(api, { type: 'quiz_session', token: ADMIN, session: { sessionCode: 'G1-9999', sessionName: 'Closed', intake: 'JAN26', group: 'G1', mode: 'practice', questionSetKey: 'ch12:original_pdf' } });
eq(get(api, 'session', { code: 'G1-9999' }).session.allowWalkIn, false, 'a session with no flag keeps guests out');

post(api, {
  type: 'quiz_attempt', attemptId: 'A1', traineeToken: TR3,
  student: { name: 'SOMEONE ELSE', group: 'G99', energytechId: 'FAKE' },
  quiz: { sessionCode: 'G1-1234', questionSet: 'x', seed: '1', questionCount: 2, orderMode: 'original', mode: 'practice' },
  score: { correct: 2, total: 2, percent: 100, wrongQuestions: [], unansweredQuestions: [] },
  items: []
});
let att = ss.sheets.Attempts.rows[ss.sheets.Attempts.rows.length - 1];
eq(att[2], 'Mohammed Abdullah Saleh Al-Otaibi', 'the name came from the roster, not the browser');
eq(att[4], 'ET1001', 'the ID came from the roster, not the browser');
eq(att[21], 'JAN26', 'the intake was filled in');
eq(att[22], 'yes', 'marked as registered');

post(api, {
  type: 'quiz_attempt', attemptId: 'A2',
  student: { name: 'Guest Trainee', group: 'G7', energytechId: 'ET7777' },
  quiz: { sessionCode: 'G1-1234', questionSet: 'x', seed: '1', questionCount: 2, orderMode: 'original', mode: 'practice' },
  score: { correct: 1, total: 2, percent: 50, wrongQuestions: ['Q2'], unansweredQuestions: [] },
  items: []
});
att = ss.sheets.Attempts.rows[ss.sheets.Attempts.rows.length - 1];
eq(att[2], 'Guest Trainee', 'a walk-in keeps the typed name');
eq(att[22], 'walk-in', 'marked as a walk-in');

post(api, {
  type: 'quiz_attempt', attemptId: 'A3', traineeToken: 'GARBAGE',
  student: { name: 'Spoofer', group: 'G1', energytechId: 'ET1001' },
  quiz: { sessionCode: 'G1-1234', questionSet: 'x', seed: '1', questionCount: 1, orderMode: 'original', mode: 'practice' },
  score: { correct: 1, total: 1, percent: 100, wrongQuestions: [], unansweredQuestions: [] },
  items: []
});
att = ss.sheets.Attempts.rows[ss.sheets.Attempts.rows.length - 1];
eq(att[22], 'walk-in', 'a bogus token does not buy a registered attempt');

const summary = get(api, 'summary', { token: ADMIN });
ok(summary.ok && summary.attempts.length === 3, 'the dashboard sees all three attempts');
ok(summary.attempts.some(a => a.intake === 'JAN26' && a.registered === 'yes'), 'the dashboard reports intake and registration');

console.log('\n=== 12. A trainee with attempts is kept ===');
r = get(api, 'trainee_delete', { token: ADMIN, energytechId: 'ET1001' });
ok(!r.ok && /attempt/i.test(r.error || ''), 'delete refused, and the reason says why');
r = get(api, 'trainee_delete', { token: ADMIN, energytechId: 'ET1003' });
ok(r.ok, 'a trainee with no attempts is deleted');
ok(!get(api, 'trainee_list', { token: ADMIN }).trainees.some(t => t.energytechId === 'ET1003'), 'the row is gone');

console.log('\n=== 13. ensureHeaders_ upgrades an old sheet in place ===');
{
  const { ss: ss2, api: api2 } = loadBackend();
  // An Attempts sheet as an earlier deployment left it: 21 columns, one row.
  const old = api2.SpreadsheetApp === undefined ? null : null;
  const sheet = ss2.insertSheet('Attempts');
  sheet.appendRow([
    'Timestamp', 'Attempt ID', 'Name', 'Group', 'EnergyTech ID', 'Session Code', 'Session Name',
    'Mode', 'Question Set', 'Question Set Key', 'Seed', 'Question Count', 'Order Mode',
    'Score', 'Total', 'Percentage', 'Wrong Questions', 'Unanswered Questions',
    'User Agent', 'Owner Username', 'Owner Display Name'
  ]);
  sheet.appendRow([new Date(), 'OLD-1', 'Existing Trainee', 'G4', 'ET0001', 'X-1', 'Old session',
    'practice', 'set', 'key', '1', 5, 'original', 4, 5, 80, 'Q2', '', 'ua', 'adnen', 'Adnane Khalifa']);
  ss2.insertSheet('Sessions').appendRow(['Timestamp']);
  ss2.insertSheet('ItemResponses').appendRow(['Timestamp']);
  api2.ensureSheets_();
  const head = sheet.rows[0];
  ok(head[21] === 'Intake' && head[22] === 'Registered', 'the two new columns were appended');
  eq(sheet.rows[1][2], 'Existing Trainee', 'the existing attempt row was left intact');
  eq(sheet.rows.length, 2, 'no rows were added or lost');
  ok(Boolean(ss2.getSheetByName('Intakes') && ss2.getSheetByName('Groups') && ss2.getSheetByName('Trainees')),
    'the three roster sheets were created');
}

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
