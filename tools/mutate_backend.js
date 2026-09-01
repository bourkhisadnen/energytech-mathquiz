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
    what: 'the exam page keeps the rest of the app on screen',
    from: "  setExamMode(target === 'student' && mode === 'assessment');",
    to:   "  setExamMode(false);",
    suite: 'test_exam_view.js'
  },
  {
    what: 'marking the paper for the download reveals the key again',
    from: "  if (!lastFeedback) calculateScore({ reveal: false });",
    to:   "  if (!lastFeedback) calculateScore();",
    suite: 'test_exam_view.js'
  },
  {
    what: 'the download button stays on screen during an exam',
    from: "  if (dl) dl.hidden = examSessionActive();",
    to:   "  if (dl) dl.hidden = false;",
    suite: 'test_exam_view.js'
  },
  {
    what: 'the download follows the screen state, so it returns after Submit',
    from: "  if (dl) dl.hidden = examSessionActive();",
    to:   "  if (dl) dl.hidden = document.body.classList.contains('exam-mode');",
    suite: 'test_exam_view.js'
  },
  {
    what: 'downloadResult stops refusing an exam and writes the mark to a file',
    from: "  if (examSessionActive()) {\n    const el = $('studentFeedback');",
    to:   "  if (false) {\n    const el = $('studentFeedback');",
    suite: 'test_exam_view.js'
  },
  {
    what: 'the paper is left on screen after the exam is handed in',
    from: "      if (wasExam) retireExamPaper();",
    to:   "      if (false) retireExamPaper();",
    suite: 'test_exam_view.js'
  },
  {
    what: 'clearing un-submits the exam again, unlocking a re-sit',
    from: "  if (target === 'student' && studentSubmitted && examSessionActive()) {",
    to:   "  if (false) {",
    suite: 'test_exam_view.js'
  },
  {
    what: 'the submission is never read back, so success is only assumed',
    from: "      if (wasExam && traineeLoggedIn()) confirmExamRecorded(code);",
    to:   "      if (false) confirmExamRecorded(code);",
    suite: 'test_exam_confirm.js'
  },
  {
    what: 'a submission that did not register is reported as recorded',
    from: "  if (found && found.sitting && found.sitting.maySit === false) {",
    to:   "  if (found && found.sitting) {",
    suite: 'test_exam_confirm.js'
  },
  {
    what: 'a check that could not be made is reported as recorded',
    from: "  // Could not check at all: say that, rather than claiming either outcome.\n  el.innerHTML += '<p class=\"warn\">Could not confirm",
    to:   "  // Could not check at all: say that, rather than claiming either outcome.\n  el.innerHTML += '<p class=\"good\">Recorded. Could not confirm",
    suite: 'test_exam_confirm.js'
  },
  {
    what: 'the screen never comes back after the exam is submitted',
    from: "      setExamMode(false);\n      // The POST is opaque (no-cors), so \"it went through\" is an assumption",
    to:   "      // The POST is opaque (no-cors), so \"it went through\" is an assumption",
    suite: 'test_exam_view.js'
  },
  {
    what: 'the progress counter stops counting',
    from: "    $('studentQuizContainer').addEventListener('change', updateExamProgress);",
    to:   "    $('studentQuizContainer').addEventListener('change', () => {});",
    suite: 'test_exam_view.js'
  },
  {
    what: 'a legacy attempt is rebuilt on a fresh stream instead of the old one',
    from: "    selected = shuffle(selected, rng);\n  }\n  if (orderSeed) selected = shuffleChoicesOf(selected, orderSeed);",
    to:   "    selected = shuffle(selected, seededRandom(seed + '|order'));\n  }\n  if (orderSeed) selected = shuffleChoicesOf(selected, orderSeed);",
    suite: 'test_shuffle.js'
  }
];

/* The browser suites fetch the app over HTTP. If the server is rooted at a COPY
 * of the source tree, every app.js mutation below is patching a file the browser
 * never loads, and all of them "pass" while testing nothing. That happened. The
 * served path must therefore BE the source directory -- /tmp/ghpages/
 * energytech-mathquiz is a symlink to it -- and this checks that before the
 * results are worth reading. */
const SERVED = '/tmp/ghpages/energytech-mathquiz/app.js';
try {
  if (fs.realpathSync(SERVED) !== fs.realpathSync(APP)) {
    console.log('The served app.js is not the source app.js:');
    console.log('  served: ' + fs.realpathSync(SERVED));
    console.log('  source: ' + fs.realpathSync(APP));
    console.log('Browser mutations would patch a file nothing loads. Fix the server root first.');
    process.exit(1);
  }
} catch (err) {
  console.log('Cannot check what the server is serving (' + err.message + ').');
  process.exit(1);
}

let caught = 0, survived = [];
console.log('baseline:');
for (const suite of ['test_my_history.js', 'test_history.js', 'test_exam_release.js', 'test_shuffle.js', 'test_retake.js', 'test_exam_view.js', 'test_exam_confirm.js']) {
  try {
    execFileSync('node', ['/tmp/energytech_app/' + suite], { stdio: 'pipe' });
    console.log(`  clean   ${suite}`);
  } catch {
    console.log(`  BASELINE FAILS -- ${suite}. Nothing below means anything.`);
    process.exit(1);
  }
}
console.log('');

/* A mutation is a temporary edit to a REAL source file. If this process dies
 * between applying one and restoring it -- Ctrl-C, a kill, an uncaught throw --
 * the working tree is left silently patched, and whatever runs next reads a file
 * with a guard deleted from it. That happened: a killed run removed a line from
 * app.js, and the next test failed for a reason that had nothing to do with the
 * code under test. So the restore is a handler, not just the next statement. */
let inFlight = null;                    // { file, base } while a mutant is applied
function restoreInFlight() {
  if (!inFlight) return;
  try { fs.writeFileSync(inFlight.file, inFlight.base); } catch { /* nothing better to do */ }
  inFlight = null;
}
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(sig => process.on(sig, () => {
  restoreInFlight();
  console.log(`\n${sig}: source restored before exit.`);
  process.exit(130);
}));
process.on('uncaughtException', err => {
  restoreInFlight();
  console.log('Crashed, but the source was restored: ' + err.message);
  process.exit(1);
});
process.on('exit', restoreInFlight);

function runMutants(list, file, base) {
  for (const m of list) {
    if (!base.includes(m.from)) {
      console.log(`  SKIPPED  ${m.what}  (the code it patches has moved)`);
      survived.push(m.what + ' [pattern not found]');
      continue;
    }
    inFlight = { file, base };
    fs.writeFileSync(file, base.replace(m.from, m.to));
    let failed = false;
    try { execFileSync('node', ['/tmp/energytech_app/' + m.suite], { stdio: 'pipe' }); }
    catch { failed = true; }
    restoreInFlight();
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
