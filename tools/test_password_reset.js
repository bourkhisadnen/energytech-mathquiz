/* Resetting a forgotten password.
 *
 * There is no email in this app, so a reset is one person doing it for another
 * who is standing in front of them: an admin presses the button, reads out the
 * temporary password it gives back, and the account has to choose its own
 * before it can do anything else.
 *
 * The parts worth testing are the boundaries, not the happy path. Who may reset
 * whom. That the old password really stops working. That the temporary one
 * cannot be read back afterwards. And above all that "must change" is a refusal
 * and not a suggestion -- a password read aloud in a corridor must not still be
 * working next month. */
const { makeSpreadsheet, loadBackend, get, post } = require('/tmp/energytech_app/gas_stub.js');

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const { ss, api } = loadBackend(makeSpreadsheet());
api.setup();

const ADMIN = get(api, 'auth_login', { username: 'adnen', password: '12341234' }).token;
get(api, 'auth_signup', { username: 'sara', password: 'sarapass1', displayName: 'Sara' });
get(api, 'admin_set_status', { token: ADMIN, targetUsername: 'sara', status: 'approved' });
get(api, 'auth_signup', { username: 'omar', password: 'omarpass1', displayName: 'Omar' });
get(api, 'admin_set_status', { token: ADMIN, targetUsername: 'omar', status: 'approved' });
get(api, 'admin_set_role', { token: ADMIN, targetUsername: 'omar', role: 'admin' });

get(api, 'intake_save', { token: ADMIN, label: 'JAN26' });
get(api, 'group_save', { token: ADMIN, intake: 'JAN26', name: 'G1' });
get(api, 'trainee_save', { token: ADMIN, energytechId: 'ET1001', name: 'Mohammed Al-Otaibi', intake: 'JAN26', group: 'G1' });
get(api, 'trainee_save', { token: ADMIN, energytechId: 'ET1002', name: 'Fahad Al-Qahtani', intake: 'JAN26', group: 'G1' });
get(api, 'trainee_save', { token: ADMIN, energytechId: 'ET1003', name: 'No Account Yet', intake: 'JAN26', group: 'G1' });

console.log('\n=== 1. An instructor who has forgotten theirs ===');
let sara = get(api, 'auth_login', { username: 'sara', password: 'sarapass1' });
ok(sara.ok, 'Sara can log in to begin with');
const saraOldToken = sara.token;

let r = get(api, 'admin_reset_instructor_password', { token: ADMIN, targetUsername: 'sara' });
ok(r.ok, 'the admin resets it');
const saraTemp = r.temporaryPassword;
ok(typeof saraTemp === 'string' && saraTemp.length >= 6, `a temporary password comes back (${saraTemp})`);
eq(r.username, 'sara', 'for the account that was asked for');

console.log('\n=== 2. The reset signs her out of wherever she was ===');
// Somebody who has forgotten a password may well have lost the device it was
// signed in on. The reset is the moment to close that.
//
// This has to be asked before she logs back in. A login issues a new token and
// writes it over the stored one, which kills the old session by itself and so
// would hide whether the reset ever did.
//
// Checking only that the old token stops working proves nothing either: the
// account is flagged must-change at the same moment, and that alone would
// refuse the call. The token has to be GONE, which shows in which refusal
// comes back -- an unknown token is a dead session, not a blocked one.
r = get(api, 'roster_list', { token: saraOldToken });
ok(!r.ok, 'the session she had before the reset is dead');
ok(!r.mustChangePassword, 'and dead because the token is gone, not merely blocked');
ok(/Session expired|Not logged in/i.test(r.error || ''),
  `so the device that had it is told to log in again (got "${(r.error || '').slice(0, 50)}")`);

console.log('\n=== 3. The old password stops working, the temporary one starts ===');
ok(!get(api, 'auth_login', { username: 'sara', password: 'sarapass1' }).ok,
  'the password she forgot is dead');
sara = get(api, 'auth_login', { username: 'sara', password: saraTemp });
ok(sara.ok, 'and the temporary one lets her in');
eq(sara.mustChangePassword, true, 'the reply says she must choose her own');

console.log('\n=== 4. "Must change" is a refusal, not a suggestion ===');
r = get(api, 'roster_list', { token: sara.token });
ok(!r.ok, 'she cannot read the roster yet');
eq(r.mustChangePassword, true, 'and is told why, in a way the app can act on');
ok(!get(api, 'session_list', { token: sara.token }).ok, 'nor list her sessions');
ok(!post(api, { type: 'quiz_session', token: sara.token,
  session: { sessionCode: 'G1-5555', sessionName: 'x', mode: 'practice', group: 'G1', intake: 'JAN26',
             questionSetKey: 'ch12:original_pdf', seed: '1', questionCount: 2, orderMode: 'original' } }).ok,
  'nor create a session, which arrives by a different door');

console.log('\n=== 5. Changing it clears the flag and everything opens up ===');
r = get(api, 'auth_change_password', { token: sara.token, oldPassword: saraTemp, newPassword: 'chosenbyher1' });
ok(r.ok, 'she can change her password while blocked from everything else');
ok(get(api, 'roster_list', { token: sara.token }).ok, 'and then the app works again');
sara = get(api, 'auth_login', { username: 'sara', password: 'chosenbyher1' });
ok(sara.ok, 'the password she chose works');
ok(!sara.mustChangePassword, 'and she is not asked again');
ok(!get(api, 'auth_login', { username: 'sara', password: saraTemp }).ok, 'the temporary one is spent');

console.log('\n=== 6. Who may reset an instructor ===');
r = get(api, 'admin_reset_instructor_password', { token: sara.token, targetUsername: 'omar' });
ok(!r.ok && /[Aa]dmin/.test(r.error || ''), 'a plain instructor cannot reset anybody');
r = get(api, 'admin_reset_instructor_password', { token: ADMIN, targetUsername: 'adnen' });
ok(!r.ok && /Change password/i.test(r.error || ''),
  'and an admin cannot reset their own — that is what Change password is for');
r = get(api, 'admin_reset_instructor_password', { token: ADMIN, targetUsername: 'nobody' });
ok(!r.ok && /not found/i.test(r.error || ''), 'an unknown username is refused by name');
r = get(api, 'admin_reset_instructor_password', { targetUsername: 'sara' });
ok(!r.ok, 'no token, no reset');

console.log('\n=== 7. One admin can reset another ===');
// This is the whole answer to "what if the admin forgets": there has to be a
// second one. Nothing else in the app can rescue a lone admin.
r = get(api, 'admin_reset_instructor_password', { token: ADMIN, targetUsername: 'omar' });
ok(r.ok, 'an admin may reset a fellow admin');
const omar = get(api, 'auth_login', { username: 'omar', password: r.temporaryPassword });
ok(omar.ok && omar.role === 'admin', 'who logs back in still an admin');
eq(omar.mustChangePassword, true, 'and must still choose their own');
get(api, 'auth_change_password', { token: omar.token, oldPassword: r.temporaryPassword, newPassword: 'omarchose1' });

console.log('\n=== 8. A trainee who has forgotten theirs ===');
const traineeTok = get(api, 'trainee_signup', { energytechId: 'ET1001', password: 'firstpass1' }).token;
ok(Boolean(traineeTok), 'the trainee has an account to begin with');
ok(get(api, 'my_history', { token: traineeTok }).ok, 'and can read their record');

r = get(api, 'admin_reset_trainee_password', { token: ADMIN, energytechId: 'ET1001' });
ok(r.ok, 'the admin resets it');
const tTemp = r.temporaryPassword;
eq(r.name, 'Mohammed Al-Otaibi', 'and says whose it was, so the right person is told');
r = get(api, 'my_history', { token: traineeTok });
ok(!r.ok, 'their old session is closed');
ok(!r.mustChangePassword && /Session expired|Not logged in/i.test(r.error || ''),
  'and closed by the token being thrown away, not just blocked behind the flag');
ok(!get(api, 'trainee_login', { energytechId: 'ET1001', password: 'firstpass1' }).ok,
  'the password they forgot is dead');

let t2 = get(api, 'trainee_login', { energytechId: 'ET1001', password: tTemp });
ok(t2.ok, 'the temporary one lets them in');
eq(t2.mustChangePassword, true, 'and says they must choose their own');
r = get(api, 'my_history', { token: t2.token });
ok(!r.ok && r.mustChangePassword, 'until they do, their record stays shut');

console.log('\n=== 9. And they cannot sit a paper in the meantime ===');
// The dangerous version of this is not a refusal but a silent downgrade: the
// token is not accepted, the submission falls through to the walk-in identity,
// and the paper is filed under whatever the browser typed.
const before = ss.sheets.Attempts.rows.length;
r = post(api, { type: 'quiz_attempt', attemptId: 'X1', traineeToken: t2.token,
  student: { name: 'Someone Else', group: 'G9', energytechId: 'ET9999' },
  quiz: { sessionCode: 'G1-1234', mode: 'practice', questionSet: 'x', questionSetKey: 'ch12:original_pdf',
          seed: '1', questionCount: 1, orderMode: 'original' },
  score: { correct: 1, total: 1, percent: 100, wrongQuestions: [], unansweredQuestions: [] }, items: [] });
ok(!r.ok && r.mustChangePassword, 'the submission is refused outright');
eq(ss.sheets.Attempts.rows.length, before, 'and nothing was written under anybody\'s name');

r = get(api, 'trainee_change_password', { token: t2.token, oldPassword: tTemp, newPassword: 'theirown1' });
ok(r.ok, 'they can change it while blocked from the rest');
ok(get(api, 'my_history', { token: t2.token }).ok, 'and then their record opens');
t2 = get(api, 'trainee_login', { energytechId: 'ET1001', password: 'theirown1' });
ok(t2.ok && !t2.mustChangePassword, 'the password they chose works and is not questioned');

console.log('\n=== 10. Who may reset a trainee ===');
// This used to be admin-only. It is now the one write a non-admin instructor
// may make, and only for a trainee in a group assigned to them: a trainee who
// has forgotten their password is standing in front of whoever is teaching
// them that morning. sara covers nothing here, so she is still refused --
// test_backend.js §14 covers the assigned case from both sides.
r = get(api, 'admin_reset_trainee_password', { token: sara.token, energytechId: 'ET1001' });
ok(!r.ok && /assigned to you/i.test(r.error || ''),
  'an instructor with no groups assigned still cannot reset anybody');
r = get(api, 'admin_reset_trainee_password', { token: t2.token, energytechId: 'ET1001' });
ok(!r.ok, 'and neither can a trainee with their own token');
r = get(api, 'admin_reset_trainee_password', { token: ADMIN, energytechId: 'ET9999' });
ok(!r.ok && /roster/i.test(r.error || ''), 'somebody not on the roster is refused by name');

console.log('\n=== 11. Accounts there is nothing to reset ===');
r = get(api, 'admin_reset_trainee_password', { token: ADMIN, energytechId: 'ET1003' });
ok(!r.ok && /no account yet/i.test(r.error || ''),
  'a trainee who never made an account is told to create one, not handed a password');
get(api, 'trainee_signup', { energytechId: 'ET1002', password: 'fahadpass1' });
get(api, 'trainee_set_account', { token: ADMIN, energytechId: 'ET1002', status: 'revoked' });
r = get(api, 'admin_reset_trainee_password', { token: ADMIN, energytechId: 'ET1002' });
ok(!r.ok && /turned off/i.test(r.error || ''),
  'and a revoked account is told to be turned back on first');

console.log('\n=== 12. The temporary password is said once and not kept ===');
r = get(api, 'admin_reset_trainee_password', { token: ADMIN, energytechId: 'ET1001' });
const secret = r.temporaryPassword;
ok(r.ok && secret, 'a reset returns it');
const listed = JSON.stringify(get(api, 'trainee_list', { token: ADMIN }));
ok(listed.indexOf(secret) === -1, 'the roster listing does not carry it');
ok(JSON.stringify(get(api, 'roster_list', { token: ADMIN })).indexOf(secret) === -1,
  'nor the roster summary');
ok(JSON.stringify(get(api, 'admin_list_instructors', { token: ADMIN })).indexOf(secret) === -1,
  'nor the instructor listing');
const sheetDump = JSON.stringify(ss.sheets.Trainees.rows);
ok(sheetDump.indexOf(secret) === -1, 'and it is not written into the sheet in readable form');

console.log('\n=== 13. The passwords it makes ===');
const temps = [];
for (let i = 0; i < 12; i++) {
  temps.push(get(api, 'admin_reset_trainee_password', { token: ADMIN, energytechId: 'ET1001' }).temporaryPassword);
}
eq(new Set(temps).size, temps.length, 'a fresh one every time');
ok(temps.every(t => t.length >= 6), 'each long enough to pass the change-password rule');
ok(temps.every(t => !/[O0Il1]/.test(t)),
  'and none contains a character that is misheard or misread (O 0 I l 1)');

console.log('\n=== 14. A spreadsheet made before this version gains the column ===');
// The flag lives in a new column. An existing deployment must pick it up
// without anybody editing the sheet, and without losing a row.
const trainees = ss.sheets.Trainees;
const idx = trainees.rows[0].indexOf('Must Change Password');
ok(idx > -1, 'the trainees sheet has the column');
const rowsBefore = trainees.rows.length;
trainees.rows[0].splice(idx, 1);                    // as an older sheet would be
trainees.rows.slice(1).forEach(r => r.splice(idx, 1));
api.ENSURED_ = {};                                  // a fresh execution
ok(get(api, 'trainee_list', { token: ADMIN }).ok, 'an older sheet still answers');
ok(trainees.rows[0].indexOf('Must Change Password') > -1, 'and has gained the column');
eq(trainees.rows.length, rowsBefore, 'with every row still there');
const inst = ss.sheets.Instructors;
ok(inst.rows[0].indexOf('Must Change Password') > -1, 'the instructors sheet has it too');

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
