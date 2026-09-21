/* Chapter 04 -- measurement (significant figures, precision, greatest possible
 * error, vernier caliper and micrometer reading, accuracy comparison, and
 * significant-figure arithmetic).
 *
 * Four papers of 50 questions, 32 scale drawings, 2 shared reference photos
 * and 50 explanation videos, added beside Chapters 01 & 02, 03 and 12A.
 *
 * Its answer key has the same two-part shape Chapter 12A's did: versions B, C
 * and D carry the worksheet's own key, checked here against the ORIGINAL .tex
 * files the teacher sent (not against anything the build produced, so a build
 * that mangles a key is what this suite is meant to catch). The original
 * worksheet ("Original PDF worksheet") arrived with no key of its own and is
 * stored under 'original_pdf' from the start -- unlike Chapter 12A, this
 * chapter never went through a 'version_a' detour, per the user's explicit
 * instruction to key it that way from the outset.
 *
 * Repointed for Phase 6, like the other browser suites: the app is loaded from
 * energytech-api's src/app.js (which serves public/), signed in through the real
 * login against the test database, and the teacher's answer key is read from
 * the copy committed at tools/ch04/worksheets/Ch04_answer_key.tex, not from a
 * chat upload path that only ever existed on the machine that wrote this. It
 * used to load a static server on port 8902 from a Linux chromium path and
 * answer JSONP calls from a mock, so on this machine it could not start -- and
 * mutate_backend.js counted "could not start" as a caught mutation
 * (claude/33-harness-counted-a-dead-suite-as-caught.md). Every page-side check
 * is unchanged.
 */
const path = require('path');
const { chromium } = require('playwright');
const fs = require('fs');

const ENERGYTECH_API_ROOT = path.join(__dirname, '..', '..', 'energytech-api');
require('dotenv').config({ path: path.join(ENERGYTECH_API_ROOT, '.env') });

// Must be required before src/app, so the app under test and these fixtures
// land on the same (test) database -- see tests/helpers/db.js's own comment.
const { pool, resetDb, insertInstructor } = require(path.join(ENERGYTECH_API_ROOT, 'tests', 'helpers', 'db'));
const { hashPasswordForStorage } = require(path.join(ENERGYTECH_API_ROOT, 'src', 'lib', 'passwords'));
const app = require(path.join(ENERGYTECH_API_ROOT, 'src', 'app'));

const KEY_TEX = path.join(__dirname, 'ch04', 'worksheets', 'Ch04_answer_key.tex');

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

/* The key exactly as the teacher wrote it, read from the LaTeX source. */
function officialKey() {
  const txt = fs.readFileSync(KEY_TEX, 'utf8');
  const out = {};
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*(\d+)\s*&\s*([A-D])\s*&\s*([A-D])\s*&\s*([A-D])\s*\\\\/);
    if (m) out[Number(m[1])] = { version_b: m[2].toLowerCase(), version_c: m[3].toLowerCase(), version_d: m[4].toLowerCase() };
  }
  return out;
}

(async () => {
  await resetDb();
  const pw = await hashPasswordForStorage('x');
  await insertInstructor({
    username: 'adnen', displayName: 'Adnane Khalifa', role: 'admin', status: 'approved',
    passwordHash: pw.passwordHash, passwordSalt: pw.passwordSalt, passwordAlgo: pw.passwordAlgo,
  });
  const server = app.listen(0);
  const BASE = `http://127.0.0.1:${server.address().port}/index.html`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  const missing = [];
  page.on('response', r => { if (r.status() >= 400) missing.push(r.url()); });

  await page.goto(BASE);
  await page.click('#teacherModeBtn');
  await page.fill('#teacherLoginUsername', 'adnen');
  await page.fill('#teacherLoginPassword', 'x');
  await page.click('#teacherLoginBtn');
  await page.waitForSelector('#teacherInterface:not([hidden])');

  console.log('\n=== 1. The chapter is on the shelf, under its own key ===');
  const reg = await page.evaluate(() => ({
    chapters: Object.keys(CHAPTERS),
    label: chapterLabel('ch04'),
    sets: Object.keys(chapterSets('ch04')),
    setLabels: Object.values(chapterSets('ch04')).map(s => s.label),
    counts: Object.values(chapterSets('ch04')).map(s => s.questions.length)
  }));
  ok(reg.chapters.includes('ch04'), 'Chapter 04 is registered');
  eq(reg.label, 'Chapter 04', 'and is named the way the worksheet names it');
  eq(reg.sets, ['original_pdf', 'version_b', 'version_c', 'version_d'], 'four versions, original first');
  eq(reg.setLabels, ['Original PDF worksheet', 'Version B', 'Version C', 'Version D'],
    'named to match Chapters 01/02/03/12A\'s convention -- no "version_a" detour this time');
  eq(reg.counts, [50, 50, 50, 50], '50 questions each');

  // The chapters are listed by their number on the syllabus, not by the order
  // they were added to the app -- Chapter 04 comes BEFORE Chapter 12A. There is
  // no sort anywhere: the order is the order CHAPTERS is written in, which is
  // exactly the kind of thing that regresses silently when the next chapter is
  // appended to the end of the object. Checked on the rendered tree, which is
  // what the instructor actually looks at, as well as in the registry.
  eq(reg.chapters, ['ch12', 'ch03', 'ch04', 'ch12a'],
    'the chapters are registered in syllabus order, 04 before 12A');
  const treeOrder = await page.evaluate(() =>
    [...document.querySelectorAll('#questionTree .tree-chapter > .tree-row .tree-label')]
      .map(el => el.textContent.trim()));
  eq(treeOrder, ['Chapters 01 & 02', 'Chapter 03', 'Chapter 04', 'Chapter 12A'],
    'and the question tree on screen lists them in that order');

  console.log('\n=== 2. A key of its own, not a share of anybody else\'s ===');
  const keys = await page.evaluate(() => ({
    a: parseSetKey('ch04:original_pdf'),
    bare: parseSetKey('version_b'),
    unknown: parseSetKey('ch99:original_pdf')
  }));
  eq(keys.a, { chapterKey: 'ch04', setId: 'original_pdf' }, 'ch04:original_pdf reads as Chapter 04');
  eq(keys.bare.chapterKey, 'ch12', 'a bare key still falls back to Chapters 01 & 02');
  eq(keys.unknown.chapterKey, 'ch12', 'and so does a key naming a chapter that does not exist');

  console.log('\n=== 3. The supplied answer key, checked against the teacher\'s own file ===');
  const official = officialKey();
  eq(Object.keys(official).length, 50, 'the file lists 50 answers');
  const stored = await page.evaluate(() => {
    const out = {};
    for (const [setid, set] of Object.entries(QUESTION_BANK_SETS_CH04)) {
      out[setid] = Object.fromEntries(set.questions.map(q => [q.original_number, q.answer]));
    }
    return out;
  });
  for (const v of ['version_b', 'version_c', 'version_d']) {
    const wrong = [];
    for (let n = 1; n <= 50; n++) if (stored[v][n] !== official[n][v]) wrong.push(n);
    ok(wrong.length === 0, `${v} matches the sheet the teacher sent${wrong.length ? ' (differs on Q' + wrong.join(', Q') + ')' : ''}`);
  }

  console.log('\n=== 4. The original worksheet, whose key was derived rather than supplied ===');
  const a = stored.original_pdf;
  ok(Object.values(a).every(v => 'abcd'.includes(v)), 'every question has an answer');
  eq(Object.keys(a).length, 50, 'all 50 of them');
  const spread = ['a', 'b', 'c', 'd'].map(L => Object.values(a).filter(v => v === L).length);
  ok(Math.max(...spread) <= 2 * Math.min(...spread),
    `and no letter carries the paper (a/b/c/d = ${spread.join('/')})`);
  // Q18/19 (caliper parts) and Q24/25 (micrometer parts) use the SAME shared
  // reference photo across all four versions, so unlike Chapter 12A's picture
  // check, these can be compared directly: the same lettered part must name
  // the same thing everywhere it's asked.
  const agree = await page.evaluate(() => {
    const sets = QUESTION_BANK_SETS_CH04;
    const norm = s => String(s).replace(/\s+/g, ' ').trim().replace(/\.$/, '').toLowerCase();
    const opts = q => String(q.choices).split('\\item').slice(1).map(norm).filter(Boolean);
    let compared = 0, differ = [];
    for (const n of [18, 19, 24, 25]) {
      const qa = sets.original_pdf.questions[n - 1];
      for (const v of ['version_b', 'version_c', 'version_d']) {
        const qx = sets[v].questions[n - 1];
        if (norm(qa.body) !== norm(qx.body)) continue;   // different lettered part asked
        const oa = opts(qa), ox = opts(qx);
        if ([...oa].sort().join('|') !== [...ox].sort().join('|')) continue;
        compared++;
        if (oa['abcd'.indexOf(qa.answer)] !== ox['abcd'.indexOf(qx.answer)]) differ.push(`Q${n} vs ${v}`);
      }
    }
    return { compared, differ };
  });
  ok(agree.compared > 0, `${agree.compared} of the original worksheet's part-ID answers cross-check against a supplied key`);
  eq(agree.differ, [], 'and every one of them names the same part');

  console.log('\n=== 5. Every drawing and photo is there and belongs to this chapter ===');
  const built = await page.evaluate(() => {
    selectAll(false);
    setPaperSelected(paperByKey('ch04:original_pdf'), true);
    afterSelectionChange();
    setCountValue(totalSelected());
    generateQuiz();
    return currentQuiz.length;
  });
  eq(built, 50, 'the whole paper builds');
  // Settle on the pictures' own load state rather than a fixed wait -- see the
  // note on the same check in test_ch12a.js, where a fixed 600ms produced three
  // false "the drawings did not load" failures against a cold server. This
  // paper only pulls 10 files and has not flaked yet, but the race is the same.
  // ('complete' is true for a FAILED load too, so this waits without masking a
  // genuinely broken picture -- naturalWidth below is still what judges that.)
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('#quizContainer img')];
    return imgs.length > 0 && imgs.every(i => i.complete);
  }, null, { timeout: 30000 }).catch(() => { /* fall through: assertions below report it */ });
  const imgs = await page.evaluate(() => [...document.querySelectorAll('#quizContainer img')]
    .map(i => ({ src: i.getAttribute('src'), w: i.naturalWidth })));
  ok(imgs.length > 0, `${imgs.length} drawings/photos on the paper`);
  ok(imgs.every(i => /^\.\/(figures_ch04\/|images\/ch04_)/.test(i.src)),
    'all of them from this chapter\'s own folder');
  const broken = imgs.filter(i => !i.w);
  eq(broken.map(b => b.src), [], 'and every one of them loaded');
  eq(missing.filter(u => /figures_ch04|ch04_/.test(u)), [], 'nothing 404s');

  console.log('\n=== 6. No two reading questions share the same drawing ===');
  // Every caliper/micrometer reading question on the original worksheet must be
  // drawn with a figure of its own -- a silent mix-up (two reading questions
  // pointing at the same hash-named drawing) is the failure this chapter's 32
  // TikZ figures are most exposed to. (pdftocairo renders TikZ text as glyph
  // outlines, not literal characters, so the figure content itself can't be
  // grepped for its numbers the way Chapter 12A's SVGs could -- that check
  // is replaced here with the one thing that actually catches a mix-up: every
  // reading question on a paper must own a DISTINCT drawing.)
  const figIdentity = await page.evaluate(() => {
    const out = {};
    for (const [setid, set] of Object.entries(QUESTION_BANK_SETS_CH04)) {
      const readingSrcs = [20, 21, 22, 23, 26, 27, 28, 29]
        .map(n => set.questions[n - 1].diagram && set.questions[n - 1].diagram.src);
      out[setid] = {
        allPresent: readingSrcs.every(Boolean),
        allDistinct: new Set(readingSrcs).size === readingSrcs.length,
        caliperPartsShareOne: set.questions[17].diagram.src === set.questions[18].diagram.src,
        micrometerPartsShareOne: set.questions[23].diagram.src === set.questions[24].diagram.src
      };
    }
    return out;
  });
  for (const [setid, r] of Object.entries(figIdentity)) {
    ok(r.allPresent && r.allDistinct,
      `${setid}: Q20/21/22/23/26/27/28/29 each own a distinct drawing (no accidental reuse)`);
    ok(r.caliperPartsShareOne && r.micrometerPartsShareOne,
      `${setid}: Q18/19 (caliper parts) and Q24/25 (micrometer parts) correctly share their one reference photo`);
  }

  console.log('\n=== 7. Explanation videos ===');
  const vids = await page.evaluate(() => {
    const L = window.EXPLANATION_VIDEO_LINKS;
    const mine = L.ch04;
    const others = new Set(Object.keys(L).filter(k => k !== 'ch04')
      .flatMap(k => Object.values(L[k])));
    return {
      count: Object.keys(mine).length,
      shared: Object.values(mine).filter(v => others.has(v)).length,
      q1: explanationLinkForQuestion({ original_number: 1, __chapter: 'ch04' }),
      q1other: explanationLinkForQuestion({ original_number: 1, __chapter: 'ch12' })
    };
  });
  eq(vids.count, 50, '50 links -- every question on this sheet carries a QR code');
  ok(vids.q1 && vids.q1 !== vids.q1other,
    'Q1 opens this chapter\'s video, not the Chapter 01 video of the same number');
  eq(vids.shared, 0, 'and no link is shared with another chapter');

  console.log('\n=== 8. Marking ===');
  for (const v of ['original_pdf', 'version_b', 'version_c', 'version_d']) {
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
    }, `ch04:${v}`);
    ok(r.zero === 0 && r.full === 50 && r.total === 50,
      `${v}: all wrong scores 0/50, all right scores 50/50 (got ${r.zero} and ${r.full}/${r.total})`);
  }

  console.log('\n=== 9. A session code rebuilds the same paper for the trainee ===');
  const trip = await page.evaluate(() => {
    const key = 'ch04:version_c';
    const one = selectQuestionsFor({ questionSetKey: key, questionCount: 15, seed: 'S7', orderMode: 'original' });
    const two = selectQuestionsFor({ questionSetKey: key, questionCount: 15, seed: 'S7', orderMode: 'original' });
    return {
      same: JSON.stringify(one.selected.map(q => q.original_number)) ===
            JSON.stringify(two.selected.map(q => q.original_number)),
      n: one.selected.length,
      chapters: [...new Set(one.selected.map(q => q.__chapter))]
    };
  });
  ok(trip.same, 'the same code draws the same questions twice');
  eq(trip.n, 15, 'of the number asked for');
  eq(trip.chapters, ['ch04'], 'all from Chapter 04');

  console.log('\n=== 10. The two source typos, corrected at source and staying corrected ===');
  // Both of these were in the teacher's own .tex files and were carried
  // faithfully at first; on 2026-09-09 Adnen asked for them fixed, so they were
  // corrected in all four .tex sources and the bank rebuilt from those. These
  // checks are the other way round from the ones they replace: they now fail if
  // either typo ever comes back -- which is exactly what would happen if a
  // future rebuild picked up an uncorrected copy of the worksheets.

  // 1. Q4's lesson code read "1-1.1" -- a Chapter 1 code on a Chapter 4
  //    question -- in every one of the four versions. No exception is carved
  //    out any more: EVERY question's lesson code must be a 4-x.y.
  const lessonCheck = await page.evaluate(() => {
    const bad = [];
    for (const [setid, set] of Object.entries(QUESTION_BANK_SETS_CH04)) {
      for (const q of set.questions) {
        if (!/^4-\d/.test(q.lesson)) bad.push(`${setid} Q${q.original_number}: ${q.lesson}`);
      }
    }
    return bad;
  });
  eq(lessonCheck, [], 'every question\'s lesson code belongs to Chapter 4 (4-x.y), Q4 included');
  const q4lessons = await page.evaluate(() =>
    Object.values(QUESTION_BANK_SETS_CH04).map(s => s.questions[3].lesson));
  eq(q4lessons, ['4-1.1', '4-1.1', '4-1.1', '4-1.1'],
    'Q4 reads 4-1.1 in all four versions, like the Q1-Q6 run it belongs to');

  // 2. Version A's Q45 listed the same decoy twice (options A and C both
  //    "206,700"). C is now 200,000 -- the 1-significant-figure value, the
  //    member of the 1sf/2sf/3sf/raw set B, C and D all carry and A lacked.
  //    The answer did not move: it is still B, the 2-sig-fig 210,000.
  const q45 = await page.evaluate(() => {
    const q = QUESTION_BANK_SETS_CH04.original_pdf.questions[44];
    return {
      opts: String(q.choices).split('\\item').slice(1).map(s => s.trim()),
      answer: q.answer
    };
  });
  eq(q45.opts.length, 4, 'Version A\'s Q45 still offers four options');
  eq([...new Set(q45.opts)].length, 4, 'and all four are now distinct -- the duplicated decoy is gone');
  ok(/200\{,\}000/.test(q45.opts[2]), 'option C is the 1-significant-figure value, 200,000 cm^2');
  eq(q45.answer, 'b', 'and the answer is unchanged: B, the 2-sig-fig 210,000 cm^2');

  // The duplicate was A-only, but nothing about it was A-specific, so the
  // guard is chapter-wide rather than aimed at the one question that had it.
  const dupes = await page.evaluate(() => {
    const bad = [];
    for (const [setid, set] of Object.entries(QUESTION_BANK_SETS_CH04)) {
      for (const q of set.questions) {
        const opts = String(q.choices).split('\\item').slice(1).map(s => s.trim()).filter(Boolean);
        if (new Set(opts).size !== opts.length) bad.push(`${setid} Q${q.original_number}`);
      }
    }
    return bad;
  });
  eq(dupes, [], 'and no question on any of the four papers repeats an option');

  console.log('\n=== 11. Nothing raw reaches the screen ===');
  const raw = await page.evaluate(() => {
    const bad = [];
    for (const [setid, set] of Object.entries(QUESTION_BANK_SETS_CH04)) {
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

  console.log('\n=== 12. No page errors ===');
  eq(errs, [], 'no console or page errors');

  await browser.close();
  server.close();
  await pool.end();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
