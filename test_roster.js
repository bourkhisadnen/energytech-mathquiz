/* End-to-end test of the rebuilt roster workspace against a mocked Apps Script
 * backend that mirrors Code.gs semantics: admin gating, cascading renames,
 * refusal to delete anything with children, whole-intake import with a group
 * column, bulk moves, and trainee accounts. */

const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8902/energytech-mathquiz/index.html';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let failures = [], checks = 0;
function ok(cond, label) {
  checks++;
  if (cond) console.log('  PASS  ' + label);
  else { console.log('  FAIL  ' + label); failures.push(label); }
}

/* ---------------- the fake backend ---------------- */

const norm = s => String(s || '').trim().toUpperCase();
const GROUP_RE = /^G([1-9]|1[0-9]|20)$/;

function newBackend() {
  return {
    instructors: {
      adnen: { password: '1231234', displayName: 'Adnane Khalifa', role: 'admin', token: 'ADMTOK' },
      sara: { password: 'pw', displayName: 'Sara', role: 'instructor', token: 'INSTOK' }
    },
    intakes: [], groups: [], trainees: [], sessions: {}, attempts: [], traineeTokens: {}
  };
}
function auth(db, p) {
  const name = Object.keys(db.instructors).find(u => db.instructors[u].token === String(p.token || ''));
  return name ? { ok: true, username: name, role: db.instructors[name].role } : { ok: false, error: 'Not logged in.' };
}
function admin(db, p) {
  const a = auth(db, p);
  if (!a.ok) return a;
  return a.role === 'admin' ? a : { ok: false, error: 'Admin access required.' };
}
const pub = t => ({ energytechId: t.energytechId, name: t.name, intake: t.intake, group: t.group, accountStatus: t.accountStatus });

function handleGet(db, p) {
  switch (p.action) {
    case 'ping': return { ok: true, message: 'EnergyTech Quiz backend is running.' };
    case 'auth_login': {
      const u = db.instructors[p.username];
      return (u && u.password === p.password)
        ? { ok: true, token: u.token, username: p.username, displayName: u.displayName, role: u.role }
        : { ok: false, error: 'Wrong username or password.' };
    }
    case 'admin_list_instructors': { const a = auth(db, p); return a.ok ? { ok: true, instructors: [] } : a; }
    case 'roster_list': {
      const a = auth(db, p); if (!a.ok) return a;
      return { ok: true,
        intakes: db.intakes.map(l => ({ label: l, status: 'active' })),
        groups: db.groups.map(g => {
          const mine = db.trainees.filter(t => t.intake === g.intake && t.group === g.name);
          return { intake: g.intake, name: g.name, trainees: mine.length,
            withAccount: mine.filter(t => t.accountStatus === 'active').length };
        }) };
    }
    case 'trainee_list': {
      const a = auth(db, p); if (!a.ok) return a;
      return { ok: true, trainees: db.trainees
        .filter(t => (!p.intake || norm(t.intake) === norm(p.intake)) && (!p.group || norm(t.group) === norm(p.group)))
        .map(pub) };
    }
    case 'intake_save': {
      const a = admin(db, p); if (!a.ok) return a;
      const label = norm(p.label), previous = norm(p.previousLabel);
      if (!label) return { ok: false, error: 'A label is required.' };
      if (db.intakes.some(l => norm(l) === label && norm(l) !== previous)) return { ok: false, error: 'An intake with that label already exists.' };
      if (previous) {
        const i = db.intakes.findIndex(l => norm(l) === previous);
        if (i < 0) return { ok: false, error: 'Intake not found.' };
        db.intakes[i] = label;
        db.groups.forEach(g => { if (norm(g.intake) === previous) g.intake = label; });
        db.trainees.forEach(t => { if (norm(t.intake) === previous) t.intake = label; });
        return { ok: true, label };
      }
      db.intakes.push(label);
      return { ok: true, label };
    }
    case 'intake_delete': {
      const a = admin(db, p); if (!a.ok) return a;
      const label = norm(p.label);
      const g = db.groups.filter(x => norm(x.intake) === label).length;
      if (g) return { ok: false, error: `Intake ${label} still has ${g} group(s). Delete or move them first.` };
      db.intakes = db.intakes.filter(l => norm(l) !== label);
      return { ok: true, deleted: label };
    }
    case 'group_save': {
      const a = admin(db, p); if (!a.ok) return a;
      const intake = norm(p.intake), name = norm(p.name), previous = norm(p.previousName);
      if (!GROUP_RE.test(name)) return { ok: false, error: 'Group name must be G1 to G20.' };
      if (!db.intakes.some(l => norm(l) === intake)) return { ok: false, error: `Intake ${intake} does not exist.` };
      if (db.groups.some(x => norm(x.intake) === intake && norm(x.name) === name && name !== previous)) {
        return { ok: false, error: `${name} already exists in ${intake}.` };
      }
      if (previous) {
        const g = db.groups.find(x => norm(x.intake) === intake && norm(x.name) === previous);
        if (!g) return { ok: false, error: 'Group not found.' };
        g.name = name;
        db.trainees.forEach(t => { if (norm(t.intake) === intake && norm(t.group) === previous) t.group = name; });
        return { ok: true, name };
      }
      db.groups.push({ intake, name });
      return { ok: true, name };
    }
    case 'group_delete': {
      const a = admin(db, p); if (!a.ok) return a;
      const intake = norm(p.intake), name = norm(p.name);
      const n = db.trainees.filter(t => norm(t.intake) === intake && norm(t.group) === name).length;
      if (n) return { ok: false, error: `${name} in ${intake} still has ${n} trainee(s). Remove them first.` };
      db.groups = db.groups.filter(g => !(norm(g.intake) === intake && norm(g.name) === name));
      return { ok: true, deleted: name };
    }
    case 'trainee_save': {
      const a = admin(db, p); if (!a.ok) return a;
      const id = norm(p.energytechId), previousId = norm(p.previousId);
      const intake = norm(p.intake), group = norm(p.group);
      if (!id) return { ok: false, error: 'EnergyTech ID is required.' };
      if (!db.groups.some(g => norm(g.intake) === intake && norm(g.name) === group)) return { ok: false, error: `Group ${group} does not exist in intake ${intake}.` };
      const clash = db.trainees.find(t => t.energytechId === id);
      if (clash && clash.energytechId !== previousId) return { ok: false, error: `A trainee with ID ${id} already exists.` };
      if (previousId) {
        const target = db.trainees.find(t => t.energytechId === previousId);
        if (!target) return { ok: false, error: 'Trainee not found.' };
        Object.assign(target, { energytechId: id, name: String(p.name || ''), intake, group });
        return { ok: true, energytechId: id, updated: true };
      }
      db.trainees.push({ energytechId: id, name: String(p.name || ''), intake, group, accountStatus: 'none', password: '' });
      return { ok: true, energytechId: id };
    }
    case 'trainee_delete': {
      const a = admin(db, p); if (!a.ok) return a;
      const id = norm(p.energytechId);
      if (db.attempts.some(x => norm(x.energytechId) === id)) return { ok: false, error: `Trainee ${id} has recorded attempt(s). Revoke the account instead.` };
      db.trainees = db.trainees.filter(t => t.energytechId !== id);
      return { ok: true, deleted: id };
    }
    case 'trainee_set_account': {
      const a = admin(db, p); if (!a.ok) return a;
      const t = db.trainees.find(x => x.energytechId === norm(p.energytechId));
      if (!t) return { ok: false, error: 'Trainee not found.' };
      t.accountStatus = p.status;
      return { ok: true, status: p.status };
    }
    case 'trainee_move': {
      const a = admin(db, p); if (!a.ok) return a;
      const intake = norm(p.intake), group = norm(p.group);
      if (!db.groups.some(g => norm(g.intake) === intake && norm(g.name) === group)) return { ok: false, error: `Group ${group} does not exist in intake ${intake}.` };
      const ids = String(p.ids || '').split(',').map(norm).filter(Boolean);
      if (!ids.length) return { ok: false, error: 'No trainees were chosen.' };
      let moved = 0; const missing = [];
      ids.forEach(id => {
        const t = db.trainees.find(x => x.energytechId === id);
        if (!t) { missing.push(id); return; }
        t.intake = intake; t.group = group; moved++;
      });
      return { ok: true, moved, missing };
    }
    case 'trainee_signup': {
      const t = db.trainees.find(x => x.energytechId === norm(p.energytechId));
      if (!t) return { ok: false, error: 'That EnergyTech ID is not on any intake list. Ask your instructor to add you.' };
      if (t.accountStatus === 'active') return { ok: false, error: 'An account already exists for this ID.' };
      if (String(p.password || '').length < 6) return { ok: false, error: 'Password must be at least 6 characters.' };
      t.accountStatus = 'active'; t.password = p.password;
      const tok = 'TT-' + t.energytechId; db.traineeTokens[tok] = t.energytechId;
      return { ok: true, token: tok, trainee: pub(t) };
    }
    case 'trainee_login': {
      const t = db.trainees.find(x => x.energytechId === norm(p.energytechId));
      if (!t || t.accountStatus !== 'active' || t.password !== p.password) return { ok: false, error: 'Wrong EnergyTech ID or password.' };
      const tok = 'TT-' + t.energytechId; db.traineeTokens[tok] = t.energytechId;
      return { ok: true, token: tok, trainee: pub(t) };
    }
    case 'session': { const s = db.sessions[norm(p.code)]; return s ? { ok: true, session: s } : { ok: false, error: 'Session not found.' }; }
    default: return { ok: true, message: 'EnergyTech Quiz backend is running.' };
  }
}

function handlePost(db, body) {
  if (body.type === 'quiz_session') { if (auth(db, body).ok) db.sessions[norm(body.session.sessionCode)] = body.session; return; }
  if (body.type === 'trainee_import') {
    if (!admin(db, body).ok) return;
    const intake = norm(body.intake), fallback = norm(body.group);
    const known = new Set(db.groups.filter(g => norm(g.intake) === intake).map(g => norm(g.name)));
    const wanted = [], bad = [];
    (body.rows || []).forEach(r => {
      const g = norm(r.group) || fallback;
      if (!g) return;
      if (!GROUP_RE.test(g)) bad.push(g); else if (!wanted.includes(g)) wanted.push(g);
    });
    if (bad.length) return;
    wanted.forEach(g => { if (!known.has(g)) { db.groups.push({ intake, name: g }); known.add(g); } });
    (body.rows || []).forEach(r => {
      const id = norm(r.energytechId), g = norm(r.group) || fallback;
      if (!id || !g || db.trainees.some(t => t.energytechId === id)) return;
      db.trainees.push({ energytechId: id, name: r.name || '', intake, group: g, accountStatus: 'none', password: '' });
    });
    return;
  }
  if (body.type === 'quiz_attempt') {
    let identity = { name: (body.student || {}).name || '', group: '', energytechId: (body.student || {}).energytechId || '', intake: '', registered: 'walk-in' };
    if (body.traineeToken && db.traineeTokens[body.traineeToken]) {
      const t = db.trainees.find(x => x.energytechId === db.traineeTokens[body.traineeToken]);
      if (t) identity = { name: t.name, group: t.group, energytechId: t.energytechId, intake: t.intake, registered: 'yes' };
    }
    db.attempts.push(Object.assign({ score: body.score }, identity));
  }
}

async function mount(page, db) {
  await page.route(/script\.google\.com/, async route => {
    const req = route.request();
    if (req.method() === 'POST') {
      let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch {}
      handlePost(db, body);
      return route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
    }
    const p = Object.fromEntries(new URL(req.url()).searchParams);
    return route.fulfill({ status: 200, contentType: 'application/javascript',
      body: `${p.callback}(${JSON.stringify(handleGet(db, p))});` });
  });
}

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
  const browser = await chromium.launch({ executablePath: EXEC });
  const db = newBackend();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  let dialogAnswer = null;
  page.on('dialog', async d => {
    if (d.type() === 'confirm') return d.accept();
    await d.accept(dialogAnswer === null ? d.defaultValue() : dialogAnswer);
  });
  await mount(page, db);
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
  ok(db.groups.length === 3, 'G2 and G3 were created by the import');
  ok(db.trainees.length === 5, 'five trainees on record');
  ok(db.trainees.filter(t => t.group === 'G2').length === 2, 'the G2 rows went to G2');

  console.log('\n=== 6. Filtering by who still has no login ===');
  await page.click('.pane-item[data-group="G2"]');
  await page.waitForFunction(() => document.querySelectorAll('.roster-table tbody tr').length === 2);
  db.trainees.find(t => t.energytechId === 'ET1003').accountStatus = 'active';
  await page.click('#loadRosterBtn');
  await page.waitForTimeout(600);
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
  ok(db.trainees.filter(t => t.group === 'G3').length === 3, 'all three are in G3 now');
  ok(/Al-Ghamdi/.test(db.trainees.find(t => t.energytechId === 'ET1003').name), 'the move left their names alone');
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
  const moved = db.trainees.find(t => t.energytechId === 'ET1003');
  ok(moved.name === 'Turki Saad Al-Ghamdi Renamed', 'the name was saved');
  ok(moved.group === 'G1', 'and the group change moved them');
  ok(db.trainees.filter(t => t.energytechId === 'ET1003').length === 1, 'editing did not duplicate the row');

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
  ok(db.intakes.length === 1 && db.groups.length === 3, 'nothing was actually deleted');

  console.log('\n=== 11. Renaming cascades ===');
  dialogAnswer = 'FEB26';
  await page.click('.pane-item[data-intake="JAN26"] .intake-rename');
  await page.waitForSelector('.pane-item[data-intake="FEB26"]', { timeout: 10000 });
  dialogAnswer = null;
  ok(db.groups.every(g => g.intake === 'FEB26'), 'groups followed the intake rename');
  ok(db.trainees.every(t => t.intake === 'FEB26'), 'trainees followed the intake rename');
  ok(await page.isVisible('.pane-item[data-intake="FEB26"].is-selected'), 'and the renamed intake stays selected');

  console.log('\n=== 12. Session pickers still fed from the roster ===');
  await page.selectOption('#sessionIntake', 'FEB26');
  await page.waitForFunction(() => document.querySelector('#sessionGroup').options.length === 4);
  const groupOpts = await page.$$eval('#sessionGroup option', o => o.map(x => x.textContent));
  const g1Count = db.trainees.filter(t => t.group === 'G1').length;
  ok(groupOpts.join('|').includes(`G1 (${g1Count})`),
    `the group picker shows live trainee counts (wanted G1 (${g1Count}), got ${groupOpts.join(' ')})`);

  console.log('\n=== 13. A plain instructor gets the pickers but not the editor ===');
  const p2 = await browser.newPage();
  const e2 = [];
  p2.on('pageerror', e => e2.push(String(e)));
  await mount(p2, db);
  await p2.goto(BASE);
  await login(p2, 'sara', 'pw');
  ok(await p2.isHidden('#intakePanelSection'), 'intake editor hidden from a plain instructor');
  await p2.waitForFunction(() => document.querySelector('#sessionIntake').options.length === 2);
  ok(true, 'but the intake picker is still filled');
  ok(e2.length === 0, 'no page errors on the instructor page');
  await p2.close();

  console.log('\n=== 14. A trainee can still sign up and sit a quiz ===');
  const tp = await browser.newPage();
  const te = [];
  tp.on('pageerror', e => te.push(String(e)));
  tp.on('console', m => { if (m.type() === 'error') te.push('console: ' + m.text()); });
  await mount(tp, db);
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
  await page.waitForFunction(() => /Session code:/.test(document.querySelector('#sessionStatus').textContent));
  const code = await page.$eval('.session-code-box', el => el.textContent.trim());
  await page.waitForTimeout(500);
  await tp.fill('#studentSessionCode', code);
  await tp.click('#loadTraineeSessionBtn');
  await tp.waitForSelector('#studentQuizArea:not([hidden])');
  await tp.$$eval('#studentQuizContainer .question-card', cards =>
    cards.forEach(c => { const r = c.querySelector('input[type="radio"]'); if (r) r.click(); }));
  await tp.click('#studentSubmitBtn');
  await tp.waitForTimeout(700);
  const attempt = db.attempts[db.attempts.length - 1];
  ok(attempt && attempt.registered === 'yes' && attempt.energytechId === 'ET1001', 'the attempt is identified from the roster');
  ok(attempt && attempt.intake === 'FEB26', 'and carries the intake');

  console.log('\n=== 15. Revoking logins in bulk ===');
  await page.click('.pane-item[data-group="G1"]');
  const inG1 = db.trainees.filter(t => t.group === 'G1').length;
  await page.waitForFunction(n => document.querySelectorAll('.roster-table tbody tr').length === n, inG1);
  // ET1002 came in by CSV and never signed up, so it is the control here.
  const hadLogin = db.trainees.filter(t => t.group === 'G1' && t.accountStatus === 'active').map(t => t.energytechId);
  ok(hadLogin.length > 0, `at least one G1 trainee has a login to revoke (${hadLogin.join(', ')})`);
  await page.click('#pickAll');
  await page.waitForSelector('#bulkBar:not([hidden])');
  await page.click('#bulkRevokeBtn');
  await page.waitForFunction(() => /revoked/.test(document.querySelector('#traineeList').textContent), null, { timeout: 15000 });
  ok(hadLogin.every(id => db.trainees.find(t => t.energytechId === id).accountStatus === 'revoked'),
    'every trainee who had a login was revoked');
  ok(db.trainees.find(t => t.energytechId === 'ET1002').accountStatus === 'none',
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
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
