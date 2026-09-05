/* Adnane dropped the family/given split for a single Name. His Trainees sheet
 * already holds two-column rows, some with live logins, so the migration has to
 * join them without disturbing anything else on the row. */
const { makeSpreadsheet, loadBackend, get, post } = require('/tmp/energytech_app/gas_stub.js');
let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const OLD_TRAINEE_HEADERS = ['Timestamp', 'EnergyTech ID', 'Family Name', 'Given Name',
  'Intake', 'Group', 'Account Status', 'Password Hash', 'Salt', 'Token', 'Token Expires', 'Created By'];

/* Seed the way the backend writes: label columns formatted as text first, or
 * Sheets turns JAN26 into a date and nothing matches anything. */
function seed(sheet, values, textCols) {
  const row = sheet.getLastRow() + 1;
  (textCols || []).forEach(c => sheet.getRange(row, c).setNumberFormat('@'));
  sheet.getRange(row, 1, 1, values.length).setValues([values]);
}

const ss = makeSpreadsheet();
ss.insertSheet('Sessions').appendRow(['Timestamp']);
ss.insertSheet('Attempts').appendRow(['Timestamp', 'Attempt ID', 'Name', 'Group', 'EnergyTech ID']);
ss.insertSheet('ItemResponses').appendRow(['Timestamp']);
ss.insertSheet('Intakes').appendRow(['Timestamp', 'Label', 'Status', 'Created By']);
ss.insertSheet('Groups').appendRow(['Timestamp', 'Intake', 'Group', 'Created By']);
const tr = ss.insertSheet('Trainees');
tr.appendRow(OLD_TRAINEE_HEADERS);
// A row with a live login, so the password/token columns must survive the shift.
const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
const OLD_TEXT_COLS = [2, 3, 4, 5, 6];      // ID, family, given, intake, group
seed(tr, [new Date(), 'ET1001', 'Al-Otaibi', 'Mohammed Abdullah Saleh', 'JAN26', 'G1',
  'active', 'HASHVALUE', 'SALTVALUE', 'TOKENVALUE', expires, 'adnen'], OLD_TEXT_COLS);
seed(tr, [new Date(), 'ET1002', 'Al-Qahtani', 'Fahad Abdulrahman Nasser', 'JAN26', 'G1',
  'none', '', '', '', '', 'adnen'], OLD_TEXT_COLS);
seed(tr, [new Date(), 'ET1003', 'Al-Ghamdi', '', 'JAN26', 'G2', 'none', '', '', '', '', 'adnen'], OLD_TEXT_COLS);
seed(tr, [new Date(), 'ET1004', '', 'Turki Saad', 'JAN26', 'G2', 'revoked', '', '', '', '', 'adnen'], OLD_TEXT_COLS);
seed(ss.getSheetByName('Intakes'), [new Date(), 'JAN26', 'active', 'adnen'], [2]);
seed(ss.getSheetByName('Groups'), [new Date(), 'JAN26', 'G1', 'adnen'], [2, 3]);
seed(ss.getSheetByName('Groups'), [new Date(), 'JAN26', 'G2', 'adnen'], [2, 3]);

const { api } = loadBackend(ss);
const T = get(api, 'auth_login', { username: 'adnen', password: '12341234' }).token;

console.log('\n=== 1. The sheet is migrated in place ===');
eq(tr.rows[0].length, 11, 'the header lost a column');
eq(tr.rows[0][2], 'Name', 'column 3 is now Name');
ok(tr.rows[0].indexOf('Given Name') === -1 && tr.rows[0].indexOf('Family Name') === -1, 'neither old header remains');
eq(tr.rows.length, 5, 'no rows were added or lost');

console.log('\n=== 2. Names are joined given-first ===');
eq(tr.rows[1][2], 'Mohammed Abdullah Saleh Al-Otaibi', 'the full name reads in the usual order');
eq(tr.rows[2][2], 'Fahad Abdulrahman Nasser Al-Qahtani', 'and for the second row');
eq(tr.rows[3][2], 'Al-Ghamdi', 'a row with only a family name keeps it, with no stray space');
eq(tr.rows[4][2], 'Turki Saad', 'a row with only a given name keeps it too');

console.log('\n=== 3. The rest of each row shifted correctly ===');
eq(tr.rows[1].slice(3, 8), ['JAN26', 'G1', 'active', 'HASHVALUE', 'SALTVALUE'], 'intake, group, status, hash and salt all landed one column left');
eq(tr.rows[1][8], 'TOKENVALUE', 'the login token is intact');
eq(tr.rows[1][10], 'adnen', 'and Created By is still last');

console.log('\n=== 4. Reading it back through the API ===');
const list = get(api, 'trainee_list', { token: T }).trainees;
eq(list.length, 4, 'all four trainees are listed');
eq(list[0].name, 'Mohammed Abdullah Saleh Al-Otaibi', 'the API returns a single name');
ok(list[0].familyName === undefined && list[0].givenName === undefined, 'and no longer the split fields');
eq(list.map(t => t.group), ['G1', 'G1', 'G2', 'G2'], 'groups survived');
eq(list[0].accountStatus, 'active', 'account status survived');
eq(get(api, 'roster_list', { token: T }).groups.map(g => `${g.name}:${g.trainees}:${g.withAccount}`),
  ['G1:2:1', 'G2:2:0'], 'the counts still add up');

console.log('\n=== 5. The migrated login still works ===');
// The password hash was written by the old layout; it must still be found.
const salt = 'SALTVALUE';
ok(get(api, 'trainee_login', { energytechId: 'ET1001', password: 'anything' }).ok === false,
  'a wrong password is still refused');
const me = get(api, 'trainee_me', { token: 'TOKENVALUE' });
ok(me.ok, 'the token issued before the migration still identifies them');
eq(me.trainee.name, 'Mohammed Abdullah Saleh Al-Otaibi', 'and resolves to the joined name');

console.log('\n=== 6. Running again changes nothing ===');
const before = JSON.stringify(tr.rows);
get(api, 'ping'); get(api, 'ping');
eq(JSON.stringify(tr.rows), before, 'the migration is a no-op once done');

console.log('\n=== 7. New writes use the single field ===');
ok(get(api, 'trainee_save', { token: T, energytechId: 'ET2001', name: 'Omar Khalid Al-Harbi', intake: 'JAN26', group: 'G1' }).ok, 'a trainee is added with one name');
ok(!get(api, 'trainee_save', { token: T, energytechId: 'ET2002', name: '  ', intake: 'JAN26', group: 'G1' }).ok, 'a blank name is refused');
const added = get(api, 'trainee_list', { token: T, intake: 'JAN26', group: 'G1' }).trainees.find(t => t.energytechId === 'ET2001') || {};
eq(added.name, 'Omar Khalid Al-Harbi', 'it reads back whole');
eq(tr.rows[tr.rows.length - 1].length, 11, 'the new row has 11 columns like the rest');

console.log('\n=== 8. Editing, moving and importing ===');
ok(get(api, 'trainee_save', { token: T, energytechId: 'ET2001', previousId: 'ET2001', name: 'Omar K. Al-Harbi', intake: 'JAN26', group: 'G2' }).ok, 'edit accepted');
const edited = get(api, 'trainee_list', { token: T }).trainees.find(t => t.energytechId === 'ET2001');
eq([edited.name, edited.group], ['Omar K. Al-Harbi', 'G2'], 'the edit changed the name and the group');
ok(get(api, 'trainee_move', { token: T, intake: 'JAN26', group: 'G1', ids: 'ET2001' }).ok, 'move accepted');
eq(get(api, 'trainee_list', { token: T }).trainees.find(t => t.energytechId === 'ET2001').name,
  'Omar K. Al-Harbi', 'moving left the name alone');
post(api, { type: 'trainee_import', token: T, intake: 'JAN26',
  rows: [{ energytechId: 'ET3001', name: 'Nasser Ali Hamad Al-Shehri', group: 'G2' }] });
eq(get(api, 'trainee_list', { token: T, intake: 'JAN26', group: 'G2' }).trainees.find(t => t.energytechId === 'ET3001').name,
  'Nasser Ali Hamad Al-Shehri', 'an imported name comes through whole');

console.log('\n=== 9. A new trainee signs up and their attempt is named ===');
const tok = get(api, 'trainee_signup', { energytechId: 'ET3001', password: 'secret1' }).token;
ok(Boolean(tok), 'signup works on the new schema');
post(api, { type: 'quiz_session', token: T, session: { sessionCode: 'G2-1', sessionName: 'T', intake: 'JAN26', group: 'G2', mode: 'practice' } });
post(api, { type: 'quiz_attempt', attemptId: 'A1', traineeToken: tok,
  quiz: { sessionCode: 'G2-1', questionCount: 1 },
  score: { correct: 1, total: 1, percent: 100, wrongQuestions: [], unansweredQuestions: [] }, items: [] });
const att = ss.sheets.Attempts.rows[ss.sheets.Attempts.rows.length - 1];
eq(att[2], 'Nasser Ali Hamad Al-Shehri', 'the attempt records the single name, from the roster');

console.log('\n=== 10. A sheet created fresh needs no migration ===');
const ss2 = makeSpreadsheet();
const { api: api2 } = loadBackend(ss2);
api2.setup();
get(api2, 'ping');
eq(ss2.getSheetByName('Trainees').rows[0], ['Timestamp', 'EnergyTech ID', 'Name', 'Intake', 'Group',
  'Account Status', 'Password Hash', 'Salt', 'Token', 'Token Expires', 'Created By'],
  'a new Trainees sheet has the single-name header');

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
