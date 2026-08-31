/* Per-launch shuffling of an exam.
 *
 * Three things have to hold at once, and the third is the dangerous one:
 *
 *   1. Every trainee gets the SAME questions -- the session seed picks them, so
 *      the exam is equally hard for everyone.
 *   2. Each launch arranges them differently, questions and choices both.
 *   3. The arrangement is reproducible from the recorded seed. If it is not,
 *      the review pairs "you answered (c)" with a paper where (c) was something
 *      else, and it does so silently.
 *
 * And a fourth, easy to break by accident: attempts recorded BEFORE this
 * feature existed must still rebuild exactly as they did. */
const fs = require('fs');
const path = '/tmp/energytech_app/energytech_quiz_app_session_sync_fixed/';

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// Load the app's own code, with just enough of a page around it to run.
global.window = {};
global.document = {
  getElementById: () => null,
  addEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => []
};
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.navigator = { userAgent: 'test' };

eval(fs.readFileSync(path + 'question_bank.js', 'utf8'));
eval(fs.readFileSync(path + 'question_bank_ch03.js', 'utf8'));
global.EXPLANATION_VIDEO_LINKS = {};
const src = fs.readFileSync(path + 'app.js', 'utf8');
eval(src);

const BASE = { questionSetKey: 'ch12:original_pdf', questionCount: 12, seed: 'EXAM-1', orderMode: 'original' };
// `const` inside a direct eval does not escape into this scope, so the app's
// LETTERS is redeclared here rather than reached for.
const L = ['a', 'b', 'c', 'd'];
const ids = qs => qs.map(q => q.original_number);
const letters = q => splitChoices(q.choices).map(c => c.text);

console.log('\n=== 1. The same questions for everyone ===');
const a = selectQuestionsFor(Object.assign({}, BASE, { orderSeed: 'launch-A' }));
const b = selectQuestionsFor(Object.assign({}, BASE, { orderSeed: 'launch-B' }));
const plain = selectQuestionsFor(BASE);
eq(ids(a.selected).slice().sort((x, y) => x - y), ids(plain.selected).slice().sort((x, y) => x - y),
  'launch A sits the same set of questions as the unshuffled paper');
eq(ids(b.selected).slice().sort((x, y) => x - y), ids(plain.selected).slice().sort((x, y) => x - y),
  'and so does launch B');

console.log('\n=== 2. Arranged differently ===');
ok(JSON.stringify(ids(a.selected)) !== JSON.stringify(ids(b.selected)),
  'the two launches order the questions differently');
ok(JSON.stringify(ids(a.selected)) !== JSON.stringify(ids(plain.selected)),
  'and neither is just the plain order');

// Choices: find the same question in both launches and compare their options.
const qA = a.selected.find(q => q.original_number === a.selected[0].original_number);
const qB = b.selected.find(q => q.original_number === qA.original_number);
ok(JSON.stringify(letters(qA)) !== JSON.stringify(letters(qB)),
  'the four choices of a given question are in a different order too');
eq(letters(qA).slice().sort(), letters(qB).slice().sort(),
  'but they are the same four options, not different ones');

console.log('\n=== 3. The answer travels with its option ===');
// The whole risk of shuffling choices: the key must follow the text it belongs
// to, or every marked paper is wrong.
const bank = {};
for (const setId in window.QUESTION_BANK_SETS) {
  window.QUESTION_BANK_SETS[setId].questions.forEach(q => { bank[setId + ':' + q.original_number] = q; });
}
let moved = 0, wrong = 0;
a.selected.forEach(q => {
  const original = bank['original_pdf:' + q.original_number];
  const wasText = splitChoices(original.choices)[L.indexOf(original.answer)].text;
  const nowText = splitChoices(q.choices)[L.indexOf(q.answer)].text;
  if (original.answer !== q.answer) moved++;
  if (wasText !== nowText) wrong++;
});
ok(moved > 0, `the correct letter moved on ${moved} of ${a.selected.length} questions`);
eq(wrong, 0, 'and on every one of them it still points at the same option text');

console.log('\n=== 4. Reproducible from the seed alone ===');
const again = selectQuestionsFor(Object.assign({}, BASE, { orderSeed: 'launch-A' }));
eq(ids(again.selected), ids(a.selected), 'the same seed rebuilds the same question order');
eq(again.selected.map(q => q.choices), a.selected.map(q => q.choices), 'and the same choice order');
eq(again.selected.map(q => q.answer), a.selected.map(q => q.answer), 'and the same answer letters');

console.log('\n=== 5. A question keeps its own arrangement wherever it lands ===');
// Choices are keyed to the question's identity, not to its position on the
// paper. A longer paper built from the same seed puts the same questions at
// different indices, and their options must not move because of it -- if they
// did, a question would mean something different depending on where it sat.
const longer = selectQuestionsFor(Object.assign({}, BASE, { questionCount: 24, orderSeed: 'launch-A' }));
const shuffledOrder = longer;
let compared = 0, drifted = [];
a.selected.forEach(q => {
  const twin = longer.selected.find(x => x.original_number === q.original_number);
  if (!twin) return;
  const here = ids(a.selected).indexOf(q.original_number);
  const there = ids(longer.selected).indexOf(q.original_number);
  if (here === there) return;         // only interesting where it actually moved
  compared++;
  if (JSON.stringify(letters(q)) !== JSON.stringify(letters(twin))) {
    drifted.push(`Q${q.original_number}`);
  }
});
ok(compared >= 5, `${compared} questions sit at a different index on the longer paper`);
eq(drifted, [], 'and every one of them shows the same four options in the same order');

console.log('\n=== 6. Old attempts rebuild exactly as before ===');
// Before this change, a shuffled paper drew its order from the SAME random
// stream as the selection. Anything recorded then has no order seed, and must
// still come back in the order it was sat -- a fresh stream here would reorder
// it under answers that no longer belong to it.
const legacy = selectQuestionsFor({ questionSetKey: 'ch12:original_pdf', questionCount: 12, seed: 'OLD-1', orderMode: 'shuffled' });
const rng = seededRandom('OLD-1');
const pool = [];
for (const setId in window.QUESTION_BANK_SETS) {
  if (setId !== 'original_pdf') continue;
  window.QUESTION_BANK_SETS[setId].questions.forEach(q => pool.push(q));
}
const expected = shuffle(shuffle(pool, rng).slice(0, 12), rng);
eq(ids(legacy.selected), ids(expected), 'an attempt with no order seed rebuilds on the old single stream');
eq(legacy.selected.map(q => q.choices), expected.map(q => q.choices), 'with its choices untouched');
eq(legacy.orderSeed, '', 'and reports no order seed');

console.log('\n=== 7. Choices are left alone unless a seed asks for it ===');
eq(plain.selected.map(q => q.choices),
   plain.selected.map(q => bank['original_pdf:' + q.original_number].choices),
  'the plain paper carries the bank\'s own choice order');
eq(plain.selected.map(q => q.answer),
   plain.selected.map(q => bank['original_pdf:' + q.original_number].answer),
  'and the bank\'s own answer letters');

console.log('\n=== 8. Every question still has four options and a real key ===');
let bad = [];
[a, b, shuffledOrder].forEach((paper, i) => {
  paper.selected.forEach(q => {
    const ch = splitChoices(q.choices);
    if (ch.length !== 4) bad.push(`paper ${i} Q${q.original_number}: ${ch.length} choices`);
    if (L.indexOf(q.answer) < 0) bad.push(`paper ${i} Q${q.original_number}: key "${q.answer}"`);
  });
});
eq(bad, [], 'no question lost an option or a key in the shuffle');

console.log('\n=== 9. Across the whole bank, not just one paper ===');
// A single sample can pass by luck. This runs every set through a launch and
// checks the key still points at the same text on all 456 questions.
let checkedAll = 0, brokeAll = 0;
['original_pdf', 'version_b', 'version_c', 'version_d'].forEach(setId => {
  const all = selectQuestionsFor({
    questionSetKey: 'ch12:' + setId, questionCount: 999, seed: 'S', orderSeed: 'L-' + setId, orderMode: 'original'
  });
  all.selected.forEach(q => {
    const original = bank[setId + ':' + q.original_number];
    if (!original) return;
    checkedAll++;
    const wasText = splitChoices(original.choices)[L.indexOf(original.answer)].text;
    const nowText = splitChoices(q.choices)[L.indexOf(q.answer)].text;
    if (wasText !== nowText) brokeAll++;
  });
});
ok(checkedAll === 456, `every question in Chapters 1 & 2 was shuffled and re-checked (${checkedAll})`);
eq(brokeAll, 0, 'and not one of them lost its correct answer');

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
