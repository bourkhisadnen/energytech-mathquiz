/* The explanation video on the question it belongs to, in a real browser
 * against the REAL energytech-api backend (Express + Postgres) --
 * repointed for Phase 6 from the mocked-Apps-Script version this file used
 * to be. See test_roster.js's header for the shared mechanics (served from
 * public/ via src/app.js, seeded/asserted through TEST_DATABASE_URL, never
 * DATABASE_URL).
 *
 * The list of wrong questions under the paper has always carried the links.
 * This is the same link inside the card, so a trainee reading the question they
 * got wrong can watch the explanation without scrolling to the foot of a
 * hundred-question paper and matching Q-numbers by eye.
 *
 * Two things have to stay true, and both are the sort that break quietly: the
 * link on a card must be the link for THAT question, and no video may appear on
 * an exam, where the marking itself is withheld.
 *
 * This is a straight repoint, not a rewrite, with one real simplification: the
 * mock fabricated a whole `my_attempt` reply (REVIEW_ATTEMPT/REVIEW_ITEMS) to
 * answer the "once released" review with, entirely disconnected from what step
 * 10 actually submitted -- it could do that because nothing was real. Here the
 * review is whatever the real backend actually recorded, so step 10 answers
 * the exam wrong on the SAME questions the review is later checked against
 * (the full WRONG set, not just its first three), rather than reconstructing a
 * fake attempt to match a review that was never really sat. Nothing about what
 * is being checked changes; only where the "wrong questions" list comes from
 * does -- a real submission instead of a canned reply. */

const path = require('path');
const { chromium } = require('playwright');

const ENERGYTECH_API_ROOT = path.join(__dirname, '..', '..', 'energytech-api');
require('dotenv').config({ path: path.join(ENERGYTECH_API_ROOT, '.env') });

const {
  pool, resetDb, insertInstructor, insertIntake, insertGroup, insertTrainee, issueInstructorToken,
} = require(path.join(ENERGYTECH_API_ROOT, 'tests', 'helpers', 'db'));
const { hashPasswordForStorage } = require(path.join(ENERGYTECH_API_ROOT, 'src', 'lib', 'passwords'));
const app = require(path.join(ENERGYTECH_API_ROOT, 'src', 'app'));

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const NO_VIDEO = [58, 81, 82, 83, 88, 89, 90];   // no QR code on the worksheet
// The exam is answered wrong on the same set the practice paper is, so the
// review checked in step 12 has something real to show for REVIEW_WRONG.
const WRONG = [1, 2, 3].concat(NO_VIDEO);

let BASE, API_URL;
async function api(action, params, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify({ action, ...params }) });
  return res.json();
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
  // Both G1-7001 and G1-9001 draw the same 114-question paper, so a card
  // already on screen from the session sat before this one satisfies a bare
  // ".question-card" wait before the new session has actually come back --
  // this waits for the session fetch itself to land first.
  await p.waitForFunction(c => typeof currentSession !== 'undefined' && currentSession && currentSession.sessionCode === c,
    code, { timeout: 15000 });
  await p.waitForSelector('.question-card');
}

(async () => {
  await resetDb();

  const adnenPw = await hashPasswordForStorage('x');
  await insertInstructor({ username: 'adnen', displayName: 'Adnane Khalifa', role: 'instructor',
    passwordHash: adnenPw.passwordHash, passwordSalt: adnenPw.passwordSalt, passwordAlgo: adnenPw.passwordAlgo });
  const itoken = await issueInstructorToken('adnen');
  const intakeId = await insertIntake('JAN26');
  const groupId = await insertGroup(intakeId, 'G1');
  const traineePw = await hashPasswordForStorage('x');
  await insertTrainee({
    energytechId: 'ET1000', name: 'Mohammed Al-Otaibi', intakeId, groupId, accountStatus: 'active',
    passwordHash: traineePw.passwordHash, passwordSalt: traineePw.passwordSalt, passwordAlgo: traineePw.passwordAlgo,
  });

  const server = app.listen(0);
  const { port } = server.address();
  BASE = `http://127.0.0.1:${port}/index.html`;
  API_URL = `http://127.0.0.1:${port}/api/call`;

  /* The whole Chapters 01 & 02 original paper in its printed order, so
   * question N on screen is original question N -- and so the seven questions
   * that carry no QR code (Q58, Q81-83, Q88-90) are on the paper and can be
   * got wrong. */
  const COMMON = {
    intake: 'JAN26', group: 'G1', questionSet: 'Chapters 01 & 02',
    questionSetKey: 'ch12:original_pdf', seed: 'S', questionCount: 114,
    orderMode: 'original', showOriginalNumbers: true, requireAll: false, allowWalkIn: false,
  };
  const practice = await api('quiz_session', Object.assign({ sessionCode: 'G1-7001', sessionName: 'Week 3 practice',
    mode: 'practice', shuffleEachLaunch: false }, COMMON), itoken);
  if (!practice.ok) { console.error('FATAL: could not create the practice session', practice); process.exit(1); }
  const exam = await api('quiz_session', Object.assign({ sessionCode: 'G1-9001', sessionName: 'Midterm exam',
    mode: 'assessment', shuffleEachLaunch: false }, COMMON), itoken);
  if (!exam.ok) { console.error('FATAL: could not create the exam session', exam); process.exit(1); }

  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 1100, height: 1200 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await p.goto(BASE);
  await p.click('#studentModeBtn');
  await p.fill('#traineeLoginId', 'ET1000');
  await p.fill('#traineeLoginPassword', 'x');
  await p.click('#traineeLoginBtn');
  await p.waitForSelector('#traineeHomePanel:not([hidden])');

  console.log('\n=== 1. Nothing before the paper is marked ===');
  await load(p, 'G1-7001');
  eq(await p.evaluate(() => currentQuiz.length), 114, 'the whole paper is drawn');
  eq(await p.evaluate(() => currentQuiz.map(q => q.original_number).join() ===
       currentQuiz.map((_, i) => i + 1).join()), true, 'in its printed order');
  eq(await p.$$eval('.card-video', n => n.length), 0,
    'no video is on any card while the paper is still being answered');

  console.log('\n=== 2. Submitting puts the video on the questions they missed ===');
  // Three ordinary wrong answers, plus every question that has no QR code.
  await answer(p, WRONG);
  await p.click('#studentSubmitBtn');
  await p.waitForSelector('.question-card.flag-wrong');
  // calculateScore flags the cards synchronously, but submitOnlineResult then
  // shows "Submitting result..." until the real POST resolves and rewrites
  // the feedback with the actual pill list -- the mock had none of that
  // latency, so this waits for the real round trip rather than a fixed delay.
  await p.waitForFunction(() => !/Submitting result/.test(document.getElementById('studentFeedback').textContent),
    null, { timeout: 15000 });
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
  await answer(p, WRONG);
  await p.click('#studentSubmitBtn');
  await p.waitForFunction(() => !/Submitting result/.test(document.getElementById('studentFeedback').textContent),
    null, { timeout: 15000 });
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
  // The practice attempt from steps 2-9 is on the same list and is always
  // openable -- only the EXAM's own row is what step 11 is about.
  const examRowOpenable = await p.evaluate(() => {
    const row = [...document.querySelectorAll('#myHistoryBody .attempt-row')]
      .find(r => r.textContent.includes('Midterm exam'));
    return row ? row.hasAttribute('data-attempt') && row.getAttribute('data-attempt') !== '' : null;
  });
  eq(examRowOpenable, false, 'and the exam row cannot be opened at all');

  console.log('\n=== 12. Once released, the review carries the videos ===');
  const published = await api('session_publish', { sessionCode: 'G1-9001' }, itoken);
  ok(published.ok, `exam published (${JSON.stringify(published)})`);
  await p.click('#myHistoryRefreshBtn');
  await p.waitForSelector('#myHistoryBody .attempt-row[data-attempt]');
  // Two attempts are on the list now (the practice one from steps 2-9 too) --
  // the exam's own row is the one this step opens.
  await p.evaluate(() => {
    const row = [...document.querySelectorAll('#myHistoryBody .attempt-row[data-attempt]')]
      .find(r => r.textContent.includes('Midterm exam'));
    if (row) row.click();
  });
  await p.waitForSelector('.review-card');
  eq(await p.$$eval('.review-card', n => n.length), 114, 'every question of the paper is shown back');
  eq(await p.$$eval('.review-card.wrong', n => n.length), WRONG.length,
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

  const examPreview = await preview('assessment');
  ok(examPreview.wrong > 0, `the exam preview is marked (${examPreview.wrong} wrong)`);
  eq(examPreview.cards, 0, 'and carries no video on any card');
  eq(examPreview.pills, 0, 'nor in the list underneath');

  const prac = await preview('practice');
  ok(prac.wrong > 0, `a practice preview is marked too (${prac.wrong} wrong)`);
  ok(prac.cards > 0, `and this one does carry videos (${prac.cards})`);
  ok(prac.pills > 0, 'in the list as well — so the exam above was silent by rule, not by accident');

  console.log('\n=== 14. No page errors ===');
  ok(errs.length === 0, errs.length ? errs.slice(0, 3).join(' | ') : 'none');

  await browser.close();
  server.close();
  await pool.end();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
