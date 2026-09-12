/* The roster as an instructor sees it, and the admin control that decides.
 *
 * The rules live in the backend -- test_backend.js §14 proves them against the
 * real Code.gs. This suite is about the page: that an instructor is SHOWN the
 * groups assigned to them and nothing else, that the controls they must not
 * use are not drawn, and that the admin can hand a group over and take it back.
 *
 * One check here is security-relevant rather than cosmetic. The search box
 * used to build its index by asking for every trainee in one unscoped call.
 * The backend now refuses that from a non-admin, so the page has to ask group
 * by group instead; §5 pins that it never makes the unscoped call, because a
 * page that did would look fine right up until someone relaxed the backend.
 */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8901/index.html';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const GROUPS = [
  { intake: 'JAN26', name: 'G1', trainees: 24, withAccount: 22 },
  { intake: 'JAN26', name: 'G2', trainees: 19, withAccount: 19 },
  { intake: 'MAR26', name: 'G1', trainees: 21, withAccount: 20 }
];

/* A backend with just enough memory that assigning a group and reading the
 * roster back behaves like the real one. It filters exactly where Code.gs
 * filters, so the page cannot pass here by filtering in the browser. */
function backend(role, assignedAtStart) {
  const state = { assigned: assignedAtStart ? assignedAtStart.slice() : [], calls: [] };
  state.handle = (q) => {
    state.calls.push(q);
    const admin = role === 'admin';
    const asPairs = () => state.assigned.map(k => ({ intake: k.split('/')[0], group: k.split('/')[1] }));
    switch (q.action) {
      case 'auth_login':
        return { ok: true, token: 'T', username: admin ? 'adnen' : 'sara',
                 displayName: admin ? 'Adnane Khalifa' : 'Sara Nasser', role };
      case 'roster_list': {
        const vis = admin ? GROUPS : GROUPS.filter(g => state.assigned.includes(g.intake + '/' + g.name));
        return { ok: true,
          intakes: [...new Set(vis.map(g => g.intake))].map(l => ({ label: l, status: 'active' })),
          groups: vis,
          viewer: { username: admin ? 'adnen' : 'sara', role, canEdit: admin,
                    assignedGroups: admin ? null : asPairs() } };
      }
      case 'trainee_list': {
        if (!admin && (!q.intake || !q.group)) return { ok: false, error: 'Name the intake and group.' };
        if (!admin && !state.assigned.includes(q.intake + '/' + q.group)) {
          return { ok: false, error: 'That group is not assigned to you.' };
        }
        return { ok: true, trainees: [
          { energytechId: 'ET1001', name: 'Ahmed Al-Rashid', intake: q.intake || 'JAN26', group: q.group || 'G1', accountStatus: 'active' },
          { energytechId: 'ET1002', name: 'Bilal Hakim', intake: q.intake || 'JAN26', group: q.group || 'G1', accountStatus: 'none' }
        ] };
      }
      case 'admin_list_instructors':
        return { ok: true, instructors: [
          { username: 'adnen', displayName: 'Adnane Khalifa', role: 'admin', status: 'approved', assignedGroups: [] },
          { username: 'sara', displayName: 'Sara Nasser', role: 'instructor', status: 'approved', assignedGroups: asPairs() }
        ] };
      case 'admin_set_instructor_groups':
        state.assigned = String(q.groups || '').split(';').filter(Boolean);
        return { ok: true, username: q.username, assignedGroups: asPairs() };
      case 'admin_reset_trainee_password':
        return { ok: true, energytechId: q.energytechId, name: 'Ahmed Al-Rashid', temporaryPassword: 'ABCD-2345' };
      default:
        return { ok: true, message: 'mock' };
    }
  };
  return state;
}

async function signIn(ctx, state, who) {
  const page = await ctx.newPage();
  page.on('pageerror', e => { throw e; });
  await page.route(/script\.google\.com/, r => {
    const q = Object.fromEntries(new URL(r.request().url()).searchParams);
    return r.fulfill({ status: 200, contentType: 'application/javascript',
                       body: `${q.callback}(${JSON.stringify(state.handle(q))});` });
  });
  await page.goto(BASE);
  await page.click('#teacherModeBtn');
  await page.fill('#teacherLoginUsername', who);
  await page.fill('#teacherLoginPassword', 'x');
  await page.click('#teacherLoginBtn');
  await page.waitForSelector('#teacherInterface:not([hidden])');
  await page.waitForTimeout(500);
  return page;
}

const controls = page => page.evaluate(() => ({
  cardShown: !document.getElementById('intakePanelSection').hidden,
  addIntake: !document.getElementById('showAddIntake').hidden,
  addGroup: !document.getElementById('showAddGroup').hidden,
  addTrainee: !document.getElementById('showAddTrainee').hidden,
  importCsv: !document.getElementById('importCsvBtn').hidden,
  edits: document.querySelectorAll('.trainee-edit').length,
  deletes: document.querySelectorAll('.trainee-delete').length,
  resets: document.querySelectorAll('.trainee-reset-pw').length,
  names: document.querySelectorAll('.open-profile').length,
  ticks: document.querySelectorAll('.pick-trainee').length,
  headerTicks: document.querySelectorAll('#traineeList th.pick').length
}));

const drillIn = async page => {
  await page.click('#intakeList .pane-item');
  await page.waitForTimeout(300);
  await page.click('#groupList .pane-item');
  await page.waitForTimeout(500);
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });

  console.log('\n=== 1. An instructor with a group assigned sees it, read-only ===');
  {
    const state = backend('instructor', ['JAN26/G1']);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await signIn(ctx, state, 'sara');
    ok((await controls(page)).cardShown, 'the roster card is shown to a non-admin at all -- it used to be hidden');
    const panes = await page.evaluate(() => ({
      intakes: [...document.querySelectorAll('#intakeList .pane-item-name')].map(e => e.textContent.trim()),
      groups: [...document.querySelectorAll('#groupList .pane-item-name')].map(e => e.textContent.trim())
    }));
    eq(panes.intakes, ['JAN26'], 'only the intake her group sits in -- MAR26 is not listed');
    await drillIn(page);
    const c = await controls(page);
    eq([c.addIntake, c.addGroup, c.addTrainee, c.importCsv], [false, false, false, false],
      'nothing that creates anything is offered');
    eq([c.edits, c.deletes, c.ticks, c.headerTicks], [0, 0, 0, 0],
      'no edit, no delete, and no tick boxes -- including the one in the header, which would leave the row misaligned');
    ok(c.names === 2, 'both names are still links, which is how a record is opened');
    ok(c.resets === 1, 'and the one trainee with a login can have their password reset');
    const hint = await page.evaluate(() => document.getElementById('rosterHint').textContent);
    ok(/assigned to you/i.test(hint) && /only an admin/i.test(hint),
      'the card says whose groups these are and who may change them');
    await ctx.close();
  }

  console.log('\n=== 2. An instructor with nothing assigned ===');
  {
    const state = backend('instructor', []);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await signIn(ctx, state, 'sara');
    const c = await controls(page);
    ok(c.cardShown, 'still sees the card rather than a missing feature');
    const empty = await page.evaluate(() => document.getElementById('intakeList').textContent);
    ok(/no groups are assigned to you/i.test(empty),
      'and is told why it is empty, and who can fix it');
    ok(!/\+ New/.test(empty), 'not invited to create an intake she is not allowed to create');
    await ctx.close();
  }

  console.log('\n=== 3. The admin still has the whole roster ===');
  {
    const state = backend('admin', []);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await signIn(ctx, state, 'adnen');
    const panes = await page.evaluate(() =>
      [...document.querySelectorAll('#intakeList .pane-item-name')].map(e => e.textContent.trim()));
    eq(panes, ['JAN26', 'MAR26'], 'every intake');
    await drillIn(page);
    const c = await controls(page);
    eq([c.addIntake, c.addGroup, c.addTrainee, c.importCsv], [true, true, true, true], 'all the creating controls');
    ok(c.edits === 2 && c.deletes === 2 && c.ticks === 2 && c.headerTicks === 1,
      'edit, delete and the tick boxes on every row, with the select-all in the header');
    // The actions column is meant to shrink to its buttons. It did not: making
    // the cell a flex container defeated `width: 1%` and the buttons spilled
    // over the account badge. Long-standing, and invisible until a group had
    // trainees in it.
    const fits = await page.evaluate(() => {
      const td = document.querySelector('#traineeList tbody tr .row-actions');
      const wanted = [...td.querySelectorAll('button')]
        .reduce((a, b) => a + b.getBoundingClientRect().width, 0);
      return td.getBoundingClientRect().width >= wanted;
    });
    ok(fits, 'and the row actions fit inside their own column instead of over the badge');
    await ctx.close();
  }

  console.log('\n=== 4. The admin hands a group over, and takes it back ===');
  {
    const state = backend('admin', []);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await signIn(ctx, state, 'adnen');
    await page.click('#loadInstructorAccountsBtn');
    await page.waitForTimeout(500);
    const before = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#instructorAccountsOutput tr')];
      const sara = rows.find(r => r.textContent.includes('sara'));
      const admin = rows.find(r => r.textContent.includes('adnen'));
      return { sara: sara.querySelector('.covers-cell').textContent.trim(),
               admin: admin.querySelector('.covers-cell').textContent.trim(),
               adminHasButton: !!admin.querySelector('.account-groups-btn') };
    });
    ok(/no groups yet/i.test(before.sara), 'sara covers nothing to begin with');
    ok(/every group/i.test(before.admin), 'the admin row says they already see everything');
    ok(!before.adminHasButton, 'and offers no control to assign an admin groups they would not use');

    await page.click('.account-groups-btn');
    await page.waitForTimeout(400);
    const offered = await page.evaluate(() =>
      [...document.querySelectorAll('.covers-box')].map(b => b.value));
    eq(offered, ['JAN26/G1', 'JAN26/G2', 'MAR26/G1'], 'the editor offers every group in the centre');
    await page.check('.covers-box[value="JAN26/G1"]');
    await page.check('.covers-box[value="MAR26/G1"]');
    await page.click('.save-groups');
    await page.waitForTimeout(600);
    const sent = state.calls.filter(c => c.action === 'admin_set_instructor_groups').pop();
    eq(sent.groups, 'JAN26/G1;MAR26/G1', 'the two ticked groups are sent, as one string');
    eq(sent.username, 'sara', 'for the right instructor');
    const after = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#instructorAccountsOutput tr')]
        .find(r => r.textContent.includes('sara'));
      return [...row.querySelectorAll('.covers-chip')].map(c => c.textContent.trim());
    });
    eq(after, ['JAN26/G1', 'MAR26/G1'], 'and the row now shows what she covers');

    await page.click('.account-groups-btn');
    await page.waitForTimeout(400);
    await page.uncheck('.covers-box[value="MAR26/G1"]');
    await page.uncheck('.covers-box[value="JAN26/G1"]');
    await page.click('.save-groups');
    await page.waitForTimeout(600);
    eq(state.calls.filter(c => c.action === 'admin_set_instructor_groups').pop().groups, '',
      'unticking everything sends an empty list, which is how cover ends');
    await ctx.close();
  }

  console.log('\n=== 5. The search never asks for the whole centre ===');
  {
    const state = backend('instructor', ['JAN26/G1', 'MAR26/G1']);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await signIn(ctx, state, 'sara');
    await page.fill('#rosterSearch', 'Ahmed');
    await page.waitForTimeout(900);
    const listCalls = state.calls.filter(c => c.action === 'trainee_list');
    const unscoped = listCalls.filter(c => !c.intake || !c.group);
    eq(unscoped.length, 0, 'not one unscoped trainee_list -- the backend would refuse it, and the page must not rely on that');
    const asked = listCalls.map(c => `${c.intake}/${c.group}`);
    ok(asked.includes('JAN26/G1') && asked.includes('MAR26/G1'),
      `the index is built from her own groups instead (${[...new Set(asked)].join(', ')})`);
    const hits = await page.evaluate(() => document.getElementById('traineeList').textContent);
    ok(/Ahmed Al-Rashid/.test(hits), 'and the search still finds a trainee');
    await ctx.close();
  }

  console.log('\n=== 6. Resetting a password is still offered to the instructor ===');
  {
    const state = backend('instructor', ['JAN26/G1']);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await signIn(ctx, state, 'sara');
    await drillIn(page);
    page.once('dialog', d => d.accept());
    await page.click('.trainee-reset-pw');
    await page.waitForTimeout(600);
    const call = state.calls.filter(c => c.action === 'admin_reset_trainee_password').pop();
    ok(call && call.energytechId === 'ET1001', 'the reset reaches the backend for the right trainee');
    const shown = await page.evaluate(() => document.body.textContent);
    ok(/ABCD-2345/.test(shown), 'and the temporary password is shown to read out');
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})();
