/* The explanation video on the question it belongs to.
 *
 * The list of wrong questions under the paper has always carried the links.
 * This is the same link inside the card, so a trainee reading the question they
 * got wrong can watch the explanation without scrolling to the foot of a
 * hundred-question paper and matching Q-numbers by eye.
 *
 * Two things have to stay true, and both are the sort that break quietly: the
 * link on a card must be the link for THAT question, and no video may appear on
 * an exam, where the marking itself is withheld. */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8902/energytech-mathquiz/index.html';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

/* The whole Chapters 01 & 02 original paper in its printed order, so question N
 * on screen is original question N -- and so the seven questions that carry no
 * QR code (Q58, Q81-83, Q88-90) are on the paper and can be got wrong. */
const COMMON = {
  intake: 'JAN26', group: 'G1', questionSet: 'Chapters 01 & 02',
  questionSetKey: 'ch12:original_pdf', seed: 'S', questionCount: 114,
  orderMode: 'original', showOriginalNumbers: true, requireAll: false,
  allowWalkIn: false
};
const PRACTICE = Object.assign({ sessionCode: 'G1-7001', sessionName: 'Week 3 practice',
  mode: 'practice', shuffleEachLaunch: false }, COMMON);
const EXAM = Object.assign({ sessionCode: 'G1-9001', sessionName: 'Midterm exam',
  mode: 'assessment', shuffleEachLaunch: false }, COMMON);

const NO_VIDEO = [58, 81, 82, 83, 88, 89, 90];   // no QR code on the worksheet

/* The paper the trainee gets back once the instructor releases the exam. Asking
 * for the whole set in its printed order makes it independent of the seed:
 * question N is original question N, so the answers can be worked out here
 * without reimplementing the draw. */
const APP_DIR = '/tmp/energytech_app/energytech_quiz_app_session_sync_fixed';
global.window = {};
require(APP_DIR + '/question_bank.js');
const CH12 = window.QUESTION_BANK_SETS.original_pdf.questions
  .slice().sort((a, b) => a.original_number - b.original_number);

const REVIEW_WRONG = [1, 2, 3].concat(NO_VIDEO);
const REVIEW_ITEMS = CH12.map((q, i) => {
  const wrong = REVIEW_WRONG.indexOf(q.original_number) !== -1;
  return {
    quizNumber: i + 1, originalNumber: q.original_number, lesson: q.lesson,
    correctAnswer: q.answer,
    answer: wrong ? ['a', 'b', 'c', 'd'].find(L => L !== q.answer) : q.answer,
    result: wrong ? 'wrong' : 'correct'
  };
});
const REVIEW_ATTEMPT = {
  attemptId: 'E1', timestamp: '2026-09-01T09:00:00Z', name: 'Mohammed Al-Otaibi',
  energytechId: 'ET1000', group: 'G1', sessionCode: 'G1-9001', sessionName: 'Midterm exam',
  mode: 'assessment', questionSet: 'Chapters 01 & 02', questionSetKey: 'ch12:original_pdf',
  seed: 'S', questionCount: 114, orderMode: 'original', orderSeed: '',
  score: 104, total: 114, percent: 91
};

/* The instructor has not released the exam until this is flipped, and until
 * then the backend refuses the attempt outright. */
let released = false;

let sat = 0;

function route(p) {
  return p.route(/script\.google\.com/, r => {
    const req = r.request();
    if (req.method() === 'POST') {
      try {
        const b = JSON.parse(req.postData() || '{}');
        if (b.type === 'quiz_attempt' && b.quiz.mode === 'assessment') sat++;
      } catch { /* opaque */ }
      return r.fulfill({ status: 200, body: 'ok' });
    }
    const q = Object.fromEntries(new URL(req.url()).searchParams);
    let d = { ok: true, message: 'ok' };
    if (q.action === 'session') {
      // An instructor-created code is echoed back so the save verifies at once
      // instead of retrying for five seconds.
      const s = q.code === 'G1-9001' ? EXAM
        : q.code === 'G1-7001' ? PRACTICE
        : Object.assign({}, PRACTICE, { sessionCode: q.code });
      d = { ok: true, session: s,
        sitting: q.token ? { sat, allowed: 1, maySit: s.mode === 'assessment' ? sat < 1 : true } : null };
    }
    if (q.action === 'trainee_login') d = { ok: true, token: 'TTOK',
      trainee: { energytechId: 'ET1000', name: 'Mohammed Al-Otaibi', intake: 'JAN26', group: 'G1', accountStatus: 'active' } };
    if (q.action === 'auth_login') d = { ok: true, token: 'ADMTOK', username: 'adnen',
      displayName: 'Adnane Khalifa', role: 'admin' };
    if (q.action === 'admin_list_instructors') d = { ok: true, instructors: [] };
    if (q.action === 'roster_list') d = { ok: true, intakes: [{ label: 'JAN26', status: 'active' }],
      groups: [{ intake: 'JAN26', name: 'G1', trainees: 4, withAccount: 4 }] };
    if (q.action === 'trainee_list') d = { ok: true, trainees: [] };
    if (q.action === 'session_list') d = { ok: true, sessions: [] };
    if (q.action === 'my_history') d = { ok: true,
      trainee: { energytechId: 'ET1000', name: 'Mohammed Al-Otaibi' }, lessons: [],
      attempts: [Object.assign({ registered: 'yes', released: released },
        released ? REVIEW_ATTEMPT
                 : { attemptId: '', timestamp: REVIEW_ATTEMPT.timestamp,
                     sessionCode: 'G1-9001', sessionName: 'Midterm exam', mode: 'assessment',
                     questionSet: 'Chapters 01 & 02', questionSetKey: '', seed: '',
                     questionCount: 114, orderMode: '', orderSeed: '',
                     score: null, total: null, percent: null })] };
    // The real backend refuses an attempt whose exam is still held back, and so
    // does this: a mock that answered anyway would let a client bug through.
    if (q.action === 'my_attempt') {
      d = released
        ? { ok: true, attempt: REVIEW_ATTEMPT, items: REVIEW_ITEMS }
        : { ok: false, error: 'Your instructor has not released the results of this exam yet.' };
    }
    return r.fulfill({ status: 200, contentType: 'application/javascript',
      body: q.callback + '(' + JSON.stringify(d) + ');' });
  });
}

/* Answer every question, deliberately wrong on the ones named. */
const answer = (p, wrongOriginals) => p.evaluate(wrong => {
  currentQuiz.forEach((q, i) => {
    const pick = wrong.indexOf(q.original_number) !== -1
      ? ['a', 'b', 'c', 'd'].find(L => L !== q.answer)
      : q.answer;
    const el = document.querySelector(`#card-${i} input[value="${pick}"]`);
    if (el) el.click();
  });
}, wrongOriginals);

/* Every card that carries a video link, as { originalNumber: href }. */
const cardVideos = p => p.evaluate(() => {
  const out = {};
  document.querySelectorAll('#studentQuizArea .question-card').forEach(card => {
    const a = card.querySelector('.card-video');
    if (!a) return;
    const idx = Number(card.id.replace('card-', ''));
    out[currentQuiz[idx].original_number] = a.getAttribute('href');
  });
  return out;
});

async function load(p, code) {
  await p.fill('#studentSessionCode', code);
  await p.click('#loadTraineeSessionBtn');
  await p.waitForTimeout(700);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const p = await browser.newPage({ viewport: { width: 1100, height: 1200 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await route(p);

  await p.goto(BASE);
  await p.click('#studentModeBtn');
  await p.fill('#traineeLoginId', 'ET1000');
  await p.fill('#traineeLoginPassword', 'x');
  await p.click('#traineeLoginBtn');
  await p.waitForSelector('#traineeHomePanel:not([hidden])');

  console.log('\n=== 1. Nothing before the paper is marked ===');
  await load(p, 'G1-7001');
  await p.waitForSelector('.question-card');
  eq(await p.evaluate(() => currentQuiz.length), 114, 'the whole paper is drawn');
  eq(await p.evaluate(() => currentQuiz.map(q => q.original_number).join() ===
       currentQuiz.map((_, i) => i + 1).join()), true, 'in its printed order');
  eq(await p.$$eval('.card-video', n => n.length), 0,
    'no video is on any card while the paper is still being answered');

  console.log('\n=== 2. Submitting puts the video on the questions they missed ===');
  // Three ordinary wrong answers, plus every question that has no QR code.
  const WRONG = [1, 2, 3].concat(NO_VIDEO);
  await answer(p, WRONG);
  await p.click('#studentSubmitBtn');
  await p.waitForSelector('.question-card.flag-wrong');
  await p.waitForTimeout(400);
  const onCards = await cardVideos(p);
  eq(Object.keys(onCards).map(Number).sort((a, b) => a - b), [1, 2, 3],
    'a link on each wrong question that has a video, and on no other');
  eq(await p.$$eval('.question-card.flag-wrong', n => n.length), WRONG.length,
    'all ten wrong questions are still marked wrong');

  console.log('\n=== 3. The link on a card is that question\'s own video ===');
  // Not the first link, not the one below it: the card and the bank must agree.
  const fromBank = await p.evaluate(nums => {
    const out = {};
    nums.forEach(n => { out[n] = (window.EXPLANATION_VIDEO_LINKS.ch12 || {})[String(n)]; });
    return out;
  }, [1, 2, 3]);
  eq(onCards, fromBank, 'each href is the bank link for that original question number');
  ok(Object.values(onCards).every(u => /^https:\/\/www\.youtube\.com\//.test(u)),
    'and they are real YouTube links');
  eq(await p.$$eval('.card-video', a => a.map(x => x.target + '|' + x.rel)),
    ['_blank|noopener noreferrer', '_blank|noopener noreferrer', '_blank|noopener noreferrer'],
    'each opens in a new tab without handing the opener over');

  console.log('\n=== 4. It is the same link the list underneath gives ===');
  // Two routes to the same video. If they ever disagree, one of them is wrong.
  const fromList = await p.evaluate(() => {
    const out = {};
    document.querySelectorAll('#studentFeedback .video-pill').forEach(a => {
      const m = a.textContent.match(/Original Q(\d+)/);
      if (m) out[Number(m[1])] = a.getAttribute('href');
    });
    return out;
  });
  eq(fromList, onCards, 'the list and the cards point at exactly the same videos');

  console.log('\n=== 5. A question with no video says nothing on the card ===');
  // Seven of the wrong answers have no QR code on the worksheet. The list still
  // names them, so the trainee is not left wondering -- the card just stays
  // clean rather than carrying a dead "no video" notice.
  const noVideoCards = await p.evaluate(nums => nums.map(n => {
    const idx = currentQuiz.findIndex(q => q.original_number === n);
    const card = document.getElementById('card-' + idx);
    return { n, wrong: card.classList.contains('flag-wrong'), hasLink: Boolean(card.querySelector('.card-video')) };
  }), NO_VIDEO);
  ok(noVideoCards.every(c => c.wrong), 'they are marked wrong');
  ok(noVideoCards.every(c => !c.hasLink), 'and carry no link, because there is no video to open');
  eq(await p.$$eval('#studentFeedback .no-video-pill', n => n.length), NO_VIDEO.length,
    'while the list still accounts for every one of them');

  console.log('\n=== 6. Right answers get nothing ===');
  const onCorrect = await p.evaluate(() => {
    let n = 0;
    document.querySelectorAll('.question-card.flag-correct').forEach(c => {
      if (c.querySelector('.card-video')) n++;
    });
    return n;
  });
  eq(onCorrect, 0, 'no video on a question they got right');

  console.log('\n=== 7. Marking twice does not stack them up ===');
  await p.evaluate(() => calculateScore({ target: 'student', requireAll: false, reveal: true }));
  await p.evaluate(() => calculateScore({ target: 'student', requireAll: false, reveal: true }));
  await p.waitForTimeout(200);
  eq(await p.$$eval('.card-video', n => n.length), 3, 'still one link per wrong question');

  console.log('\n=== 8. An unanswered question is not a wrong one ===');
  await p.evaluate(() => {
    document.querySelectorAll('#card-0 input[type=radio]').forEach(el => { el.checked = false; });
    calculateScore({ target: 'student', requireAll: false, reveal: true });
  });
  await p.waitForTimeout(200);
  const q1 = await p.evaluate(() => {
    const c = document.getElementById('card-0');
    return { unanswered: c.classList.contains('flag-unanswered'), hasLink: Boolean(c.querySelector('.card-video')) };
  });
  ok(q1.unanswered, 'Q1 is now flagged as unanswered');
  ok(!q1.hasLink, 'and its video is taken away with the wrong flag');

  console.log('\n=== 9. Clearing the answers clears the videos ===');
  // A cleared paper is an unmarked paper. Leaving the links behind would say
  // which questions were wrong just as plainly as the red borders would.
  await p.evaluate(() => clearAnswers('student'));
  await p.waitForTimeout(200);
  eq(await p.$$eval('.card-video', n => n.length), 0, 'every link is gone');
  eq(await p.$$eval('.question-card.flag-wrong', n => n.length), 0, 'along with the marking');

  console.log('\n=== 10. An exam gives nothing away ===');
  // The marking is withheld on an exam, and the video is part of the marking:
  // it names the method for a question the trainee is being scored on.
  await load(p, 'G1-9001');
  await p.waitForSelector('.question-card');
  await answer(p, [1, 2, 3]);
  await p.click('#studentSubmitBtn');
  await p.waitForTimeout(1200);
  eq(await p.$$eval('.card-video', n => n.length), 0, 'no video on any card after an exam is handed in');
  const fb = (await p.textContent('#studentFeedback')).replace(/\s+/g, ' ');
  ok(!/youtube/i.test(fb), 'and none in the feedback either');
  ok(/submitted/i.test(fb), 'though the exam was submitted');

  console.log('\n=== 11. Held back, there is nothing to open ===');
  // Before the instructor releases the exam the row carries no mark and no id,
  // so there is no paper to review and no video to reach.
  await p.goto(BASE);
  await p.click('#studentModeBtn');
  await p.waitForSelector('#traineeHomePanel:not([hidden])');
  await p.waitForSelector('#myHistoryBody .history-table');
  ok(Boolean(await p.$('#myHistoryBody .pending-tag')), 'the exam is listed as not released yet');
  eq(await p.$$eval('#myHistoryBody .attempt-row[data-attempt]', n => n.length), 0,
    'and the row cannot be opened at all');

  console.log('\n=== 12. Once released, the review carries the videos ===');
  released = true;
  await p.click('#myHistoryRefreshBtn');
  await p.waitForSelector('#myHistoryBody .attempt-row[data-attempt]');
  await p.click('#myHistoryBody .attempt-row[data-attempt]');
  await p.waitForSelector('.review-card');
  eq(await p.$$eval('.review-card', n => n.length), 114, 'every question of the paper is shown back');
  eq(await p.$$eval('.review-card.wrong', n => n.length), REVIEW_WRONG.length,
    'with the ones they got wrong marked as such');

  const reviewLinks = await p.evaluate(() => {
    const out = {};
    document.querySelectorAll('.review-card').forEach(card => {
      const a = card.querySelector('.card-video');
      if (!a) return;
      const m = card.textContent.match(/Original Q(\d+)/);
      if (m) out[Number(m[1])] = a.getAttribute('href');
    });
    return out;
  });
  eq(Object.keys(reviewLinks).map(Number).sort((a, b) => a - b), [1, 2, 3],
    'a video on each wrong question that has one, and on no other');
  const bankLinks = await p.evaluate(nums => {
    const out = {};
    nums.forEach(n => { out[n] = window.EXPLANATION_VIDEO_LINKS.ch12[String(n)]; });
    return out;
  }, [1, 2, 3]);
  eq(reviewLinks, bankLinks, 'and each is that question\'s own video, not a neighbour\'s');
  eq(await p.evaluate(() => {
    let n = 0;
    document.querySelectorAll('.review-card.correct').forEach(c => { if (c.querySelector('.card-video')) n++; });
    return n;
  }), 0, 'nothing on the ones they got right');

  console.log('\n=== 13. The instructor previewing an exam gets no videos either ===');
  // This is the case the mode check exists for. On the trainee's side an exam
  // is already covered by the marking being withheld outright; here the
  // instructor IS shown the marking, and the rule that still has to hold is
  // that an exam paper on screen -- projected, or read over a shoulder --
  // carries no link naming the method for a question being scored.
  await p.goto(BASE);
  await p.click('#teacherModeBtn');
  await p.fill('#teacherLoginUsername', 'adnen');
  await p.fill('#teacherLoginPassword', 'x');
  await p.click('#teacherLoginBtn');
  await p.waitForSelector('#teacherInterface:not([hidden])');

  const preview = async mode => {
    await p.evaluate(() => {
      const el = document.getElementById('seedInput');
      if (el) { el.value = 'CV-SEED'; el.dispatchEvent(new Event('input', { bubbles: true })); }
      document.querySelectorAll('#questionTree input[type=checkbox]').forEach(b => { if (b.checked) b.click(); });
    });
    await p.evaluate(() => {
      const box = [...document.querySelectorAll('#questionTree input[type=checkbox]')]
        .find(b => { const r = b.closest('label') || b.parentElement; return r && r.textContent.includes('Chapters 01 & 02'); });
      if (box && !box.checked) box.click();
    });
    await p.waitForTimeout(250);
    await p.evaluate(() => {
      const el = document.getElementById('questionCount');
      el.value = '8';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await p.selectOption('#sessionMode', mode);
    await p.click('#createSessionBtn');
    await p.waitForSelector('#quizContainer .question-card');
    // Answer everything wrong, so a video would appear if one were allowed to.
    await p.evaluate(() => currentQuiz.forEach((q, i) => {
      const pick = ['a', 'b', 'c', 'd'].find(L => L !== q.answer);
      const el = document.querySelector(`#card-${i} input[value="${pick}"]`);
      if (el) el.click();
    }));
    await p.click('#submitBtn');
    await p.waitForTimeout(500);
    return p.evaluate(() => ({
      wrong: document.querySelectorAll('#quizContainer .question-card.flag-wrong').length,
      cards: document.querySelectorAll('#quizContainer .card-video').length,
      pills: document.querySelectorAll('#feedback .video-pill').length
    }));
  };

  const exam = await preview('assessment');
  ok(exam.wrong > 0, `the exam preview is marked (${exam.wrong} wrong)`);
  eq(exam.cards, 0, 'and carries no video on any card');
  eq(exam.pills, 0, 'nor in the list underneath');

  const prac = await preview('practice');
  ok(prac.wrong > 0, `a practice preview is marked too (${prac.wrong} wrong)`);
  ok(prac.cards > 0, `and this one does carry videos (${prac.cards})`);
  ok(prac.pills > 0, 'in the list as well — so the exam above was silent by rule, not by accident');

  console.log('\n=== 14. No page errors ===');
  ok(errs.length === 0, errs.length ? errs.slice(0, 3).join(' | ') : 'none');

  await browser.close();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})();
