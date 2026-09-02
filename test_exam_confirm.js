/* An exam submission the trainee is told about honestly.
 *
 * The POST is opaque (no-cors), so "submitted successfully" is a guess. For a
 * practice quiz a wrong guess costs nothing. For an exam it is the worst
 * outcome in the app: a trainee walks away believing their paper is in, and
 * nobody finds out until the marks are released.
 *
 * So after an exam the app reads the record back. This checks it says the right
 * thing in all three cases -- recorded, not recorded, and cannot tell. */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8902/energytech-mathquiz/index.html';

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };

const EXAM = { sessionCode: 'G1-9001', sessionName: 'Midterm exam', intake: 'JAN26', group: 'G1',
  mode: 'assessment', questionSet: 'Chapters 01 & 02', questionSetKey: 'ch12:original_pdf',
  seed: 'S', questionCount: 4, orderMode: 'original', showOriginalNumbers: true,
  requireAll: true, allowWalkIn: false, shuffleEachLaunch: true };

/* `behaviour` decides what the backend pretends to do with the submission:
 *   'records'  -- the write lands, so the sitting is used up
 *   'silent'   -- the POST looks fine and nothing is written
 *   'offline'  -- the read-back cannot be made at all
 */
async function sitAndSubmit(browser, behaviour) {
  const p = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  let sat = 0, submitted = false;

  await p.route(/script\.google\.com/, r => {
    const req = r.request();
    if (req.method() === 'POST') {
      submitted = true;
      if (behaviour === 'records') sat++;
      return r.fulfill({ status: 200, body: 'ok' });
    }
    const q = Object.fromEntries(new URL(req.url()).searchParams);
    // Going dark only AFTER the paper has been submitted, so the exam can still
    // be started -- an exam refuses to start without the backend.
    if (behaviour === 'offline' && submitted) return r.abort();
    let d = { ok: true, message: 'ok' };
    if (q.action === 'session') d = { ok: true, session: EXAM,
      sitting: q.token ? { sat, allowed: 1, maySit: sat < 1 } : null };
    if (q.action === 'trainee_login') d = { ok: true, token: 'TTOK',
      trainee: { energytechId: 'ET1000', name: 'Mohammed', intake: 'JAN26', group: 'G1', accountStatus: 'active' } };
    if (q.action === 'my_history') d = { ok: true, trainee: {}, attempts: [], lessons: [] };
    return r.fulfill({ status: 200, contentType: 'application/javascript', body: q.callback + '(' + JSON.stringify(d) + ');' });
  });

  await p.goto(BASE);
  await p.click('#studentModeBtn');
  await p.fill('#traineeLoginId', 'ET1000');
  await p.fill('#traineeLoginPassword', 'x');
  await p.click('#traineeLoginBtn');
  await p.waitForSelector('#traineeHomePanel:not([hidden])');
  await p.fill('#studentSessionCode', 'G1-9001');
  await p.click('#loadTraineeSessionBtn');
  await p.waitForSelector('.question-card');
  await p.evaluate(() => currentQuiz.forEach((q, i) => {
    const el = document.querySelector(`#card-${i} input[value="${q.answer}"]`);
    if (el) el.click();
  }));
  await p.click('#studentSubmitBtn');
  await p.waitForTimeout(3400);            // the read-back waits ~1.8s first
  const out = {
    cls: await p.getAttribute('#studentFeedback', 'class'),
    text: (await p.textContent('#studentFeedback')).replace(/\s+/g, ' ').trim(),
    errs: errs.filter(e => !/Failed to load resource|ERR_FAILED|ERR_ABORTED/.test(e))
  };
  await p.close();
  return out;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  console.log('\n=== 1. The write landed ===');
  let r = await sitAndSubmit(browser, 'records');
  ok(/Recorded\./.test(r.text), `it says so, having checked (got "${r.text.slice(0, 80)}")`);
  ok(/My results/.test(r.text), 'and where the mark will appear');
  ok(!/may not have been recorded/i.test(r.text), 'with no warning');
  ok(!/\bbad\b/.test(r.cls || ''), 'and the panel is not an error');

  console.log('\n=== 2. The write silently did not land ===');
  // The browser saw a perfectly good response. Only reading the record back
  // tells the difference, and this is the case that must never be reported as
  // success.
  r = await sitAndSubmit(browser, 'silent');
  ok(/may not have been recorded/i.test(r.text), `the trainee is warned (got "${r.text.slice(0, 80)}")`);
  ok(/tell your instructor now/i.test(r.text), 'and told to raise it immediately');
  ok(/\bbad\b/.test(r.cls || ''), 'shown as an error, not a note');
  ok(!/Recorded\./.test(r.text), 'and it does not also claim success');

  console.log('\n=== 3. The check could not be made ===');
  r = await sitAndSubmit(browser, 'offline');
  ok(/could not confirm/i.test(r.text), `it says the check failed (got "${r.text.slice(0, 90)}")`);
  ok(!/may not have been recorded/i.test(r.text), 'without claiming the paper was lost');
  ok(!/Recorded\./.test(r.text), 'and without claiming it was saved');

  console.log('\n=== 4. No page errors in any of the three ===');
  ok(r.errs.length === 0, r.errs.length ? r.errs.join(' | ') : 'none');

  await browser.close();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})();
