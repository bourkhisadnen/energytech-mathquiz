/* Sheets converts text that looks like a date or a number on the way in.
 * Adnane typed MAY26 and got back "Tue May 26 2026". Trainee IDs are exposed to
 * the same thing: an all-digit ID loses its leading zeros and becomes a number. */
const { makeSpreadsheet, loadBackend, get, post } = require('/tmp/energytech_app/gas_stub.js');
let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const { ss, api } = loadBackend(makeSpreadsheet());
api.setup();
const ADMIN = get(api, 'auth_login', { username: 'adnen', password: '12341234' }).token;

console.log('\n=== 1. Month-like intake labels survive the round trip ===');
['MAY26', 'JAN26', 'DEC27', 'MAR26', 'SEP25'].forEach(label => {
  const r = get(api, 'intake_save', { token: ADMIN, label });
  ok(r.ok, `${label} accepted`);
});
const labels = get(api, 'roster_list', { token: ADMIN }).intakes.map(i => i.label);
eq(labels, ['MAY26', 'JAN26', 'DEC27', 'MAR26', 'SEP25'], 'all five read back as typed');
ok(!labels.some(l => /\d{4}\s|GMT|:/.test(l)), 'none of them turned into a date');
ok(ss.sheets.Intakes.rows.slice(1).every(r => typeof r[1] === 'string'),
  'the Label column holds strings in the sheet, not Date objects');

console.log('\n=== 2. Renaming to a month-like label is also safe ===');
ok(get(api, 'intake_save', { token: ADMIN, label: 'APR26', previousLabel: 'MAY26' }).ok, 'renamed MAY26 to APR26');
ok(get(api, 'roster_list', { token: ADMIN }).intakes.map(i => i.label).includes('APR26'),
  'the new label reads back as typed');

console.log('\n=== 3. Group and trainee fields keep their intake label ===');
ok(get(api, 'group_save', { token: ADMIN, intake: 'JAN26', name: 'G1' }).ok, 'group added under JAN26');
eq(get(api, 'roster_list', { token: ADMIN }).groups.map(g => g.intake), ['JAN26'],
  'the group still points at JAN26, not a date');

console.log('\n=== 4. All-digit trainee IDs keep their leading zeros ===');
ok(get(api, 'trainee_save', { token: ADMIN, energytechId: '0012345', name: 'Mohammed Al-Otaibi', intake: 'JAN26', group: 'G1' }).ok, 'numeric ID accepted');
ok(get(api, 'trainee_save', { token: ADMIN, energytechId: '0012346', name: 'Omar Al-Harbi', intake: 'JAN26', group: 'G1' }).ok, 'second numeric ID accepted');
const ids = get(api, 'trainee_list', { token: ADMIN }).trainees.map(t => t.energytechId);
eq(ids.sort(), ['0012345', '0012346'], 'leading zeros survived');
eq((get(api, 'trainee_list', { token: ADMIN }).trainees[0] || {}).intake, 'JAN26', 'the trainee intake is a label, not a date');

console.log('\n=== 5. A CSV import keeps them too ===');
post(api, { type: 'trainee_import', token: ADMIN, intake: 'JAN26', group: 'G1',
  rows: [{ energytechId: '0099001', name: 'Turki Al-Ghamdi' },
         { energytechId: '0099002', name: 'Nasser Al-Shehri' }] });
const imported = get(api, 'trainee_list', { token: ADMIN }).trainees.map(t => t.energytechId).sort();
eq(imported, ['0012345', '0012346', '0099001', '0099002'], 'imported IDs kept their zeros');

console.log('\n=== 6. A trainee with a numeric ID can still sign up and log in ===');
const signup = get(api, 'trainee_signup', { energytechId: '0012345', password: 'secret1' }) || {};
ok(signup.ok && signup.token, 'signup works with a leading-zero ID');
eq((signup.trainee || {}).energytechId, '0012345', 'the profile shows the ID as typed');
const relogin = get(api, 'trainee_login', { energytechId: '0012345', password: 'secret1' }) || {};
ok(relogin.ok, 'and so does login');
// Logging in retires the signup token, so the attempt below must use this one.
const LIVE = relogin.token;

console.log('\n=== 7. Attempts record the label and ID as text ===');
post(api, { type: 'quiz_session', token: ADMIN,
  session: { sessionCode: 'G1-1234', sessionName: 'T', intake: 'JAN26', group: 'G1', mode: 'practice' } });
post(api, { type: 'quiz_attempt', attemptId: 'A1', traineeToken: LIVE,
  quiz: { sessionCode: 'G1-1234', questionCount: 1 },
  score: { correct: 1, total: 1, percent: 100, wrongQuestions: [], unansweredQuestions: [] }, items: [] });
const att = ss.sheets.Attempts.rows[ss.sheets.Attempts.rows.length - 1];
eq(att[4], '0012345', 'the attempt row keeps the full trainee ID');
eq(att[21], 'JAN26', 'and the intake label as text');
eq(get(api, 'session', { code: 'G1-1234' }).session.intake, 'JAN26', 'the session reads its intake back as text');

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
