/* Mutation test for the trainee's own-record route.
 *
 * The suite passing proves nothing on its own -- a guard that always returns
 * true passes every test that only ever exercises the allowed case. So each
 * guard is deliberately broken, one at a time, and the suite must fail. A
 * mutation that survives is a guard nothing is actually testing. */
const { execFileSync } = require('child_process');
const fs = require('fs');

const CODE = '/tmp/energytech_app/energytech_quiz_app_session_sync_fixed/google_apps_script/Code.gs';
const original = fs.readFileSync(CODE, 'utf8');

const MUTANTS = [
  {
    what: 'my_attempt stops checking the attempt belongs to the caller',
    from: "    if (normId_(row[4]) !== me) return false;",
    to:   "    if (false) return false;",
    suite: 'test_my_history.js'
  },
  {
    what: 'my_history filters by instructor, as the roster route does',
    from: "  return historyFor_(normId_(auth.trainee.energytechId), function () { return true; }, true);",
    to:   "  return historyFor_(normId_(auth.trainee.energytechId), function (owner) { return String(owner) === 'sara'; }, true);",
    suite: 'test_my_history.js'
  },
  {
    what: 'my_history trusts an energytechId parameter instead of the token',
    from: "  return historyFor_(normId_(auth.trainee.energytechId), function () { return true; }, true);",
    to:   "  return historyFor_(normId_(params.energytechId || auth.trainee.energytechId), function () { return true; }, true);",
    suite: 'test_my_history.js'
  },
  {
    what: 'a revoked trainee keeps their access',
    from: "    if (String(rows[i][5] || '') !== 'active') {",
    to:   "    if (false) {",
    suite: 'test_my_history.js'
  },
  {
    what: 'the instructor attempt route stops checking who owns the session',
    from: "  return attemptFor_(attemptId, row => isAdmin || normalizeUsername_(row[19]) === viewer);",
    to:   "  return attemptFor_(attemptId, function () { return true; });",
    suite: 'test_history.js'
  },
  {
    what: 'the instructor history route stops filtering by session owner',
    from: "  return historyFor_(id, owner => isAdmin || normalizeUsername_(owner) === viewer, false);",
    to:   "  return historyFor_(id, function () { return true; }, false);",
    suite: 'test_history.js'
  },
  {
    what: 'my_history accepts an instructor token',
    from: "function myHistory_(params) {\n  const auth = requireTrainee_(params);",
    to:   "function myHistory_(params) {\n  const auth = requireAuth_(params).ok ? { ok: true, trainee: { energytechId: 'ET1001' } } : requireTrainee_(params);",
    suite: 'test_my_history.js'
  },

  /* --- holding exam marks back until the instructor releases them --- */
  {
    what: 'the trainee route stops gating exam marks at all',
    from: "  return historyFor_(normId_(auth.trainee.energytechId), function () { return true; }, true);",
    to:   "  return historyFor_(normId_(auth.trainee.energytechId), function () { return true; }, false);",
    suite: 'test_exam_release.js'
  },
  {
    what: 'an unreleased exam still reports its score',
    from: "      score: hold ? null : Number(row[13] || 0),",
    to:   "      score: Number(row[13] || 0),",
    suite: 'test_exam_release.js'
  },
  {
    what: 'an unreleased exam still reports its percentage',
    from: "      percent: hold ? null : Number(row[15] || 0),",
    to:   "      percent: Number(row[15] || 0),",
    suite: 'test_exam_release.js'
  },
  {
    what: 'an unreleased exam still hands out its attempt id',
    from: "      attemptId: hold ? '' : attemptId,",
    to:   "      attemptId: attemptId,",
    suite: 'test_exam_release.js'
  },
  {
    what: 'an unreleased exam feeds the lesson bars, which give the mark away',
    from: "    if (withheld[String(row[1] || '')]) return;",
    to:   "    if (false) return;",
    suite: 'test_exam_release.js'
  },
  {
    what: 'my_attempt opens an exam whose marks are not out',
    from: "    if (String(row[7] || '').toLowerCase() === 'assessment'\n        && !published[String(row[5] || '').toUpperCase().trim()]) {",
    to:   "    if (false) {",
    suite: 'test_exam_release.js'
  },
  {
    what: 'anyone may release anyone\'s session',
    from: "  if (!isAdmin && owner !== normalizeUsername_(auth.instructor.username)) {",
    to:   "  if (false) {",
    suite: 'test_exam_release.js'
  },
  {
    what: 'session_list shows every instructor\'s sessions',
    from: "    if (!isAdmin && normalizeUsername_(row[12]) !== viewer) continue;",
    to:   "    if (false) continue;",
    suite: 'test_exam_release.js'
  },
  /* --- one sitting per exam --- */
  {
    what: 'the write stops refusing a second sitting (only the browser guards it)',
    from: "  if (blocked) {",
    to:   "  if (false) {",
    suite: 'test_retake.js'
  },
  {
    what: 'practice quizzes are limited too',
    from: "  if (String(mode || '').toLowerCase() !== 'assessment') return null;",
    to:   "  if (false) return null;",
    suite: 'test_retake.js'
  },
  {
    what: 'the block is per exam rather than per trainee',
    from: "    if (String(row[5] || '').toUpperCase().trim() === code && normId_(row[4]) === id) sat++;",
    to:   "    if (String(row[5] || '').toUpperCase().trim() === code) sat++;",
    suite: 'test_retake.js'
  },
  {
    what: 'a granted retake becomes an open door instead of one sitting',
    from: "  return { sat: sat, allowed: 1 + granted, maySit: sat < 1 + granted };",
    to:   "  return { sat: sat, allowed: 1 + granted, maySit: granted > 0 || sat < 1 };",
    suite: 'test_retake.js'
  },
  {
    what: 'the session load stops reporting whether they have already sat it',
    from: "            maySit: mode.toLowerCase() !== 'assessment' ? true : s.maySit",
    to:   "            maySit: true",
    suite: 'test_retake.js'
  },
  {
    what: 'anyone may grant a retake on anyone\'s exam',
    from: "  if (auth.instructor.role !== 'admin' && owner !== normalizeUsername_(auth.instructor.username)) {\n    return { ok: false, error: 'That session belongs to another instructor.' };\n  }\n  if (!findTraineeRow_(traineesSheet_(), id)) {",
    to:   "  if (false) {\n    return { ok: false, error: 'That session belongs to another instructor.' };\n  }\n  if (!findTraineeRow_(traineesSheet_(), id)) {",
    suite: 'test_retake.js'
  },
  {
    what: 'a retake may be granted to somebody who is not on the roster',
    from: "  if (!findTraineeRow_(traineesSheet_(), id)) {\n    return { ok: false, error: 'Trainee ' + id + ' is not on the roster.' };\n  }",
    to:   "  if (false) {\n    return { ok: false, error: 'Trainee ' + id + ' is not on the roster.' };\n  }",
    suite: 'test_retake.js'
  },
  {
    what: 'a refused write is reported as a success',
    from: "    if (saved && saved.ok === false) return json_(saved);",
    to:   "    if (false) return json_(saved);",
    suite: 'test_retake.js'
  },
  {
    what: 'the per-launch seed is not recorded with the attempt',
    from: "    quiz.orderSeed || ''\n  ], [3, 4, 5, 6, 22, 24]);",
    to:   "    ''\n  ], [3, 4, 5, 6, 22, 24]);",
    suite: 'test_exam_release.js'
  }
];

/* The shuffle lives in app.js, not Code.gs, so it gets its own patch target. */
const APP = '/tmp/energytech_app/energytech_quiz_app_session_sync_fixed/app.js';
const appOriginal = fs.readFileSync(APP, 'utf8');
const APP_MUTANTS = [
  {
    what: 'the choice shuffle leaves the answer letter where it was',
    from: "      answer: moved >= 0 ? LETTERS[moved] : q.answer",
    to:   "      answer: q.answer",
    suite: 'test_shuffle.js'
  },
  {
    what: 'each launch draws its own questions, not just its own order',
    from: "  const rng = seededRandom(seed);\n  let selected = shuffle(bank, rng).slice(0, n);",
    to:   "  const rng = seededRandom(orderSeed || seed);\n  let selected = shuffle(bank, rng).slice(0, n);",
    suite: 'test_shuffle.js'
  },
  {
    what: 'the arrangement is random rather than seeded, so it cannot be rebuilt',
    from: "    selected = shuffle(selected, seededRandom(orderSeed + '|order'));",
    to:   "    selected = shuffle(selected, Math.random);",
    suite: 'test_shuffle.js'
  },
  {
    what: 'choices are keyed by position, so a question changes when the paper is reordered',
    from: "    const rng = seededRandom(`${orderSeed}|${q.__paper || ''}|${q.original_number}`);",
    to:   "    const rng = seededRandom(`${orderSeed}|${questions.indexOf(q)}`);",
    suite: 'test_shuffle.js'
  },
  {
    what: 'a legacy attempt is rebuilt on a fresh stream instead of the old one',
    from: "    selected = shuffle(selected, rng);\n  }\n  if (orderSeed) selected = shuffleChoicesOf(selected, orderSeed);",
    to:   "    selected = shuffle(selected, seededRandom(seed + '|order'));\n  }\n  if (orderSeed) selected = shuffleChoicesOf(selected, orderSeed);",
    suite: 'test_shuffle.js'
  }
];

let caught = 0, survived = [];
console.log('baseline:');
for (const suite of ['test_my_history.js', 'test_history.js', 'test_exam_release.js', 'test_shuffle.js', 'test_retake.js']) {
  try {
    execFileSync('node', ['/tmp/energytech_app/' + suite], { stdio: 'pipe' });
    console.log(`  clean   ${suite}`);
  } catch {
    console.log(`  BASELINE FAILS -- ${suite}. Nothing below means anything.`);
    process.exit(1);
  }
}
console.log('');

function runMutants(list, file, base) {
  for (const m of list) {
    if (!base.includes(m.from)) {
      console.log(`  SKIPPED  ${m.what}  (the code it patches has moved)`);
      survived.push(m.what + ' [pattern not found]');
      continue;
    }
    fs.writeFileSync(file, base.replace(m.from, m.to));
    let failed = false;
    try { execFileSync('node', ['/tmp/energytech_app/' + m.suite], { stdio: 'pipe' }); }
    catch { failed = true; }
    fs.writeFileSync(file, base);
    if (failed) { caught++; console.log(`  caught   ${m.what}  (${m.suite})`); }
    else { survived.push(m.what); console.log(`  SURVIVED ${m.what}  (${m.suite})`); }
  }
}

runMutants(MUTANTS, CODE, original);
runMutants(APP_MUTANTS, APP, appOriginal);

const total = MUTANTS.length + APP_MUTANTS.length;
console.log(`\n${caught} of ${total} broken guards were caught by the tests.`);
if (survived.length) {
  console.log('\nNOT ACTUALLY TESTED:');
  survived.forEach(s => console.log('  ' + s));
  process.exit(1);
}
