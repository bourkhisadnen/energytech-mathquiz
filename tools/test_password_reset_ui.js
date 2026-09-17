/* Being made to choose your own password after a reset, in a real browser
 * against the REAL energytech-api backend (Express + Postgres). See
 * test_roster.js's header for the shared mechanics (served from public/ via
 * src/app.js, seeded/asserted through TEST_DATABASE_URL, never DATABASE_URL).
 *
 * This suite did not exist until now. tools/mutate_backend.js named it
 * against four real, current mutations for years with nothing behind it --
 * checked against this repo's full git history when the gap was found, and
 * there was no record of it ever having been built. The behaviour was real
 * and untested, not gone, so this is a new suite closing that, not a repoint
 * of a mocked one.
 *
 * No email anywhere in this app: a reset is a temporary password read aloud
 * by whoever reset it. Everything here follows from that one fact --
 * - the temporary password must get the account to a "choose your own" form
 *   and no further, for both roles it can happen to (instructor, trainee);
 * - the form must refuse the temporary password back as the new one, or a
 *   trainee handed the same slip twice keeps the password that was read out
 *   loud, which is the whole flow's reason to exist;
 * - a lone admin has to be told nobody can reset them, at the point a second
 *   admin would be made rather than discovered the day it matters. */

const path = require('path');
const { chromium } = require('playwright');

const ENERGYTECH_API_ROOT = path.join(__dirname, '..', '..', 'energytech-api');
require('dotenv').config({ path: path.join(ENERGYTECH_API_ROOT, '.env') });

const {
  pool, resetDb, insertInstructor, insertIntake, insertGroup, insertTrainee,
} = require(path.join(ENERGYTECH_API_ROOT, 'tests', 'helpers', 'db'));
const { hashPasswordForStorage } = require(path.join(ENERGYTECH_API_ROOT, 'src', 'lib', 'passwords'));
const app = require(path.join(ENERGYTECH_API_ROOT, 'src', 'app'));

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const visible = (p, sel) => p.evaluate(s => {
  const el = document.querySelector(s);
  return Boolean(el && el.offsetParent !== null);
}, sel);

const TEMP_INSTRUCTOR_PW = 'TEMP-1A2B';
const TEMP_TRAINEE_PW = 'TEMP-3C4D';

(async () => {
  await resetDb();

  // The only admin in the centre, until step 4 adds a second.
  const adminPw = await hashPasswordForStorage('admin1pw');
  await insertInstructor({
    username: 'admin1', displayName: 'Admin One', role: 'admin', status: 'approved',
    passwordHash: adminPw.passwordHash, passwordSalt: adminPw.passwordSalt, passwordAlgo: adminPw.passwordAlgo,
  });

  // An instructor an admin has reset. mustChangePassword is what the reset
  // action itself sets; seeded directly here rather than driven through
  // admin_reset_instructor_password, since that action is not what is under
  // test -- what happens on the NEXT login with the temporary password is.
  const resetInstructorPw = await hashPasswordForStorage(TEMP_INSTRUCTOR_PW);
  await insertInstructor({
    username: 'reset1', displayName: 'Reset One', role: 'instructor', status: 'approved',
    passwordHash: resetInstructorPw.passwordHash, passwordSalt: resetInstructorPw.passwordSalt,
    passwordAlgo: resetInstructorPw.passwordAlgo, mustChangePassword: true,
  });

  const intakeId = await insertIntake('JAN26');
  const groupId = await insertGroup(intakeId, 'G1');
  const resetTraineePw = await hashPasswordForStorage(TEMP_TRAINEE_PW);
  await insertTrainee({
    energytechId: 'ET2000', name: 'Reset Trainee', intakeId, groupId, accountStatus: 'active',
    passwordHash: resetTraineePw.passwordHash, passwordSalt: resetTraineePw.passwordSalt,
    passwordAlgo: resetTraineePw.passwordAlgo, mustChangePassword: true,
  });

  const server = app.listen(0);
  const { port } = server.address();
  const BASE = `http://127.0.0.1:${port}/index.html`;

  const browser = await chromium.launch();
  const errs = [];

  console.log('\n=== 1. A reset instructor is stopped at the choose-your-own form ===');
  {
    const p = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE);
    await p.click('#teacherModeBtn');
    await p.fill('#teacherLoginUsername', 'reset1');
    await p.fill('#teacherLoginPassword', TEMP_INSTRUCTOR_PW);
    await p.click('#teacherLoginBtn');
    await p.waitForSelector('#teacherMustChangePanel:not([hidden])');
    ok(!(await visible(p, '#teacherInterface')), 'the temporary password does not open the interface');
    ok(await visible(p, '#teacherMustChangePanel'), 'the choose-your-own form is shown instead');
    ok(/reset/i.test(await p.textContent('#teacherLoginStatus')), 'and says why');

    console.log('\n=== 1b. The form refuses the temporary password as the new one ===');
    await p.fill('#teacherForcedNewPassword', TEMP_INSTRUCTOR_PW);
    await p.fill('#teacherForcedConfirm', TEMP_INSTRUCTOR_PW);
    await p.click('#teacherForcedChangeBtn');
    await p.waitForSelector('#teacherForcedStatus:not([hidden])');
    ok(/other than the temporary password/i.test(await p.textContent('#teacherForcedStatus')),
      'says to choose something other than the temporary password');
    ok(await visible(p, '#teacherMustChangePanel'), 'and the form is still up -- nothing was accepted');
    ok(!(await visible(p, '#teacherInterface')), 'the interface is still shut');

    console.log('\n=== 1c. A genuinely new password is accepted, and signs them in ===');
    await p.fill('#teacherForcedNewPassword', 'MyOwnPass1');
    await p.fill('#teacherForcedConfirm', 'MyOwnPass1');
    await p.click('#teacherForcedChangeBtn');
    await p.waitForSelector('#teacherInterface:not([hidden])');
    ok(!(await visible(p, '#teacherMustChangePanel')), 'the choose-your-own form is put away');
    await p.close();
  }

  console.log('\n=== 2. A reset trainee is stopped at the same form, not the quiz screen ===');
  {
    const p = await browser.newPage({ viewport: { width: 900, height: 1000 } });
    p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE);
    await p.click('#studentModeBtn');
    await p.fill('#traineeLoginId', 'ET2000');
    await p.fill('#traineeLoginPassword', TEMP_TRAINEE_PW);
    await p.click('#traineeLoginBtn');
    await p.waitForSelector('#traineeMustChangePanel:not([hidden])');
    ok(!(await visible(p, '#traineeHomePanel')), 'the temporary password does not reach the quiz screen');
    ok(await visible(p, '#traineeMustChangePanel'), 'the choose-your-own form is shown instead');
    ok(/reset/i.test(await p.textContent('#traineeLoginStatus')), 'and says why');

    console.log('\n=== 2b. Same refusal, for a trainee ===');
    await p.fill('#traineeForcedNewPassword', TEMP_TRAINEE_PW);
    await p.fill('#traineeForcedConfirm', TEMP_TRAINEE_PW);
    await p.click('#traineeForcedChangeBtn');
    await p.waitForSelector('#traineeForcedStatus:not([hidden])');
    ok(/other than the temporary password/i.test(await p.textContent('#traineeForcedStatus')),
      'says to choose something other than the temporary password');
    ok(await visible(p, '#traineeMustChangePanel'), 'and the form is still up');
    ok(!(await visible(p, '#traineeHomePanel')), 'the quiz screen is still out of reach');

    console.log('\n=== 2c. A genuinely new password lets them through ===');
    await p.fill('#traineeForcedNewPassword', 'MyOwnPass2');
    await p.fill('#traineeForcedConfirm', 'MyOwnPass2');
    await p.click('#traineeForcedChangeBtn');
    await p.waitForSelector('#traineeHomePanel:not([hidden])');
    ok(!(await visible(p, '#traineeMustChangePanel')), 'the choose-your-own form is put away');
    await p.close();
  }

  console.log('\n=== 3. A lone admin is told nobody can reset them ===');
  {
    const p = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE);
    await p.click('#teacherModeBtn');
    await p.fill('#teacherLoginUsername', 'admin1');
    await p.fill('#teacherLoginPassword', 'admin1pw');
    await p.click('#teacherLoginBtn');
    await p.waitForSelector('#teacherInterface:not([hidden])');
    await p.click('#loadInstructorAccountsBtn');
    await p.waitForSelector('#instructorAccountsOutput .lone-admin-note');
    ok(/only admin/i.test(await p.textContent('.lone-admin-note')), 'names admin1 as the only admin');

    console.log('\n=== 4. A second admin, and the warning is gone ===');
    const admin2Pw = await hashPasswordForStorage('admin2pw');
    await insertInstructor({
      username: 'admin2', displayName: 'Admin Two', role: 'admin', status: 'approved',
      passwordHash: admin2Pw.passwordHash, passwordSalt: admin2Pw.passwordSalt, passwordAlgo: admin2Pw.passwordAlgo,
    });
    await p.click('#loadInstructorAccountsBtn');
    await p.waitForFunction(() => document.getElementById('instructorAccountsOutput').textContent.includes('admin2'));
    ok(!(await p.$('.lone-admin-note')), 'the note is gone now that a second admin exists');
    await p.close();
  }

  console.log('\n=== 5. No page errors ===');
  ok(errs.length === 0, errs.length ? errs.join(' | ') : 'none');

  await browser.close();
  server.close();
  await pool.end();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
