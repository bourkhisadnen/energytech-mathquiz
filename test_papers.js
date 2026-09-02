/* Regression cover for the parts the intake work touched indirectly: every
 * paper still builds a full quiz through the selection tree, scoring is still
 * exact at both ends, chapter-specific diagrams and videos do not leak across
 * chapters, and the instructor preview still works. Replaces test_ch03.js and
 * test_videos.js, which drove a #chapterSelect that the tree removed. */

const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8901/index.html';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let failures = [], checks = 0;
function ok(cond, label) {
  checks++;
  if (cond) console.log('  PASS  ' + label);
  else { console.log('  FAIL  ' + label); failures.push(label); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  // The backend is never reached in this test; every call is answered locally.
  await page.route('**/*script.google.com**', route => {
    const req = route.request();
    if (req.method() === 'POST') return route.fulfill({ status: 200, body: 'ok' });
    const p = Object.fromEntries(new URL(req.url()).searchParams);
    const data = p.action === 'auth_login'
      ? { ok: true, token: 'T', username: 'adnen', displayName: 'Adnane Khalifa', role: 'admin' }
      : p.action === 'roster_list' ? { ok: true, intakes: [], groups: [] }
      : { ok: true, message: 'mock' };
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: `${p.callback}(${JSON.stringify(data)});` });
  });

  await page.goto(BASE);
  await page.click('#teacherModeBtn');
  await page.fill('#teacherLoginUsername', 'adnen');
  await page.fill('#teacherLoginPassword', 'x');
  await page.click('#teacherLoginBtn');
  await page.waitForSelector('#teacherInterface:not([hidden])');

  const papers = await page.evaluate(() => allPapers().map(p => ({
    key: p.key, chapter: p.chapterKey, label: p.setLabel, n: p.questions.length
  })));
  ok(papers.length === 8, `eight papers on record (${papers.length})`);

  for (const paper of papers) {
    console.log(`\n=== ${paper.chapter} / ${paper.label} (${paper.n} questions) ===`);
    const built = await page.evaluate(k => {
      selectAll(false);
      setPaperSelected(paperByKey(k), true);
      afterSelectionChange();
      setCountValue(totalSelected());
      generateQuiz();
      return currentQuiz.length;
    }, paper.key);
    ok(built === paper.n, `all ${paper.n} questions built`);

    const bad = await page.evaluate(() => {
      const out = { noText: 0, notFour: 0, dupChoice: 0, noKey: 0, badKey: 0 };
      currentQuiz.forEach(q => {
        if (!q.body || !String(q.body).trim()) out.noText++;
        const opts = String(q.choices || '').split('\\item').slice(1).map(s => s.trim()).filter(Boolean);
        if (opts.length !== 4) out.notFour++;
        if (new Set(opts).size !== opts.length) out.dupChoice++;
        if (!q.answer) out.noKey++;
        else if (!['a', 'b', 'c', 'd'].includes(q.answer)) out.badKey++;
      });
      return out;
    });
    ok(Object.values(bad).every(v => v === 0),
      `every question has text, 4 distinct choices and a key (${JSON.stringify(bad)})`);

    const rendered = await page.$$eval('#quizContainer .question-card', n => n.length);
    ok(rendered === paper.n, `${paper.n} cards rendered`);

    // Diagrams belong to one chapter only: nothing from another chapter's
    // image set may appear on this paper.
    const foreign = await page.evaluate(ch => {
      const wrong = ch === 'ch03' ? 'original_' : 'ch03_';
      return [...document.querySelectorAll('#quizContainer img')]
        .map(i => i.getAttribute('src') || '')
        .filter(s => s.includes(wrong)).length;
    }, paper.chapter);
    ok(foreign === 0, 'no diagram from another chapter');

    // Same for the explanation videos.
    const badVideo = await page.evaluate(ch => {
      const links = [...document.querySelectorAll('#quizContainer a[href*="http"]')].map(a => a.href);
      if (!links.length) return 0;
      const map = (typeof EXPLANATION_LINKS !== 'undefined') ? EXPLANATION_LINKS : null;
      if (!map) return 0;
      const mine = new Set(Object.values(map[ch] || {}).flatMap(v => typeof v === 'string' ? [v] : Object.values(v)));
      const others = new Set(Object.keys(map).filter(k => k !== ch)
        .flatMap(k => Object.values(map[k]).flatMap(v => typeof v === 'string' ? [v] : Object.values(v))));
      return links.filter(l => others.has(l) && !mine.has(l)).length;
    }, paper.chapter);
    ok(badVideo === 0, 'no explanation video from another chapter');

    const allWrong = await page.evaluate(() => {
      currentQuiz.forEach((q, i) => {
        const wrongLetter = ['a', 'b', 'c', 'd'].find(L => L !== q.answer);
        const el = document.querySelector(`#quizContainer input[name="q${i}"][value="${wrongLetter}"]`);
        if (el) el.checked = true;
      });
      const fb = calculateScore({ target: 'teacher', requireAll: false, reveal: true });
      return { correct: lastFeedback.correct, total: lastFeedback.total, fb };
    });
    ok(allWrong.correct === 0 && allWrong.total === paper.n,
      `all-wrong scores 0 / ${paper.n} (got ${allWrong.correct} / ${allWrong.total})`);

    const allRight = await page.evaluate(() => {
      currentQuiz.forEach((q, i) => {
        const el = document.querySelector(`#quizContainer input[name="q${i}"][value="${q.answer}"]`);
        if (el) el.checked = true;
      });
      calculateScore({ target: 'teacher', requireAll: false, reveal: true });
      return { correct: lastFeedback.correct, total: lastFeedback.total };
    });
    ok(allRight.correct === paper.n, `all-right scores ${paper.n} / ${paper.n} (got ${allRight.correct})`);
  }

  console.log('\n=== Mixed selection across chapters ===');
  const mixed = await page.evaluate(() => {
    selectAll(false);
    const ps = allPapers();
    setPaperSelected(ps[0], true);
    setPaperSelected(ps[ps.length - 1], true);
    afterSelectionChange();
    setCountValue(40);
    generateQuiz();
    return {
      n: currentQuiz.length,
      chapters: [...new Set(currentQuiz.map(q => q.__chapter))].sort()
    };
  });
  ok(mixed.n === 40, `40 questions drawn from a two-chapter selection (${mixed.n})`);
  ok(mixed.chapters.length === 2, `both chapters represented (${mixed.chapters.join(', ')})`);

  console.log('\n=== No page errors ===');
  ok(errors.length === 0, 'no console or page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));

  await browser.close();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
