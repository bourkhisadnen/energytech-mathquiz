/* Chapter 12A -- geometry.
 *
 * Four papers of 82 questions, 162 drawings and 80 explanation videos, added
 * beside Chapters 01 & 02 and Chapter 03.
 *
 * Two things about this chapter are worth guarding closely.
 *
 * The first is its key. The chapter is called 12A, but 'ch12' has meant
 * "Chapters 01 & 02" since before any other chapter existed and is written into
 * session codes already sitting in the Sheet. If the new chapter ever took that
 * key, every old session code would silently start serving the wrong paper.
 *
 * The second is Version A's answer key. The worksheet arrived with a key for
 * versions B, C and D only; Version A's was re-derived. So this suite checks the
 * three supplied keys against the ORIGINAL .tex file the teacher sent, rather
 * than against anything the build produced -- if the build ever mangles a key,
 * the answer sheet the trainees are marked against is what catches it.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://127.0.0.1:8902/energytech-mathquiz/index.html';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const UPLOAD = '/root/.claude/uploads/31b6d1fd-3b78-5915-86b3-6a23229c570d';

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

/* The key exactly as the teacher wrote it, read from the LaTeX source. */
function officialKey() {
  const txt = fs.readFileSync(`${UPLOAD}/5e6c7048-Ch12_answer_key.tex`, 'utf8');
  const out = {};
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*(\d+)\s*&\s*([A-D])\s*&\s*([A-D])\s*&\s*([A-D])\s*\\\\/);
    if (m) out[Number(m[1])] = { version_b: m[2].toLowerCase(), version_c: m[3].toLowerCase(), version_d: m[4].toLowerCase() };
  }
  return out;
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  const missing = [];
  page.on('response', r => { if (r.status() >= 400) missing.push(r.url()); });

  await page.route(/script\.google\.com/, r => {
    const q = Object.fromEntries(new URL(r.request().url()).searchParams);
    const data = q.action === 'auth_login'
      ? { ok: true, token: 'T', username: 'adnen', displayName: 'Adnane Khalifa', role: 'admin' }
      : q.action === 'roster_list' ? { ok: true, intakes: [], groups: [] }
      : { ok: true, message: 'mock' };
    return r.fulfill({ status: 200, contentType: 'application/javascript', body: `${q.callback}(${JSON.stringify(data)});` });
  });

  await page.goto(BASE);
  await page.click('#teacherModeBtn');
  await page.fill('#teacherLoginUsername', 'adnen');
  await page.fill('#teacherLoginPassword', 'x');
  await page.click('#teacherLoginBtn');
  await page.waitForSelector('#teacherInterface:not([hidden])');

  console.log('\n=== 1. The chapter is on the shelf, under its own key ===');
  const reg = await page.evaluate(() => ({
    chapters: Object.keys(CHAPTERS),
    label: chapterLabel('ch12a'),
    ch12Label: chapterLabel('ch12'),
    sets: Object.keys(chapterSets('ch12a')),
    setLabels: Object.values(chapterSets('ch12a')).map(s => s.label),
    counts: Object.values(chapterSets('ch12a')).map(s => s.questions.length)
  }));
  ok(reg.chapters.includes('ch12a'), 'Chapter 12A is registered');
  eq(reg.label, 'Chapter 12A', 'and is named the way the worksheet names it');
  eq(reg.ch12Label, 'Chapters 01 & 02',
    "while 'ch12' still means Chapters 01 & 02 -- the old session codes depend on it");
  eq(reg.sets, ['version_a', 'version_b', 'version_c', 'version_d'], 'four versions');
  eq(reg.setLabels, ['Version A', 'Version B', 'Version C', 'Version D'], 'named A to D');
  eq(reg.counts, [82, 82, 82, 82], '82 questions each');

  console.log('\n=== 2. A key of its own, not a share of anybody else\'s ===');
  const keys = await page.evaluate(() => ({
    a: parseSetKey('ch12a:version_a'),
    bare: parseSetKey('version_b'),
    old: parseSetKey('ch12:original_pdf'),
    unknown: parseSetKey('ch99:version_a')
  }));
  eq(keys.a, { chapterKey: 'ch12a', setId: 'version_a' }, 'ch12a:version_a reads as Chapter 12A');
  eq(keys.old, { chapterKey: 'ch12', setId: 'original_pdf' }, 'ch12:original_pdf is untouched');
  eq(keys.bare.chapterKey, 'ch12', 'a bare key still falls back to Chapters 01 & 02');
  eq(keys.unknown.chapterKey, 'ch12', 'and so does a key naming a chapter that does not exist');

  console.log('\n=== 3. The supplied answer key, checked against the teacher\'s own file ===');
  const official = officialKey();
  eq(Object.keys(official).length, 82, 'the file lists 82 answers');
  const stored = await page.evaluate(() => {
    const out = {};
    for (const [setid, set] of Object.entries(QUESTION_BANK_SETS_CH12A)) {
      out[setid] = Object.fromEntries(set.questions.map(q => [q.original_number, q.answer]));
    }
    return out;
  });
  for (const v of ['version_b', 'version_c', 'version_d']) {
    const wrong = [];
    for (let n = 1; n <= 82; n++) if (stored[v][n] !== official[n][v]) wrong.push(n);
    ok(wrong.length === 0, `${v} matches the sheet the teacher sent${wrong.length ? ' (differs on Q' + wrong.join(', Q') + ')' : ''}`);
  }

  console.log('\n=== 4. Version A, whose key was derived rather than supplied ===');
  const a = stored.version_a;
  ok(Object.values(a).every(v => 'abcd'.includes(v)), 'every question has an answer');
  eq(Object.keys(a).length, 82, 'all 82 of them');
  const spread = ['a', 'b', 'c', 'd'].map(L => Object.values(a).filter(v => v === L).length);
  ok(Math.max(...spread) <= 2 * Math.min(...spread),
    `and no letter carries the paper (a/b/c/d = ${spread.join('/')})`);
  // Where Version A asks a question one of the keyed versions also asks, its
  // answer must be the same words as that version's answer.
  //
  // "The same question" has to include the picture. Q17 to Q23 are all "Name
  // the polygon" with the same four options, and Q45 is "what kind of triangle
  // is this" -- word for word identical across the versions, and a different
  // shape drawn in each. Comparing on the sentence alone would call a hexagon
  // and an octagon the same question and report the bank as broken.
  const agree = await page.evaluate(() => {
    const sets = QUESTION_BANK_SETS_CH12A;
    const norm = s => String(s).replace(/\s+/g, ' ').trim().replace(/\.$/, '').toLowerCase();
    const opts = q => String(q.choices).split('\\item').slice(1).map(norm).filter(Boolean);
    const pic = q => (q.diagram && q.diagram.src) || '';
    let compared = 0, differ = [], skippedForPicture = 0;
    for (let n = 1; n <= 82; n++) {
      const qa = sets.version_a.questions[n - 1];
      for (const v of ['version_b', 'version_c', 'version_d']) {
        const qx = sets[v].questions[n - 1];
        if (norm(qa.body) !== norm(qx.body)) continue;
        const oa = opts(qa), ox = opts(qx);
        if ([...oa].sort().join('|') !== [...ox].sort().join('|')) continue;
        if (pic(qa) !== pic(qx)) { skippedForPicture++; continue; }
        compared++;
        if (oa['abcd'.indexOf(qa.answer)] !== ox['abcd'.indexOf(qx.answer)]) differ.push(`Q${n} vs ${v}`);
      }
    }
    return { compared, differ, skippedForPicture };
  });
  ok(agree.skippedForPicture > 0,
    `${agree.skippedForPicture} same-worded questions are set over a different drawing and are not comparable`);
  ok(agree.compared > 0, `${agree.compared} of Version A's answers can be cross-checked against a supplied key`);
  eq(agree.differ, [], 'and every one of them names the same answer');

  console.log('\n=== 5. Every drawing is there and belongs to this chapter ===');
  const built = await page.evaluate(() => {
    selectAll(false);
    setPaperSelected(paperByKey('ch12a:version_a'), true);
    afterSelectionChange();
    setCountValue(totalSelected());
    generateQuiz();
    return currentQuiz.length;
  });
  eq(built, 82, 'the whole paper builds');
  await page.waitForTimeout(600);
  const imgs = await page.evaluate(() => [...document.querySelectorAll('#quizContainer img')]
    .map(i => ({ src: i.getAttribute('src'), w: i.naturalWidth })));
  ok(imgs.length > 0, `${imgs.length} drawings on the paper`);
  ok(imgs.every(i => /^\.\/(figures_ch12a|images\/ch12a_)/.test(i.src)),
    'all of them from this chapter\'s own folder');
  const broken = imgs.filter(i => !i.w);
  eq(broken.map(b => b.src), [], 'and every one of them loaded');
  eq(missing.filter(u => /figures_ch12a|ch12a_/.test(u)), [], 'nothing 404s');

  console.log('\n=== 6. The figures carry the numbers the questions ask about ===');
  // A drawing that is silently the wrong one is the failure this chapter is
  // most exposed to: 162 files named by a hash, and a question whose dimensions
  // live only in the picture. Q31's trapezoid must be the one measuring 16.0 m.
  const q31 = await page.evaluate(async () => {
    const q = QUESTION_BANK_SETS_CH12A.version_a.questions[30];
    const svg = await fetch(q.diagram.src).then(r => r.text());
    return { src: q.diagram.src, has16: /16\.0/.test(svg), has10: /10\.0/.test(svg), answer: q.answer };
  });
  ok(q31.has16 && q31.has10, 'Q31 is drawn with the 10.0 m and 16.0 m sides its answer needs');
  eq(q31.answer, 'd', 'and (10.0 + 16.0) / 2 x 6.0 = 78 is the option marked right');

  console.log('\n=== 7. Explanation videos ===');
  const vids = await page.evaluate(() => {
    const L = window.EXPLANATION_VIDEO_LINKS;
    const mine = L.ch12a;
    const others = new Set(Object.keys(L).filter(k => k !== 'ch12a')
      .flatMap(k => Object.values(L[k])));
    return {
      count: Object.keys(mine).length,
      shared: Object.values(mine).filter(v => others.has(v)).length,
      q1: explanationLinkForQuestion({ original_number: 1, __chapter: 'ch12a' }),
      q1other: explanationLinkForQuestion({ original_number: 1, __chapter: 'ch12' }),
      q17: explanationLinkForQuestion({ original_number: 17, __chapter: 'ch12a' }),
      q21: explanationLinkForQuestion({ original_number: 21, __chapter: 'ch12a' })
    };
  });
  eq(vids.count, 80, '80 links, one per question that has a QR code on the sheet');
  eq([vids.q17, vids.q21], ['', ''], 'Q17 and Q21 have none, because the sheet prints none');
  ok(vids.q1 && vids.q1 !== vids.q1other,
    'Q1 opens this chapter\'s video, not the Chapter 01 video of the same number');
  eq(vids.shared, 0, 'and no link is shared with another chapter');

  console.log('\n=== 8. Marking ===');
  for (const v of ['version_a', 'version_b', 'version_c', 'version_d']) {
    const r = await page.evaluate(k => {
      selectAll(false);
      setPaperSelected(paperByKey(k), true);
      afterSelectionChange();
      setCountValue(totalSelected());
      generateQuiz();
      currentQuiz.forEach((q, i) => {
        const bad = ['a', 'b', 'c', 'd'].find(L => L !== q.answer);
        const el = document.querySelector(`#quizContainer input[name="q${i}"][value="${bad}"]`);
        if (el) el.checked = true;
      });
      calculateScore({ target: 'teacher', requireAll: false, reveal: true });
      const zero = lastFeedback.correct;
      currentQuiz.forEach((q, i) => {
        const el = document.querySelector(`#quizContainer input[name="q${i}"][value="${q.answer}"]`);
        if (el) el.checked = true;
      });
      calculateScore({ target: 'teacher', requireAll: false, reveal: true });
      return { zero, full: lastFeedback.correct, total: lastFeedback.total };
    }, `ch12a:${v}`);
    ok(r.zero === 0 && r.full === 82 && r.total === 82,
      `${v}: all wrong scores 0/82, all right scores 82/82 (got ${r.zero} and ${r.full}/${r.total})`);
  }

  console.log('\n=== 9. A session code rebuilds the same paper for the trainee ===');
  const trip = await page.evaluate(() => {
    const key = 'ch12a:version_c';
    const one = selectQuestionsFor({ questionSetKey: key, questionCount: 20, seed: 'S7', orderMode: 'original' });
    const two = selectQuestionsFor({ questionSetKey: key, questionCount: 20, seed: 'S7', orderMode: 'original' });
    return {
      same: JSON.stringify(one.selected.map(q => q.original_number)) ===
            JSON.stringify(two.selected.map(q => q.original_number)),
      n: one.selected.length,
      chapters: [...new Set(one.selected.map(q => q.__chapter))],
      lessons: [...new Set(one.selected.map(q => q.lesson))].every(l => /^12-\d/.test(l))
    };
  });
  ok(trip.same, 'the same code draws the same questions twice');
  eq(trip.n, 20, 'of the number asked for');
  eq(trip.chapters, ['ch12a'], 'all from Chapter 12A');
  ok(trip.lessons, 'and every lesson code belongs to Chapter 12 (12-x.y)');

  console.log('\n=== 10. Nothing raw reaches the screen ===');
  const raw = await page.evaluate(() => {
    const bad = [];
    for (const [setid, set] of Object.entries(QUESTION_BANK_SETS_CH12A)) {
      for (const q of set.questions) {
        const html = renderText(q.body).replace('[[DIAGRAM]]', '');
        const choices = splitChoices(q.choices).map(c => renderText(c.text));
        for (const s of [html, ...choices]) {
          if (/\\[a-zA-Z]+|\$|\{|\}/.test(s)) bad.push(`${setid} Q${q.original_number}: ${s.slice(0, 60)}`);
        }
      }
    }
    return bad.slice(0, 5);
  });
  eq(raw, [], 'no LaTeX command, dollar sign or brace survives rendering');

  // Heron's formula is the first root sign the app has ever had to draw, and
  // its radicand happens to contain only brackets. The bar has to stretch over
  // the WHOLE radicand, so the closing brace is found by counting -- which
  // nothing on this paper would notice going wrong. Asked directly:
  // Asked of replaceSqrt directly, not through renderMath: renderMath strips
  // every leftover brace on its way out, so a radicand that closed in the wrong
  // place still comes back looking tidy. The exact text is what tells them apart.
  const roots = await page.evaluate(() => ({
    plain: replaceSqrt('\\sqrt{s(s-a)(s-b)(s-c)}'),
    nested: replaceSqrt('\\sqrt{\\frac{a}{b}}'),
    trailing: replaceSqrt('\\sqrt{2} + 1'),
    unbalanced: replaceSqrt('\\sqrt{2')
  }));
  const wrap = inner => `<span class="sqrt">&radic;<span class="radicand">${inner}</span></span>`;
  eq(roots.plain, wrap('s(s-a)(s-b)(s-c)'), "the bar covers the whole radicand of Heron's formula");
  eq(roots.nested, wrap('\\frac{a}{b}'), 'a radicand with braces of its own closes at the matching one');
  eq(roots.trailing, wrap('2') + ' + 1', 'and what follows the root stays outside it');
  eq(roots.unbalanced, '\\sqrt{2',
    'an unbalanced radicand is left alone rather than swallowing the rest of the line');

  console.log('\n=== 11. No page errors ===');
  eq(errs, [], 'no console or page errors');

  await browser.close();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }
})();
