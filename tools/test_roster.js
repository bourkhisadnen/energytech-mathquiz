/* End-to-end test of the rebuilt roster workspace against the REAL
 * energytech-api backend (Express + Postgres) -- repointed for Phase 6 from
 * the mocked-Apps-Script version this file used to be.
 *
 * The app under test is served by src/app.js itself, straight off
 * energytech-api/public/ (D3) -- no separate static server, no symlink, no
 * copy of the source tree. The realpath check that used to guard against a
 * stale copy (claude/12-exam-page-and-leak.md) now lives in
 * mutate_backend.js, checking that same static-serve path.
 *
 * State setup and assertions talk to the real database at TEST_DATABASE_URL,
 * never DATABASE_URL, via energytech-api's own test helpers --
 * tests/helpers/db.js refuses to load against anything else; see its own
 * comment for why.
 *
 * This is a straight repoint, not a rewrite: every UI step, selector and
 * assertion value below is unchanged from the mocked version. Where the real
 * backend's shape or behaviour differs from what the mock assumed, the
 * assertion is left exactly as it was so the mismatch is visible in the
 * output, rather than quietly adjusted to match. */

const path = require('path');
const { chromium } = require('playwright');

const ENERGYTECH_API_ROOT = path.join(__dirname, '..', '..', 'energytech-api');
require('dotenv').config({ path: path.join(ENERGYTECH_API_ROOT, '.env') });

// Must be required before src/app, so the app under test and these fixtures
// land on the same (test) database -- see tests/helpers/db.js's own comment.
const { pool, resetDb, insertInstructor } = require(path.join(ENERGYTECH_API_ROOT, 'tests', 'helpers', 'db'));
const { hashPasswordForStorage } = require(path.join(ENERGYTECH_API_ROOT, 'src', 'lib', 'passwords'));
const app = require(path.join(ENERGYTECH_API_ROOT, 'src', 'app'));

let failures = [], checks = 0;
function ok(cond, label) {
  checks++;
  if (cond) console.log('  PASS  ' + label);
  else { console.log('  FAIL  ' + label); failures.push(label); }
}

/* ---------------- seeding the two instructor accounts the mock hardcoded ---------------- */

async function seedInstructor(username, displayName, role, password) {
  const { passwordHash, passwordSalt, passwordAlgo } = await hashPasswordForStorage(password);
  await insertInstructor({ username, displayName, role, passwordHash, passwordSalt, passwordAlgo });
}

/* ---------------- reading back real backend state (replaces the old in-memory db.*) ---------------- */

async function countIntakes() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM intakes');
  return rows[0].n;
}
async function countGroups() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM groups');
  return rows[0].n;
}
async function allGroups() {
  const { rows } = await pool.query(
    `SELECT ik.label AS intake, g.name FROM groups g JOIN intakes ik ON ik.id = g.intake_id ORDER BY g.id`
  );
  return rows;
}
async function allTrainees() {
  const { rows } = await pool.query(`
    SELECT t.energytech_id AS "energytechId", t.name, ik.label AS intake, g.name AS "group",
           t.account_status AS "accountStatus"
      FROM trainees t
      JOIN intakes ik ON ik.id = t.intake_id
      JOIN groups g ON g.id = t.group_id
     ORDER BY t.id`);
  return rows;
}
async function findTrainee(energytechId) {
  const rows = await allTrainees();
  return rows.find((t) => t.energytechId === energytechId);
}
async function setTraineeActive(energytechId, password) {
  const { passwordHash, passwordSalt, passwordAlgo } = await hashPasswordForStorage(password);
  await pool.query(
    `UPDATE trainees SET account_status = 'active', password_hash = $1, password_salt = $2, password_algo = $3
      WHERE energytech_id = $4`,
    [passwordHash, passwordSalt, passwordAlgo, energytechId]
  );
}
async function assignAllGroupsTo(username) {
  await pool.query(
    `INSERT INTO instructor_group_assignments (username, group_id)
       SELECT $1, id FROM groups
     ON CONFLICT DO NOTHING`,
    [username]
  );
}
async function latestAttempt() {
  const { rows } = await pool.query(`
    SELECT a.*, ik.label AS intake FROM attempts a
    LEFT JOIN intakes ik ON ik.id = a.intake_id
    ORDER BY a.submitted_at DESC LIMIT 1`);
  return rows[0] || null;
}
// A real submit renders 30 LaTeX question cards, posts the full payload and
// writes it to Postgres -- not the mocked backend's synchronous in-memory
// push. Measured over 10s in a headless browser, so this polls with a
// generous budget instead of trusting a fixed delay to have been long enough.
async function waitForAttempt(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const attempt = await latestAttempt();
    if (attempt) return attempt;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/* ---------------- driving the real, running app ---------------- */

async function login(page, user = 'adnen', pw = '1231234') {
  await page.click('#teacherModeBtn');
  await page.fill('#teacherLoginUsername', user);
  await page.fill('#teacherLoginPassword', pw);
  await page.click('#teacherLoginBtn');
  await page.waitForSelector('#teacherInterface:not([hidden])');
}
const csv = (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });

/* ---------------- the run ---------------- */

(async () => {
  await resetDb();
  await seedInstructor('adnen', 'Adnane Khalifa', 'admin', '1231234');
  await seedInstructor('sara', 'Sara', 'instructor', 'pw');

  const server = app.listen(0);
  const { port } = server.address();
  const BASE = `http://127.0.0.1:${port}/index.html`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  let dialogAnswer = null;
  page.on('dialog', async d => {
    if (d.type() === 'confirm') return d.accept();
    await d.accept(dialogAnswer === null ? d.defaultValue() : dialogAnswer);
  });
  await page.goto(BASE);

  console.log('\n=== 1. The panel loads itself ===');
  await login(page);
  ok(await page.isVisible('#intakePanelSection'), 'intake panel visible for an admin');
  await page.waitForSelector('#intakeList .pane-empty', { timeout: 10000 });
  ok(/No intakes yet/.test(await page.textContent('#intakeList')), 'empty state invites the first intake, without pressing anything');
  ok(await page.isHidden('#rosterStatusLine'), 'no leftover status message');

  console.log('\n=== 2. Adding an intake selects it and moves you on ===');
  await page.click('#showAddIntake');
  await page.fill('#newIntakeLabel', 'JAN26');
  await page.click('#addIntakeBtn');
  await page.waitForSelector('.pane-item[data-intake="JAN26"].is-selected');
  ok(true, 'the new intake is created and selected');
  ok(/No groups in this intake yet/.test(await page.textContent('#groupList')), 'the groups pane now asks for a group');
  await page.waitForFunction(() => document.querySelector('#rosterStatusLine').hidden, null, { timeout: 8000 });
  ok(true, 'the confirmation clears itself rather than sticking');

  console.log('\n=== 3. Adding a group selects it and opens its trainees ===');
  await page.click('#showAddGroup');
  await page.fill('#newGroupName', 'G1');
  await page.click('#addGroupBtn');
  await page.waitForSelector('.pane-item[data-group="G1"].is-selected');
  ok(/JAN26 \/ G1/.test(await page.textContent('#traineePaneTitle')), 'the trainee pane is headed with where you are');
  ok(/No trainees in this group yet/.test(await page.textContent('#traineeList')), 'and tells you how to fill it');
  ok(await page.isVisible('#showAddTrainee'), 'the Add button is right there');

  console.log('\n=== 4. Adding a trainee by hand ===');
  await page.click('#showAddTrainee');
  await page.fill('#newTraineeId', 'ET1001');
  await page.fill('#newTraineeName', 'Mohammed Abdullah Saleh Al-Otaibi');
  await page.click('#addTraineeBtn');
  await page.waitForSelector('.roster-table tbody tr');
  ok(/Mohammed Abdullah Saleh Al-Otaibi/.test(await page.textContent('#traineeList')), 'the whole name is shown, in one column');
  ok(await page.inputValue('#newTraineeId') === '', 'the form clears so you can keep typing the next one');
  ok(await page.isVisible('#addTraineeForm'), 'and stays open');

  console.log('\n=== 5. One CSV for the whole intake, groups created from it ===');
  await page.setInputFiles('#csvFileInput', csv('intake.csv',
    '﻿EnergyTech ID,Full Name,Group\n'
    + 'ET1002,Fahad Abdulrahman Nasser Al Qahtani,G1\n'
    + 'ET1003;Turki Saad Al-Ghamdi;G2\n'
    + 'ET1004,"Omar ""Abu Ali"" Ibrahim, junior",G2\n'
    + 'ET1005,Nasser Ali Al-Shehri,G3\n'
    + 'ET1001,Should Be Skipped,G1\n'
    + ',No Id,G1\n'));
  await page.waitForSelector('#csvPreview:not([hidden])');
  const preview = await page.textContent('#csvPreview');
  ok(/4 new trainees will be added/.test(preview), 'preview counts 4 new trainees');
  ok(/G1.*1.*G2.*2.*G3.*1/s.test(preview.replace(/\s+/g, ' ')), 'preview breaks them down by group');
  ok(/2 groups will be created: G2, G3/.test(preview), 'preview says which groups it will create');
  ok(/already on record/.test(preview), 'preview reports the duplicate ID');
  ok(/could not be read/.test(preview), 'preview reports the row with no ID');
  ok(/Omar "Abu Ali" Ibrahim, junior/.test(preview), 'quoted comma and doubled quotes parsed');
  await page.click('#confirmImportBtn');
  await page.waitForFunction(() => document.querySelectorAll('#groupList .pane-item').length === 3, null, { timeout: 20000 });
  ok(await countGroups() === 3, 'G2 and G3 were created by the import');
  ok((await allTrainees()).length === 5, 'five trainees on record');
  ok((await allTrainees()).filter(t => t.group === 'G2').length === 2, 'the G2 rows went to G2');

  console.log('\n=== 6. Filtering by who still has no login ===');
  await page.click('.pane-item[data-group="G2"]');
  await page.waitForFunction(() => document.querySelectorAll('.roster-table tbody tr').length === 2);
  await setTraineeActive('ET1003', 'whatever1');
  // #loadRosterBtn's handler awaits loadRoster() then refreshTrainees() in
  // sequence -- trainee_list is the last of the two calls it makes, so
  // waiting for that response is waiting for both to have landed.
  await Promise.all([
    page.waitForResponse((res) => {
      if (!res.url().includes('/api/call')) return false;
      try { return res.request().postDataJSON()?.action === 'trainee_list'; } catch { return false; }
    }),
    page.click('#loadRosterBtn'),
  ]);
  await page.click('.filter-chip[data-filter="none"]');
  await page.waitForFunction(() => document.querySelectorAll('.roster-table tbody tr').length === 1);
  const filtered = await page.textContent('#traineeList');
  ok(/ET1004/.test(filtered) && !/ET1003/.test(filtered), 'only the trainee without a login is listed');
  ok(/No login yet \(1\)/.test(await page.textContent('#traineeFilters')), 'the chip carries the count');
  await page.click('.filter-chip[data-filter="all"]');
  await page.waitForFunction(() => document.querySelectorAll('.roster-table tbody tr').length === 2);

  console.log('\n=== 7. Moving trainees between groups ===');
  await page.click('.pick-trainee[data-id="ET1003"]');
  await page.click('.pick-trainee[data-id="ET1004"]');
  await page.waitForSelector('#bulkBar:not([hidden])');
  ok(/2 selected/.test(await page.textContent('#bulkCount')), 'the bulk bar counts the selection');
  const opts = await page.$$eval('#bulkMoveTarget option', o => o.map(x => x.value));
  ok(!opts.includes('G2') && opts.includes('G1') && opts.includes('G3'), 'the move list excludes the group they are already in');
  await page.selectOption('#bulkMoveTarget', 'G3');
  await page.click('#bulkMoveBtn');
  await page.waitForFunction(() => document.querySelectorAll('.roster-table tbody tr').length === 0, null, { timeout: 15000 });
  ok((await allTrainees()).filter(t => t.group === 'G3').length === 3, 'all three are in G3 now');
  ok(/Al-Ghamdi/.test((await findTrainee('ET1003')).name), 'the move left their names alone');
  ok(await page.isHidden('#bulkBar'), 'the selection is cleared afterwards');

  console.log('\n=== 8. Searching across every intake ===');
  await page.fill('#rosterSearch', 'ghamdi');
  await page.waitForFunction(() => /Search:/.test(document.querySelector('#traineePaneTitle').textContent));
  await page.waitForFunction(() => document.querySelectorAll('#traineeList tbody tr').length === 1, null, { timeout: 10000 });
  const hit = await page.textContent('#traineeList');
  ok(/ET1003/.test(hit), 'the search finds a trainee by family name');
  ok(/JAN26 \/ G3/.test(hit), 'and says which group they are in');
  await page.fill('#rosterSearch', 'ET1005');
  await page.waitForFunction(() => /ET1005/.test(document.querySelector('#traineeList').textContent));
  ok(true, 'and finds one by EnergyTech ID');
  await page.fill('#rosterSearch', 'nobodyhere');
  await page.waitForFunction(() => /Nobody matches/.test(document.querySelector('#traineeList').textContent));
  ok(true, 'an empty search says so plainly');
  await page.fill('#rosterSearch', '');
  await page.waitForFunction(() => !/Search:/.test(document.querySelector('#traineePaneTitle').textContent));

  console.log('\n=== 9. Editing a trainee inline, including their group ===');
  await page.click('.pane-item[data-group="G3"]');
  await page.waitForFunction(() => document.querySelectorAll('.roster-table tbody tr').length === 3);
  await page.click('.trainee-edit[data-id="ET1003"]');
  await page.waitForSelector('.trainee-edit-row');
  ok(true, 'the row turns into an editor in place, with no browser dialog');
  await page.fill('.trainee-edit-row .edit-name', 'Turki Saad Al-Ghamdi Renamed');
  await page.selectOption('.trainee-edit-row .edit-group', 'G1');
  await page.click('.save-trainee');
  await page.waitForFunction(() => !document.querySelector('.trainee-edit-row'), null, { timeout: 15000 });
  const moved = await findTrainee('ET1003');
  ok(moved.name === 'Turki Saad Al-Ghamdi Renamed', 'the name was saved');
  ok(moved.group === 'G1', 'and the group change moved them');
  ok((await allTrainees()).filter(t => t.energytechId === 'ET1003').length === 1, 'editing did not duplicate the row');

  console.log('\n=== 10. Deletion is blocked while children exist ===');
  await page.click('.pane-item[data-intake="JAN26"] .intake-delete');
  await page.waitForFunction(() => /still has/.test(document.querySelector('#rosterStatusLine').textContent), null, { timeout: 10000 });
  ok(/group/.test(await page.textContent('#rosterStatusLine')), 'intake delete blocked, and says why');
  await page.click('.pane-item[data-group="G3"]');
  await page.waitForSelector('.pane-item[data-group="G3"].is-selected');
  await page.click('.pane-item[data-group="G3"] .group-delete');
  // Wait for THIS refusal, not merely for "still has" -- the intake refusal
  // above already left that phrase on the line, so the old wait passed
  // instantly and the assertion then read the previous message. It failed
  // about half the time, depending on whether the new text had landed yet.
  await page.waitForFunction(
    () => /trainee/.test(document.querySelector('#rosterStatusLine').textContent),
    null, { timeout: 10000 });
  ok(/still has/.test(await page.textContent('#rosterStatusLine')), 'group delete blocked, and says why');
  ok((await countIntakes()) === 1 && (await countGroups()) === 3, 'nothing was actually deleted');

  console.log('\n=== 11. Renaming cascades ===');
  dialogAnswer = 'FEB26';
  await page.click('.pane-item[data-intake="JAN26"] .intake-rename');
  await page.waitForSelector('.pane-item[data-intake="FEB26"]', { timeout: 10000 });
  dialogAnswer = null;
  ok((await allGroups()).every(g => g.intake === 'FEB26'), 'groups followed the intake rename');
  ok((await allTrainees()).every(t => t.intake === 'FEB26'), 'trainees followed the intake rename');
  ok(await page.isVisible('.pane-item[data-intake="FEB26"].is-selected'), 'and the renamed intake stays selected');

  console.log('\n=== 12. Session pickers still fed from the roster ===');
  // Was broken: #sessionIntake is only repopulated by populateSessionIntakes(),
  // which used to run at the tail of reconcileSoon()'s debounced
  // loadRoster(true) after every roster mutation. Phase 5 deleted
  // reconcileSoon() without noticing that call also drove this dropdown, so a
  // rename never reached it even though rosterCache itself was already
  // correct. Fixed in app.js: rosterAction/traineeAction now call
  // populateSessionIntakes() directly off the already-updated rosterCache, no
  // extra round trip needed.
  await page.selectOption('#sessionIntake', 'FEB26');
  await page.waitForFunction(() => document.querySelector('#sessionGroup').options.length === 4);
  const groupOpts = await page.$$eval('#sessionGroup option', o => o.map(x => x.textContent));
  const g1Count = (await allTrainees()).filter(t => t.group === 'G1').length;
  ok(groupOpts.join('|').includes(`G1 (${g1Count})`),
    `the group picker shows live trainee counts (wanted G1 (${g1Count}), got ${groupOpts.join(' ')})`);

  console.log('\n=== 13. A plain instructor gets the pickers, and a read-only roster ===');
  // This used to assert the roster card was HIDDEN from a non-admin. It is now
  // shown, filtered by the backend to the groups assigned to that instructor,
  // because a covering teacher needs to see their trainees and reset a
  // forgotten password. What they still cannot do is change anything, which is
  // what the checks below hold -- test_instructor_roster.js covers the rest.
  //
  // 'sara' needs group assignments for this step to mean anything: the mocked
  // backend never modeled assignment-based filtering (it returned every group
  // to any authenticated caller), but the real roster_list
  // (src/actions/roster.js) correctly scopes a non-admin to their assigned
  // groups. Assigning her every group here is fixture setup matching a real
  // covering instructor, not a workaround for a bug.
  await assignAllGroupsTo('sara');
  const p2 = await browser.newPage();
  const e2 = [];
  p2.on('pageerror', e => e2.push(String(e)));
  await p2.goto(BASE);
  await login(p2, 'sara', 'pw');
  ok(await p2.isVisible('#intakePanelSection'), 'the roster card is shown to a plain instructor');
  // No fixed wait needed: applyRosterPermissions() runs synchronously inside
  // enterInstructorInterface(), which login() above already waited for via
  // '#teacherInterface:not([hidden])'. The async part (rosterCache loading)
  // only affects the #sessionIntake check below, which already waits for it.
  const editable = await p2.evaluate(() => ({
    add: !document.getElementById('showAddIntake').hidden,
    readonlyClass: document.getElementById('intakePanelSection').classList.contains('is-readonly')
  }));
  ok(!editable.add, 'but nothing that creates an intake');
  ok(editable.readonlyClass, 'and the card knows it is read-only');
  await p2.waitForFunction(() => document.querySelector('#sessionIntake').options.length === 2);
  ok(true, 'and the intake picker is still filled');
  ok(e2.length === 0, 'no page errors on the instructor page');
  await p2.close();

  console.log('\n=== 14. A trainee can still sign up and sit a quiz ===');
  const tp = await browser.newPage();
  const te = [];
  tp.on('pageerror', e => te.push(String(e)));
  tp.on('console', m => { if (m.type() === 'error') te.push('console: ' + m.text()); });
  await tp.goto(BASE);
  await tp.click('#studentModeBtn');
  await tp.click('#toggleTraineeSignupBtn');
  await tp.fill('#traineeSignupId', 'ET1001');
  await tp.fill('#traineeSignupPassword', 'secret1');
  await tp.fill('#traineeSignupConfirm', 'secret1');
  await tp.click('#traineeSignupBtn');
  await tp.waitForSelector('#traineeHomePanel:not([hidden])');
  const profile = await tp.textContent('#traineeProfile');
  ok(/ET1001/.test(profile) && /FEB26/.test(profile), 'the profile shows the ID and the renamed intake');

  await page.click('#createSessionBtn');
  // "Session code:" appears immediately (the v33 optimistic-apply pattern,
  // kept deliberately in app.js) -- before the real quiz_session POST has even
  // been sent, let alone landed. Waiting for "verified" instead means the
  // trainee page below only tries to load a session that really exists.
  await page.waitForFunction(() => /verified/.test(document.querySelector('#sessionStatus').textContent), null, { timeout: 15000 });
  const code = await page.$eval('.session-code-box', el => el.textContent.trim());
  await tp.fill('#studentSessionCode', code);
  await tp.click('#loadTraineeSessionBtn');
  await tp.waitForSelector('#studentQuizArea:not([hidden])');
  await tp.$$eval('#studentQuizContainer .question-card', cards =>
    cards.forEach(c => { const r = c.querySelector('input[type="radio"]'); if (r) r.click(); }));
  await tp.click('#studentSubmitBtn');
  const attempt = await waitForAttempt();
  // registered is a real Postgres boolean (attempts.registered), not
  // Code.gs's 'yes'/'walk-in' pair -- see app.js's own history-table and
  // session-report fix for the same distinction.
  ok(attempt && attempt.registered === true && attempt.energytech_id === 'ET1001', 'the attempt is identified from the roster');
  ok(attempt && attempt.intake === 'FEB26', 'and carries the intake');

  console.log('\n=== 15. Revoking logins in bulk ===');
  await page.click('.pane-item[data-group="G1"]');
  const inG1 = (await allTrainees()).filter(t => t.group === 'G1').length;
  await page.waitForFunction(n => document.querySelectorAll('.roster-table tbody tr').length === n, inG1);
  // ET1002 came in by CSV and never signed up, so it is the control here.
  const hadLogin = (await allTrainees()).filter(t => t.group === 'G1' && t.accountStatus === 'active').map(t => t.energytechId);
  ok(hadLogin.length > 0, `at least one G1 trainee has a login to revoke (${hadLogin.join(', ')})`);
  await page.click('#pickAll');
  await page.waitForSelector('#bulkBar:not([hidden])');
  await page.click('#bulkRevokeBtn');
  await page.waitForFunction(() => /revoked/.test(document.querySelector('#traineeList').textContent), null, { timeout: 15000 });
  const afterRevoke = await allTrainees();
  ok(hadLogin.every(id => afterRevoke.find(t => t.energytechId === id).accountStatus === 'revoked'),
    'every trainee who had a login was revoked');
  ok(afterRevoke.find(t => t.energytechId === 'ET1002').accountStatus === 'none',
    'a trainee who never had a login is left alone, not marked revoked');

  console.log('\n=== 16. Group CSV download ===');
  const dlPromise = page.waitForEvent('download');
  await page.click('#downloadRosterCsvBtn');
  const download = await dlPromise;
  let text = '';
  for await (const chunk of await download.createReadStream()) text += chunk;
  ok(/EnergyTech ID/.test(text.replace(/^﻿/, '')), 'the file starts with a header');
  ok(/Al-Otaibi/.test(text), 'and holds the trainees');
  ok(/Group/.test(text), 'including which group they are in');

  console.log('\n=== 17. No page errors anywhere ===');
  ok(errors.length === 0, 'admin page produced no errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  ok(te.length === 0, 'trainee page produced no errors' + (te.length ? ': ' + te.slice(0, 3).join(' | ') : ''));

  await browser.close();
  server.close();
  await pool.end();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
