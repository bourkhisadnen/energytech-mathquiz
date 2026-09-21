/* What a person SEES when the per-account login throttle bites, in a real
 * browser against the REAL energytech-api backend (Express + Postgres). See
 * test_roster.js's header for the shared mechanics.
 *
 * The throttle itself (ten free failures, then a doubling lock, capped) is
 * proved at the API in energytech-api/tests/loginThrottle.test.js. This is
 * about the last inch, which is where it went wrong before it was built: the
 * refusal is an HTTP 429, and api() in app.js used to throw away the body of
 * any non-2xx response, so the login screen said "Server error (429). Try
 * again in a moment." -- unhelpful, and the opposite of true, since trying
 * again in a moment is exactly what is refused. It must say how long to wait.
 *
 * Also checked from the person's side: a typo followed by the right password
 * signs in with no delay at all.
 *
 * And the wording, for ALL THREE limits (the per-account lock, the per-address
 * login limit, the per-address signup limit): a person who has been refused
 * must be told they have tried too often and should WAIT. If the message reads
 * like a wrong password ("Incorrect password", anything red and error-shaped)
 * they keep typing, which makes every one of these limits worse. So each is
 * checked for what it says, what it does not say, and that it is drawn as a
 * warning and not as an error. Set SCREENSHOT_DIR to keep a picture of each. */

const path = require('path');
const { chromium } = require('playwright');

const ENERGYTECH_API_ROOT = path.join(__dirname, '..', '..', 'energytech-api');
require('dotenv').config({ path: path.join(ENERGYTECH_API_ROOT, '.env') });

const {
  pool, resetDb, insertInstructor, insertIntake, insertGroup, insertTrainee,
} = require(path.join(ENERGYTECH_API_ROOT, 'tests', 'helpers', 'db'));
const { hashPasswordForStorage } = require(path.join(ENERGYTECH_API_ROOT, 'src', 'lib', 'passwords'));
const app = require(path.join(ENERGYTECH_API_ROOT, 'src', 'app'));
// The number of wrong passwords that are all checked before the first lock -- read from
// the backend's own policy so retuning it does not silently desynchronise this suite.
const FREE = require(path.join(ENERGYTECH_API_ROOT, 'src', 'lib', 'loginThrottle')).POLICY.freeAttempts;

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };

const GOOD = 'correct horse';

/* What a wrong-password refusal is worded with. A rate-limit message that contains
 * any of these will be read as one. */
const LOOKS_LIKE_A_MISTAKE = /password|incorrect|wrong|invalid|fail/i;
const shot = async (p, name) => {
  if (!process.env.SCREENSHOT_DIR) return;
  require('fs').mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
  await p.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, name + '.png'), fullPage: false });
};

(async () => {
  await resetDb();
  const pw = await hashPasswordForStorage(GOOD);
  const hash = { passwordHash: pw.passwordHash, passwordSalt: pw.passwordSalt, passwordAlgo: pw.passwordAlgo };
  await insertInstructor({ username: 'adnen', displayName: 'Adnen', role: 'admin', status: 'approved', ...hash });
  await insertInstructor({ username: 'sara', displayName: 'Sara', role: 'instructor', status: 'approved', ...hash });
  const intakeId = await insertIntake('JAN26');
  const groupId = await insertGroup(intakeId, 'G1');
  for (const id of ['ET3000', 'ET3001']) {
    await insertTrainee({ energytechId: id, name: `Trainee ${id}`, intakeId, groupId, accountStatus: 'active', ...hash });
  }

  const server = app.listen(0);
  const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch();
  const errs = [];

  async function newPage() {
    const p = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(BASE);
    return p;
  }
  // One login attempt through the real form; resolves once the status line has
  // stopped saying it is checking.
  async function attempt(p, { idSel, pwSel, btnSel, statusSel, id, password }) {
    await p.fill(idSel, id);
    await p.fill(pwSel, password);
    await p.click(btnSel);
    await p.waitForFunction((s) => !/Checking/.test(document.querySelector(s).textContent), statusSel, { timeout: 15000 });
    return (await p.textContent(statusSel)).replace(/\s+/g, ' ').trim();
  }
  const statusClass = (p, sel) => p.getAttribute(sel, 'class');

  console.log('\n=== 1. A trainee who keeps guessing is told how long to wait ===');
  {
    const p = await newPage();
    await p.click('#studentModeBtn');
    const f = { idSel: '#traineeLoginId', pwSel: '#traineeLoginPassword', btnSel: '#traineeLoginBtn', statusSel: '#traineeLoginStatus', id: 'ET3000' };
    let last;
    for (let i = 0; i < FREE; i++) last = await attempt(p, { ...f, password: 'wrong' });
    ok(/Incorrect password/.test(last), `the first ${FREE} wrong passwords are ordinary refusals`);
    const held = await attempt(p, { ...f, password: GOOD });
    ok(/You have tried too many times\. Please wait \d+ seconds? and try again/.test(held), `the next says how long to wait (got "${held}")`);
    ok(!/Server error/.test(held), 'and is not the generic "Server error"');
    ok(!LOOKS_LIKE_A_MISTAKE.test(held), 'and does not read like a wrong password, which would send them back to typing');
    ok(/warn/.test(await statusClass(p, f.statusSel)) && !/bad/.test(await statusClass(p, f.statusSel)),
      'and is drawn as a warning to wait, not as the red error a wrong password gets');
    await shot(p, '1-trainee-locked-account');
    ok(!(await p.isVisible('#traineeHomePanel')), 'and the right password did not get in while locked');
    await p.close();
  }

  console.log('\n=== 2. The same for an instructor ===');
  {
    const p = await newPage();
    await p.click('#teacherModeBtn');
    const f = { idSel: '#teacherLoginUsername', pwSel: '#teacherLoginPassword', btnSel: '#teacherLoginBtn', statusSel: '#teacherLoginStatus', id: 'adnen' };
    for (let i = 0; i < FREE; i++) await attempt(p, { ...f, password: 'wrong' });
    const held = await attempt(p, { ...f, password: GOOD });
    ok(/You have tried too many times\. Please wait \d+ seconds? and try again/.test(held), `the next says how long to wait (got "${held}")`);
    ok(!/Server error/.test(held), 'and is not the generic "Server error"');
    ok(!LOOKS_LIKE_A_MISTAKE.test(held), 'and does not read like a wrong password');
    ok(/warn/.test(await statusClass(p, f.statusSel)) && !/bad/.test(await statusClass(p, f.statusSel)), 'and is drawn as a warning');
    await shot(p, '2-instructor-locked-account');
    ok(!(await p.isVisible('#teacherInterface')), 'and the right password did not open the interface while locked');
    await p.close();
  }

  console.log('\n=== 3. A typo is not punished ===');
  {
    const p = await newPage();
    await p.click('#studentModeBtn');
    const f = { idSel: '#traineeLoginId', pwSel: '#traineeLoginPassword', btnSel: '#traineeLoginBtn', statusSel: '#traineeLoginStatus', id: 'ET3001' };
    const typo = await attempt(p, { ...f, password: 'corect horse' });
    ok(/Incorrect password/.test(typo), 'the typo is refused as an ordinary wrong password');
    ok(/bad/.test(await statusClass(p, f.statusSel)), 'and that one IS the red error, so the two look different');
    await shot(p, '0-wrong-password-for-comparison');
    await attempt(p, { ...f, password: GOOD });
    await p.waitForSelector('#traineeHomePanel:not([hidden])', { timeout: 10000 });
    ok(true, 'the very next attempt with the right password signs in, no waiting');
    await p.close();
  }

  /* The two per-address limits. They are skipped under NODE_ENV=test (the rest of the suite is far
   * denser than any real window), so switch them on for this section and put it back. The budget is
   * filled with cheap requests straight at the server -- from the same 127.0.0.1 the browser uses,
   * so they are the same "address" -- and then the browser makes the attempt a person would. */
  const { loginLimiter, signupLimiter, LOGIN_FAILURE_CEILING, SIGNUP_CEILING } =
    require(path.join(ENERGYTECH_API_ROOT, 'src', 'lib', 'rateLimit'));
  const apiUrl = BASE.replace('/index.html', '/api/call');
  const post = (body) => fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const resetAddress = async () => {
    for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1']) { await loginLimiter.resetKey(ip); await signupLimiter.resetKey(ip); }
  };

  console.log('\n=== 4. The per-address LOGIN limit: a trainee in a room that has tried too often ===');
  {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await resetAddress();
      for (let i = 0; i < LOGIN_FAILURE_CEILING; i++) await post({ action: 'auth_login', username: '', password: '' });
      const p = await newPage();
      await p.click('#studentModeBtn');
      const f = { idSel: '#traineeLoginId', pwSel: '#traineeLoginPassword', btnSel: '#traineeLoginBtn', statusSel: '#traineeLoginStatus', id: 'ET3001' };
      const held = await attempt(p, { ...f, password: GOOD });
      ok(/You have tried too many times from this network\. Please wait \d+ (second|minute|hour)s? and try again/.test(held), `says they have tried too often, from this network, and to wait (got "${held}")`);
      ok(/sooner will not work/.test(held), 'and that trying again sooner will not work');
      ok(!LOOKS_LIKE_A_MISTAKE.test(held), 'and does not read like a wrong password');
      ok(!/Server error/.test(held), 'and is not the generic "Server error"');
      ok(/warn/.test(await statusClass(p, f.statusSel)) && !/bad/.test(await statusClass(p, f.statusSel)), 'and is drawn as a warning');
      ok(!(await p.isVisible('#traineeHomePanel')), 'and nobody gets in from that address until it passes');
      await shot(p, '3-trainee-address-login-limit');
      await p.close();
    } finally { process.env.NODE_ENV = previous; await resetAddress(); }
  }

  console.log('\n=== 5. The per-address SIGNUP limit: a trainee creating an account from a room that has used it up ===');
  {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await resetAddress();
      for (let i = 0; i < SIGNUP_CEILING; i++) await post({ action: 'trainee_signup', energytechId: '', password: '' });
      const p = await newPage();
      await p.click('#studentModeBtn');
      await p.click('#toggleTraineeSignupBtn');
      await p.fill('#traineeSignupId', 'ET3001');
      await p.fill('#traineeSignupPassword', 'a-long-enough-password');
      await p.fill('#traineeSignupConfirm', 'a-long-enough-password');
      await p.click('#traineeSignupBtn');
      await p.waitForFunction(() => !/Creating your account/.test(document.getElementById('traineeSignupStatus').textContent), null, { timeout: 15000 });
      const text = (await p.textContent('#traineeSignupStatus')).replace(/\s+/g, ' ').trim();
      const cls = await p.getAttribute('#traineeSignupStatus', 'class');
      ok(/Too many sign-up attempts from this network\. Please wait \d+ (second|minute|hour)s? and try again/.test(text), `says too many attempts and to wait (got "${text}")`);
      ok(!LOOKS_LIKE_A_MISTAKE.test(text), 'and does not read like something they typed was wrong');
      ok(!/Server error/.test(text), 'and is not the generic "Server error"');
      ok(/warn/.test(cls) && !/bad/.test(cls), 'and is drawn as a warning');
      await shot(p, '4-trainee-address-signup-limit');
      await p.close();
    } finally { process.env.NODE_ENV = previous; await resetAddress(); }
  }

  console.log('\n=== 6. No page errors ===');
  ok(errs.length === 0, errs.length ? errs.join(' | ') : 'none');

  await browser.close();
  server.close();
  await pool.end();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
