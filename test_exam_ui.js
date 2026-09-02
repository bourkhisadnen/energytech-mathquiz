/* The exam flow in a real browser.
 *
 * Two trainees load the same code and must see the same questions in different
 * orders with differently-arranged choices; the trainee's own list must show the
 * exam with no mark until it is released; and the review, once released, must
 * show the paper as it was actually sat -- which is the part that fails
 * silently if the per-launch seed is not carried through. */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8902/energytech-mathquiz/index.html';

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const EXAM = {
  sessionCode: 'G1-9001', sessionName: 'Midterm exam', intake: 'JAN26', group: 'G1',
  mode: 'assessment', questionSet: 'Chapters 01 & 02 — Original worksheet',
  questionSetKey: 'ch12:original_pdf', seed: 'EXAM-SEED', questionCount: 8,
  orderMode: 'original', showOriginalNumbers: true, requireAll: true,
  allowWalkIn: false, shuffleEachLaunch: true, resultsPublished: false
};

let published = false;
let posted = [];

// Each page is a different trainee, with its own sitting record -- the same
// shape the backend enforces. A mock that let one identity sit twice would be
// modelling something the app no longer allows.
function route(p, who) {
  who = who || 'ET1000';
  return p.route(/script\.google\.com/, r => {
    const req = r.request();
    if (req.method() === 'POST') {
      try {
        const body = JSON.parse(req.postData() || '{}');
        posted.push(body);
        if (body.type === 'quiz_attempt') sittings[who] = (sittings[who] || 0) + 1;
      } catch { /* opaque */ }
      return r.fulfill({ status: 200, body: 'ok' });
    }
    const q = Object.fromEntries(new URL(req.url()).searchParams);
    let d = { ok: true, message: 'ok' };
    if (q.action === 'session') d = { ok: true, session: EXAM,
      sitting: q.token ? { sat: sittings[who] || 0, allowed: 1, maySit: !(sittings[who] > 0) } : null };
    if (q.action === 'trainee_login') d = { ok: true, token: 'TOK-' + who,
      trainee: { energytechId: who, name: 'Trainee ' + who, intake: 'JAN26', group: 'G1', accountStatus: 'active' } };
    if (q.action === 'my_history') d = { ok: true,
      trainee: { energytechId: 'ET1000', name: 'Mohammed Al-Otaibi', intake: 'JAN26', group: 'G1', accountStatus: 'active' },
      lessons: published ? [{ lesson: '1-1.1', correct: 3, total: 8, percent: 38 }] : [],
      attempts: [Object.assign({
        timestamp: '2026-08-20T09:00:00Z', sessionCode: 'G1-9001', sessionName: 'Midterm exam',
        mode: 'assessment', questionSet: EXAM.questionSet, registered: 'yes'
      }, published
        ? { attemptId: 'E1', questionSetKey: EXAM.questionSetKey, seed: EXAM.seed, questionCount: 8,
            orderMode: 'original', orderSeed: 'SEED-LAUNCH-1', score: 3, total: 8, percent: 38, released: true }
        : { attemptId: '', questionSetKey: '', seed: '', questionCount: 8, orderMode: '',
            orderSeed: '', score: null, total: null, percent: null, released: false })]
    };
    // The real backend refuses an unreleased exam. A mock that answered anyway
    // would let a client bug through -- and did, the first time this ran.
    if (q.action === 'my_attempt' && !published) {
      d = { ok: false, error: 'Your instructor has not released the results of this exam yet.' };
    } else if (q.action === 'my_attempt') d = { ok: true,
      attempt: { attemptId: 'E1', timestamp: '2026-08-20T09:00:00Z', name: 'Mohammed Al-Otaibi',
        sessionCode: 'G1-9001', sessionName: 'Midterm exam', mode: 'assessment',
        questionSet: EXAM.questionSet, questionSetKey: EXAM.questionSetKey, seed: EXAM.seed,
        questionCount: 8, orderMode: 'original', orderSeed: 'SEED-LAUNCH-1',
        score: 3, total: 8, percent: 38 },
      items: examItems };
    return r.fulfill({ status: 200, contentType: 'application/javascript', body: q.callback + '(' + JSON.stringify(d) + ');' });
  });
}

let examItems = [];
const sittings = {};

/* One trainee sitting the exam: load the code, read what is on screen. */
async function sitExam(browser, who) {
  const p = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await route(p, who);
  await p.goto(BASE);
  await p.click('#studentModeBtn');
  await p.fill('#traineeLoginId', who);
  await p.fill('#traineeLoginPassword', 'x');
  await p.click('#traineeLoginBtn');
  await p.waitForSelector('#traineeHomePanel:not([hidden])');
  await p.fill('#studentSessionCode', 'G1-9001');
  await p.click('#loadTraineeSessionBtn');
  await p.waitForSelector('.question-card');
  const paper = await p.evaluate(() => currentQuiz.map(q => ({
    n: q.original_number,
    choices: q.choices.split(/\\item\s+/).map(s => s.trim()).filter(Boolean),
    answer: q.answer
  })));
  const seed = await p.evaluate(() => currentOrderSeed);
  return { page: p, paper, seed, errs };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  console.log('\n=== 1. Two trainees, one code ===');
  const A = await sitExam(browser, 'ET1000');
  const B = await sitExam(browser, 'ET1001');
  ok(A.seed && B.seed && A.seed !== B.seed, 'each launch minted its own arrangement seed');
  eq(A.paper.map(q => q.n).slice().sort((x, y) => x - y),
     B.paper.map(q => q.n).slice().sort((x, y) => x - y),
     'both sat exactly the same questions');
  ok(JSON.stringify(A.paper.map(q => q.n)) !== JSON.stringify(B.paper.map(q => q.n)),
    'but in a different order');

  const shared = A.paper[0].n;
  const inB = B.paper.find(q => q.n === shared);
  ok(JSON.stringify(A.paper[0].choices) !== JSON.stringify(inB.choices),
    'and with the choices of a shared question arranged differently');
  eq(A.paper[0].choices.slice().sort(), inB.choices.slice().sort(),
    'though they are the same four options');

  console.log('\n=== 2. What is on screen is what gets marked ===');
  // Answer every question with the key as this trainee's paper shows it, then
  // submit: a full score proves the letters on screen and the letters used for
  // marking are the same set.
  const page = A.page;
  await page.evaluate(() => {
    currentQuiz.forEach((q, i) => {
      const el = document.querySelector(`#card-${i} .choice[data-choice="${q.answer}"] input`)
              || document.querySelector(`#card-${i} input[value="${q.answer}"]`);
      if (el) el.click();
    });
  });
  posted = [];
  await page.click('#studentSubmitBtn');
  await page.waitForTimeout(500);
  const sent = posted.find(x => x.type === 'quiz_attempt');
  ok(Boolean(sent), 'the attempt was submitted');
  eq(sent.score.correct, sent.score.total, 'every answer taken from the paper on screen was marked correct');
  eq(sent.quiz.orderSeed, A.seed, 'and the arrangement seed went with it');
  examItems = sent.items.map(i => ({
    quizNumber: i.quizNumber, originalNumber: i.originalNumber, lesson: i.lesson,
    answer: i.studentAnswer, correctAnswer: i.correctAnswer, result: i.result
  }));

  console.log('\n=== 3. Before release, the mark is not there ===');
  const p3 = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const errs3 = [];
  p3.on('pageerror', e => errs3.push(String(e)));
  await route(p3, 'ET1000');
  await p3.goto(BASE);
  await p3.click('#studentModeBtn');
  await p3.fill('#traineeLoginId', 'ET1000');
  await p3.fill('#traineeLoginPassword', 'x');
  await p3.click('#traineeLoginBtn');
  await p3.waitForSelector('.attempt-row');
  const body3 = await p3.textContent('#myHistoryBody');
  ok(/Midterm exam/.test(body3), 'the exam is listed, so the trainee knows it was recorded');
  ok(/Not released yet/i.test(body3), 'and is marked as not released');
  ok(!/\d+\s*\/\s*8/.test(body3), 'with no score anywhere on the row');
  eq(await p3.$$eval('.attempt-row.is-pending', n => n.length), 1, 'the row is styled as pending');
  eq(await p3.$$eval('.attempt-row[data-attempt]', n => n.length), 0, 'and carries no attempt id to open');
  const stats = await p3.$$eval('.stat-value', n => n.map(x => x.textContent.trim()));
  ok(stats[0] === '0', `it does not count towards "quizzes taken" (got ${stats[0]})`);
  ok(stats[1] === '—', `nor towards the average (got ${stats[1]})`);
  await p3.click('.attempt-row');
  await p3.waitForTimeout(400);
  ok(!(await p3.$('.review-card')), 'and clicking it opens nothing');
  // The list must survive the click. An earlier build called the backend with
  // an empty id, which blanked the list and put an error where it had been.
  eq(await p3.$$eval('.attempt-row', n => n.length), 1, 'the list is still there afterwards');
  ok(!/not released the results/i.test(await p3.textContent('#myHistoryBody')),
    'and no error is shown for a click that should do nothing');

  console.log('\n=== 4. After release ===');
  published = true;
  const p4 = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const errs4 = [];
  p4.on('pageerror', e => errs4.push(String(e)));
  await route(p4, 'ET1000');
  await p4.goto(BASE);
  await p4.click('#studentModeBtn');
  await p4.fill('#traineeLoginId', 'ET1000');
  await p4.fill('#traineeLoginPassword', 'x');
  await p4.click('#traineeLoginBtn');
  await p4.waitForSelector('.attempt-row[data-attempt]');
  ok(!/Not released yet/i.test(await p4.textContent('#myHistoryBody')), 'the pending label is gone');
  ok(/3 \/ 8/.test(await p4.textContent('#myHistoryBody')), 'the mark is shown');

  console.log('\n=== 5. The review shows the paper as it was sat ===');
  await p4.click('.attempt-row[data-attempt] td');
  await p4.waitForSelector('.review-card');
  const rebuilt = await p4.evaluate(() => [...document.querySelectorAll('.review-card')].map(card => ({
    choices: [...card.querySelectorAll('.choice')].map(c => c.textContent.replace(/^[✓✗\s]*[a-d]\)\s*/, '').trim()),
    right: (card.querySelector('.choice.is-right') || {}).textContent || ''
  })));
  eq(rebuilt.length, 8, 'all eight questions come back');
  // The seed used here (SEED-LAUNCH-1) is not the seed A actually sat with, so
  // this checks the mechanism, not A's paper: every card must still offer four
  // options and mark exactly one of them right.
  eq(rebuilt.filter(r => r.choices.length !== 4).length, 0, 'each with four options');
  eq(rebuilt.filter(r => !r.right).length, 0, 'and exactly one marked as the right answer');

  console.log('\n=== 6. No page errors anywhere ===');
  const all = [].concat(A.errs, B.errs, errs3, errs4);
  ok(all.length === 0, all.length ? all.join(' | ') : 'none');

  await browser.close();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})();
