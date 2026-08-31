/* What a trainee sees when they try to sit an exam twice, and the double-submit
 * fix. Both are about one sitting producing exactly one row. */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8902/energytech-mathquiz/index.html';

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const EXAM = { sessionCode: 'G1-9001', sessionName: 'Midterm exam', intake: 'JAN26', group: 'G1',
  mode: 'assessment', questionSet: 'Ch 1 & 2', questionSetKey: 'ch12:original_pdf', seed: 'S',
  questionCount: 4, orderMode: 'original', showOriginalNumbers: true, requireAll: true,
  allowWalkIn: false, shuffleEachLaunch: true };
const PRACTICE = Object.assign({}, EXAM, { sessionCode: 'G1-7001', sessionName: 'Practice', mode: 'practice', shuffleEachLaunch: false });

// The mock keeps a real sitting count, like the backend does.
let sat = 0, allowed = 1, offline = false;
let posted = [];

function route(p) {
  return p.route(/script\.google\.com/, r => {
    const req = r.request();
    if (offline) return r.abort();
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      if (body.type === 'quiz_attempt') {
        // The real backend refuses a second sitting. So does this.
        if (body.quiz.mode === 'assessment' && sat >= allowed) {
          return r.fulfill({ status: 200, body: JSON.stringify({ ok: false, error: 'already submitted' }) });
        }
        posted.push(body);
        if (body.quiz.mode === 'assessment') sat++;
      }
      return r.fulfill({ status: 200, body: 'ok' });
    }
    const q = Object.fromEntries(new URL(req.url()).searchParams);
    let d = { ok: true, message: 'ok' };
    if (q.action === 'session') {
      const s = q.code === 'G1-7001' ? PRACTICE : EXAM;
      d = { ok: true, session: s,
        sitting: q.token ? { sat, allowed, maySit: s.mode === 'assessment' ? sat < allowed : true } : null };
    }
    if (q.action === 'trainee_login') d = { ok: true, token: 'TTOK',
      trainee: { energytechId: 'ET1000', name: 'Mohammed', intake: 'JAN26', group: 'G1', accountStatus: 'active' } };
    if (q.action === 'my_history') d = { ok: true, trainee: { energytechId: 'ET1000', name: 'Mohammed' }, attempts: [], lessons: [] };
    return r.fulfill({ status: 200, contentType: 'application/javascript', body: q.callback + '(' + JSON.stringify(d) + ');' });
  });
}

/* Reload and get back to the trainee's home screen. The login survives in local
 * storage, so after the first time there is no form to fill in. */
async function login(p) {
  await p.goto(BASE);
  await p.click('#studentModeBtn');
  if (await p.isVisible('#traineeLoginId')) {
    await p.fill('#traineeLoginId', 'ET1000');
    await p.fill('#traineeLoginPassword', 'x');
    await p.click('#traineeLoginBtn');
  }
  await p.waitForSelector('#traineeHomePanel:not([hidden])');
}

async function load(p, code) {
  await p.fill('#studentSessionCode', code);
  await p.click('#loadTraineeSessionBtn');
  await p.waitForTimeout(600);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  // The offline section aborts requests on purpose, so a failed fetch is not a
  // page error worth reporting -- but anything the page itself throws is.
  p.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) errs.push(m.text());
  });
  await route(p);
  await login(p);

  console.log('\n=== 1. The first sitting works ===');
  await load(p, 'G1-9001');
  ok(Boolean(await p.$('.question-card')), 'the paper is drawn');
  await p.evaluate(() => currentQuiz.forEach((q, i) => {
    const el = document.querySelector(`#card-${i} input[value="${q.answer}"]`);
    if (el) el.click();
  }));
  posted = [];
  await p.click('#studentSubmitBtn');
  await p.waitForTimeout(500);
  eq(posted.length, 1, 'one attempt posted');

  console.log('\n=== 2. Pressing Submit again sends nothing more ===');
  // The submission is opaque, so a trainee who is unsure will press it again.
  await p.click('#studentSubmitBtn');
  await p.waitForTimeout(400);
  await p.click('#studentSubmitBtn');
  await p.waitForTimeout(400);
  eq(posted.length, 1, 'still one attempt, however many times it is pressed');
  ok(/already submitted/i.test(await p.textContent('#studentFeedback')),
    'and the trainee is told it already went through');

  console.log('\n=== 3. Entering the code again refuses, without drawing a paper ===');
  await login(p);
  await load(p, 'G1-9001');
  const status = await p.textContent('#studentStatus');
  ok(/already sat this exam/i.test(status), `the trainee is told (got "${status.trim().slice(0, 80)}")`);
  ok(/ask your instructor/i.test(status), 'and pointed at the way out');
  ok(!(await p.$('.question-card')), 'no paper is drawn -- seeing the questions again is itself worth something');
  eq(posted.length, 1, 'and nothing more was posted');

  console.log('\n=== 4. A practice quiz is not limited ===');
  await load(p, 'G1-7001');
  ok(Boolean(await p.$('.question-card')), 'the practice paper loads');
  await load(p, 'G1-7001');
  ok(Boolean(await p.$('.question-card')), 'and loads again, as often as they like');

  console.log('\n=== 5. After the instructor allows another sitting ===');
  allowed = 2;
  await login(p);
  await load(p, 'G1-9001');
  ok(Boolean(await p.$('.question-card')), 'the exam paper is drawn again');
  await p.evaluate(() => currentQuiz.forEach((q, i) => {
    const el = document.querySelector(`#card-${i} input[value="${q.answer}"]`);
    if (el) el.click();
  }));
  await p.click('#studentSubmitBtn');
  await p.waitForTimeout(500);
  eq(posted.length, 2, 'the second sitting is recorded');
  await login(p);
  await load(p, 'G1-9001');
  ok(!(await p.$('.question-card')), 'and the door closes behind them again');

  console.log('\n=== 6. With no backend, an exam does not start ===');
  // Guessing is the one thing not to do: without the server there is no way to
  // know whether they have already sat it.
  offline = true;
  await load(p, 'G1-9001');
  const off = await p.textContent('#studentStatus');
  ok(!(await p.$('.question-card')), 'no paper is drawn');
  ok(/cannot reach the server|cannot confirm/i.test(off), `and it says why (got "${off.trim().slice(0, 70)}")`);
  ok(!/session not found/i.test(off), 'and does not blame the code, which was fine');
  offline = false;

  console.log('\n=== 7. No page errors ===');
  ok(errs.length === 0, errs.length ? errs.join(' | ') : 'none');

  await browser.close();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})();
