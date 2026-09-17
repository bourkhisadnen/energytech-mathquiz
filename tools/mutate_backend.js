/* Mutation test for the trainee's own-record route.
 *
 * The suite passing proves nothing on its own -- a guard that always returns
 * true passes every test that only ever exercises the allowed case. So each
 * guard is deliberately broken, one at a time, and the suite must fail. A
 * mutation that survives is a guard nothing is actually testing. */
const { execFileSync } = require('child_process');
const fs = require('fs');

const path = require('path');

const ROOT = path.join(__dirname, '..');
// Code.gs is retired: production runs src/actions/*.js against Postgres now,
// not this file, and every suite that used to catch a Code.gs mutation ran
// it in gas_stub.js, which retired with it (see the Phase 6 commits
// retiring test_backend.js and friends). CODE stays defined, and MUTANTS
// below stays in the file un-deleted, as the record of what Code.gs's rules
// were -- but neither is snapshotted, checked or run any more.
const CODE = path.join(ROOT, 'google_apps_script', 'Code.gs');
const APP = path.join(ROOT, 'app.js');
const WS = path.join(ROOT, 'worksheet_tex.js');
const SW = path.join(ROOT, 'service-worker.js');
const CSS = path.join(ROOT, 'style.css');

// Browser-driven suites (test_worksheet_ui.js, test_exam_dropped_response.js,
// and the rest once repointed) never load APP/WS/SW/CSS above directly --
// they fetch the app over HTTP from src/app.js, which serves
// energytech-api/public/, a SEPARATE copy kept in sync by hand (every
// "Write embedded worksheet scripts" / "Fix the Android radio-button bug"
// commit did this exact copy). A mutation applied only to ROOT's copy is
// invisible to any of those suites -- the same failure mode the realpath
// check further down exists to catch for the server root itself, one layer
// up. So every mutation to one of these four is mirrored onto its served
// twin for the duration of the run, and both are restored together.
const ENERGYTECH_API_ROOT = path.join(__dirname, '..', '..', 'energytech-api');
const SERVED_MIRROR = {
  [APP]: path.join(ENERGYTECH_API_ROOT, 'public', 'app.js'),
  [WS]: path.join(ENERGYTECH_API_ROOT, 'public', 'worksheet_tex.js'),
  [SW]: path.join(ENERGYTECH_API_ROOT, 'public', 'service-worker.js'),
  [CSS]: path.join(ENERGYTECH_API_ROOT, 'public', 'style.css'),
};

/* A mutation is a temporary edit to a REAL source file, and the process holding
 * that edit can die in ways no handler catches. The signal handlers further
 * down cover Ctrl-C and a clean SIGTERM, but execFileSync blocks the event loop
 * for the whole of each suite, so a SIGTERM that arrives mid-suite and is
 * followed by a hard kill never gets to run them. That happened: a run cut off
 * at a time limit left `if (built.images.length)` reading `if (false)` in
 * app.js, and everything tested afterwards was tested against a broken export
 * -- passing, because the tests were measuring the mutant.
 *
 * So the harness no longer trusts unwinding alone. It keeps a pristine copy of
 * each file on disk, drops a marker while one is patched, and puts the file
 * back on the next run if it finds that marker still there. */
const SNAP_DIR = path.join(__dirname, '.mutation-snapshot');
const MARKER = path.join(SNAP_DIR, 'in-flight.json');

function recoverOneFile(file, snapshot, label) {
  if (!snapshot || !fs.existsSync(snapshot)) return false;
  fs.copyFileSync(snapshot, file);
  console.log(`  ${label}${file}`);
  return true;
}
function recoverFromEarlierRun() {
  if (!fs.existsSync(MARKER)) return;
  let info = null;
  try { info = JSON.parse(fs.readFileSync(MARKER, 'utf8')); } catch { /* unreadable */ }
  if (info && info.file && recoverOneFile(info.file, info.snapshot, '')) {
    console.log('RECOVERED: an earlier run died holding a mutation.');
    console.log(`  was left as: ${info.what}`);
    if (info.mirror) recoverOneFile(info.mirror, info.mirrorSnapshot, '  and its served mirror: ');
    console.log('  Restored from the snapshot before anything else ran.\n');
  } else {
    console.log('A marker from an earlier run was found but its snapshot is gone.');
    console.log('Check the sources by hand before trusting anything below.\n');
  }
  try { fs.unlinkSync(MARKER); } catch { /* nothing better to do */ }
}
recoverFromEarlierRun();          // before the originals are read, or a leftover
                                  // mutation would be snapshotted as pristine

fs.mkdirSync(SNAP_DIR, { recursive: true });
const SNAPSHOT = {};
// CODE is deliberately excluded -- it is not patched any more, so there is
// nothing to snapshot it against. Each served mirror gets its own snapshot
// too, named apart from its ROOT twin (both are called app.js on disk).
[APP, WS, SW, CSS, ...Object.values(SERVED_MIRROR)].forEach(f => {
  const dest = path.join(SNAP_DIR, (SERVED_MIRROR[f] ? '' : 'served-') + path.basename(f));
  fs.copyFileSync(f, dest);
  SNAPSHOT[f] = dest;
});

const MUTANTS = [
  /* Covering instructors. Everything here is a rule that a page cannot enforce:
   * an instructor is a normal signed-in caller who can ask the backend
   * directly, so each of these mutants is the difference between a real
   * restriction and a decoration. */
  {
    what: 'roster_list stops filtering, so any instructor reads every group in the centre',
    from: "  const admin = auth.instructor.role === 'admin';\n  const mine = {};",
    to:   "  const admin = true;\n  const mine = {};",
    suite: 'test_backend.js'
  },
  {
    what: 'trainee_list stops checking the caller covers the group they asked for',
    from: "    if (!coversGroup_(auth, intake, group)) {\n      return { ok: false, error: 'That group is not assigned to you.' };\n    }",
    to:   "    if (false) {\n      return { ok: false, error: 'That group is not assigned to you.' };\n    }",
    suite: 'test_backend.js'
  },
  {
    what: 'an instructor may reset the password of any trainee, not only their own',
    from: "  if (!coversGroup_(auth, found.row[3], found.row[4])) {",
    to:   "  if (false) {",
    suite: 'test_backend.js'
  },
  {
    what: 'assigning groups stops being admin-only, so an instructor assigns themselves any group',
    from: "function adminSetInstructorGroups_(params) {\n  const auth = requireAdmin_(params);",
    to:   "function adminSetInstructorGroups_(params) {\n  const auth = requireAuth_(params);",
    suite: 'test_backend.js'
  },
  {
    what: 'a group that does not exist can be assigned, granting nothing while looking granted',
    from: "  if (unknown.length) {",
    to:   "  if (false) {",
    suite: 'test_backend.js'
  },
  {
    what: 'coversGroup_ says yes to everyone, which is every rule above at once',
    from: "  if (auth.instructor.role === 'admin') return true;\n  const want = normLabel_(intake)",
    to:   "  if (true) return true;\n  const want = normLabel_(intake)",
    suite: 'test_backend.js'
  },
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
  },

  /* --- resetting a forgotten password --- */
  {
    what: 'a reset instructor account is never asked to choose its own password',
    from: "  sheet.getRange(found.rowNumber, 13).setValue(true);",
    to:   "  ;",
    suite: 'test_password_reset.js'
  },
  {
    what: 'a reset trainee account is never asked to choose its own password',
    from: "  sheet.getRange(found.rowNumber, 12).setValue(true);",
    to:   "  ;",
    suite: 'test_password_reset.js'
  },
  {
    what: '"must change" stops being enforced, so a password read aloud keeps working',
    from: "  if (!flagged) return null;",
    to:   "  return null;",
    suite: 'test_password_reset.js'
  },
  {
    what: 'a reset leaves the old session alive on whatever device had it',
    from: "  sheet.getRange(found.rowNumber, 11, 1, 2).setValues([['', '']]);   // sign them out everywhere",
    to:   "  ;",
    suite: 'test_password_reset.js'
  },
  /* This used to be "any instructor, not only an admin, may reset a trainee's
   * password", patching requireAdmin_ to requireAuth_. That IS the code now:
   * an assigned instructor may reset their own trainees' passwords. The guard
   * that replaced it is the coversGroup_ check inside the function, and its
   * mutant lives with the other covering-instructor ones above. */
  {
    what: 'an admin may reset their own password, signing themselves out mid-action',
    from: "    return { ok: false, error: 'Use Change password to change your own. A reset is for somebody else\\'s account.' };",
    to:   "    ;",
    suite: 'test_password_reset.js'
  },
  {
    what: 'a trainee with no account is handed a password for a login that does not exist',
    from: "  if (status === 'none') {\n    return { ok: false, error: 'Trainee ' + id + ' has no account yet. They should use \"Create my account\" and choose their own password.' };\n  }",
    to:   "  if (false) {\n    return { ok: false, error: 'no account' };\n  }",
    suite: 'test_password_reset.js'
  },
  {
    what: 'a paper sat by a reset trainee is filed under whatever the browser typed',
    from: "    } else if (t.mustChangePassword) {",
    to:   "    } else if (false) {",
    suite: 'test_password_reset.js'
  },
  {
    what: 'changing the password does not clear the flag, so they are asked for ever',
    from: "  sheet.getRange(auth.rowNumber, 13).setValue('');    // they have chosen their own now",
    to:   "  ;",
    suite: 'test_password_reset.js'
  },

  /* --- setup() must never be the thing that loses the records --- */
  {
    what: 'setup() clears the sheets again, as it used to',
    from: "  if (sheet.getLastRow() === 0) sheet.appendRow(headers);",
    to:   "  sheet.clear(); sheet.appendRow(headers);",
    suite: 'test_report.js'
  },

  /* --- the report of one session --- */
  {
    what: 'a report may be opened on another instructor\'s session',
    from: "  if (!isAdmin && normalizeUsername_(row[12]) !== viewer) {\n    return { ok: false, error: 'That session belongs to another instructor.' };\n  }\n\n  const session = {",
    to:   "  if (false) {\n    return { ok: false, error: 'That session belongs to another instructor.' };\n  }\n\n  const session = {",
    suite: 'test_report.js'
  },
  {
    what: 'the report lists papers the viewer would not be allowed to open',
    from: "    if (!isAdmin && normalizeUsername_(r[19]) !== viewer) return;",
    to:   "    if (false) return;",
    suite: 'test_report.js'
  },
  {
    what: 'a retake stands on the first sitting rather than the latest',
    from: "    t.sittings.sort(function (a, b) { return String(b.timestamp).localeCompare(String(a.timestamp)); });",
    to:   "    t.sittings.sort(function (a, b) { return String(a.timestamp).localeCompare(String(b.timestamp)); });",
    suite: 'test_report.js'
  },
  {
    what: 'the report counts sittings rather than trainees, inflating every figure',
    from: "    const id = normId_(r[4]);\n    const known = roster[id];",
    to:   "    const id = String(r[1] || '');\n    const known = roster[normId_(r[4])];",
    suite: 'test_report.js'
  },
  {
    what: 'the absent list ignores which group the session was for',
    from: "      if (String(r[4] || '').trim().toUpperCase() !== session.group.trim().toUpperCase()) return;",
    to:   "      if (false) return;",
    suite: 'test_report.js'
  }
];

/* The shuffle lives in app.js, not Code.gs, so it gets its own patch target. */
// APP is declared at the top, with the snapshot machinery.
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
    suite: 'test_exam_dropped_response.js'
  },
  {
    what: 'a submission that did not register is reported as recorded',
    from: "  if (found && found.sitting && found.sitting.maySit === false) {",
    to:   "  if (found && found.sitting) {",
    suite: 'test_exam_dropped_response.js'
  },
  {
    what: 'a check that could not be made is reported as recorded',
    from: "  // Could not check at all: say that, rather than claiming either outcome.\n  el.innerHTML += '<p class=\"warn\">Could not confirm",
    to:   "  // Could not check at all: say that, rather than claiming either outcome.\n  el.innerHTML += '<p class=\"good\">Recorded. Could not confirm",
    suite: 'test_exam_dropped_response.js'
  },
  {
    // The code this guarded is still live -- submitOnlineResult still calls
    // setExamMode(false) once the paper is handed in -- but the `from`
    // pattern had rotted onto the COMMENT beside it, which has been rewritten
    // twice since (Phase 5's fetch rewrite, then this migration's
    // confirmExamRecorded-from-the-catch-branch change), most recently
    // without anyone touching this file. Re-anchored on the call itself
    // (6-space indent), which is unique -- the same call three thousand lines
    // away, in the my-history "leave the exam view" path, sits at 4 spaces.
    what: 'the screen never comes back after the exam is submitted',
    from: "      setExamMode(false);",
    to:   "      if (false) setExamMode(false);",
    suite: 'test_exam_view.js'
  },
  {
    what: 'the progress counter stops counting',
    from: "    $('studentQuizContainer').addEventListener('change', updateExamProgress);",
    to:   "    $('studentQuizContainer').addEventListener('change', () => {});",
    suite: 'test_exam_view.js'
  },
  /* --- resetting a forgotten password, on the screen ---
   * test_password_reset_ui.js, the suite these four name, was orphaned for
   * years -- checked against this repo's full git history at the time; there
   * was no record of it ever existing, though the behaviour was always real
   * and current. It has been written now, against the real backend, and is
   * in the baseline list below. */
  {
    what: 'the app opens the interface anyway, so the temporary password is enough to work with',
    from: "    if (data.mustChangePassword) {\n      if ($('teacherLoginPassword')) $('teacherLoginPassword').value = '';",
    to:   "    if (false) {\n      if ($('teacherLoginPassword')) $('teacherLoginPassword').value = '';",
    suite: 'test_password_reset_ui.js'
  },
  {
    what: 'a reset trainee is let straight through to the quiz screen',
    from: "    if (data.mustChangePassword) {\n      if ($('traineeLoginPassword')) $('traineeLoginPassword').value = '';",
    to:   "    if (false) {\n      if ($('traineeLoginPassword')) $('traineeLoginPassword').value = '';",
    suite: 'test_password_reset_ui.js'
  },
  {
    what: 'the form accepts the temporary password as the new one',
    from: "  if (pw === forcedChange.oldPassword) {",
    to:   "  if (false) {",
    suite: 'test_password_reset_ui.js'
  },
  {
    what: 'the lone admin is never told nobody can reset them',
    from: "  const admins = list.filter(i => i.role === 'admin' && i.status === 'approved');",
    to:   "  const admins = list.filter(i => false);\n  admins.push(1, 2);",
    suite: 'test_password_reset_ui.js'
  },
  /* Retired, not reassigned: this one specifically is gone, not just
   * untested. It detects a JSONP-era Apps Script deployment answering a
   * bare "backend is running" instead of real fields -- a shape that only
   * ever came from Code.gs, over no-cors. Phase 5 replaced that transport
   * with a real fetch to /api/call, which cannot produce this shape, and the
   * served copy (energytech-api/public/app.js) has already dropped this
   * code entirely -- confirmed absent, not just unreached. Left in
   * app.js's own mathquiz copy as a leftover of the transport this repo no
   * longer runs. */

  /* --- the explanation video on the question it belongs to --- */
  {
    what: 'the video stops being withheld on an exam, naming the method for a marked question',
    from: "  return mode !== 'assessment' && reveal !== false;",
    to:   "  return reveal !== false;",
    suite: 'test_card_video.js'
  },
  {
    what: 'every card gets a video, not only the ones they got wrong',
    from: "      setCardVideo(card, q, false);       // cleared here, added back below only if wrong",
    to:   "      setCardVideo(card, q, showExplanationVideos(reveal));",
    suite: 'test_card_video.js'
  },
  {
    what: 'the card link is not cleared before it is added, so marking twice stacks them',
    from: "  const existing = card.querySelector('.card-video');\n  if (existing) existing.remove();",
    to:   "  ;",
    suite: 'test_card_video.js'
  },
  {
    what: 'every card is given the first question\'s video instead of its own',
    from: "  const url = explanationLinkForQuestion(q);\n  if (!url) return;                       // no video for this one; the list says so",
    to:   "  const url = explanationLinkForQuestion(currentQuiz[0]);\n  if (!url) return;",
    suite: 'test_card_video.js'
  },
  {
    what: 'clearing the answers leaves the videos behind, still naming the wrong ones',
    from: "    const video = card.querySelector('.card-video');\n    if (video) video.remove();",
    to:   "    ;",
    suite: 'test_card_video.js'
  },
  {
    what: 'a reviewed paper puts a video on every question, not only the missed ones',
    from: "      ${verdict === 'wrong' ? reviewVideoLink(q) : ''}",
    to:   "      ${reviewVideoLink(q)}",
    suite: 'test_card_video.js'
  },
  {
    what: 'every reviewed question is given the first question\'s video',
    from: "  const url = q ? explanationLinkForQuestion(q) : '';",
    to:   "  const url = q ? (window.EXPLANATION_VIDEO_LINKS.ch12 || {})['1'] : '';",
    suite: 'test_card_video.js'
  },
  {
    what: 'a legacy attempt is rebuilt on a fresh stream instead of the old one',
    from: "    selected = shuffle(selected, rng);\n  }\n  if (orderSeed) selected = shuffleChoicesOf(selected, orderSeed);",
    to:   "    selected = shuffle(selected, seededRandom(seed + '|order'));\n  }\n  if (orderSeed) selected = shuffleChoicesOf(selected, orderSeed);",
    suite: 'test_shuffle.js'
  },

  /* --- the report of one session --- */
  {
    what: 'the report pass mark slips to the 50 used by the other score bands',
    from: "const REPORT_PASS_MARK = 70;",
    to:   "const REPORT_PASS_MARK = 50;",
    suite: 'test_report_ui.js'
  },
  {
    what: 'the report colours rows on 80/50 instead of pass and fail',
    from: "const reportBand = p => (p >= REPORT_PASS_MARK ? 'good' : 'bad');",
    to:   "const reportBand = p => scoreBand(p);",
    suite: 'test_report_ui.js'
  },
  {
    what: 'trainees are listed best first, burying whoever needs help',
    from: "  return a.percent - b.percent || String(a.name || '').localeCompare(String(b.name || ''));",
    to:   "  return b.percent - a.percent || String(a.name || '').localeCompare(String(b.name || ''));",
    suite: 'test_report_ui.js'
  },
  {
    what: 'groups come out in name order rather than weakest first',
    from: "  }).sort((a, b) => a.stats.average - b.stats.average || String(a.name).localeCompare(String(b.name)));",
    to:   "  }).sort((a, b) => String(a.name).localeCompare(String(b.name)));",
    suite: 'test_report_ui.js'
  },
  {
    what: 'full marks are counted off the rounded percentage, so 299/300 becomes one',
    from: "    full: list.filter(t => t.total > 0 && t.score === t.total).length,",
    to:   "    full: list.filter(t => t.percent >= 100).length,",
    suite: 'test_report_ui.js'
  },
  {
    what: 'the sessions list is left on screen underneath the report',
    from: "  if ($('sessionsWorkspace')) $('sessionsWorkspace').hidden = true;",
    to:   "  if ($('sessionsWorkspace')) $('sessionsWorkspace').hidden = false;",
    suite: 'test_report_ui.js'
  },
  {
    what: 'the report is never marked open, so printing prints the whole app',
    from: "  document.body.classList.add('report-open');",
    to:   "  document.body.classList.remove('report-open');",
    suite: 'test_report_ui.js'
  },
  {
    what: 'Back from a paper leaves the instructor nowhere',
    from: "      if (t.closest('.back-to-profile')) { renderSessionReport(); return true; }",
    to:   "      if (t.closest('.back-to-profile')) { return true; }",
    suite: 'test_report_ui.js'
  },
  {
    what: 'only exams get a Report button',
    from: '        <td class="row-actions"><button type="button" class="icon-btn open-report"\n             data-code="${escapeHtml(s.sessionCode)}">Report</button>${exam',
    to:   '        <td class="row-actions">${exam',
    suite: 'test_report_ui.js'
  },
  {
    what: 'an opened paper does not say whose it is',
    from: "        ${view.self ? '' : `<p class=\"profile-sub attempt-who\">",
    to:   "        ${true ? '' : `<p class=\"profile-sub attempt-who\">",
    suite: 'test_report_ui.js'
  },
  {
    what: 'the group name leaves the table head, so print stops repeating it',
    from: "          <thead>\n            <!-- The group name lives in the thead",
    to:   "          <thead></thead><tbody>\n            <!-- The group name lives in the thead",
    suite: 'test_report_ui.js'
  },
  {
    what: 'the group table stops saying which group it is',
    from: '            <tr><th class="group-th" colspan="4">Group ${escapeHtml(g.name)}',
    to:   '            <tr><th class="group-th" colspan="4">Results',
    suite: 'test_report_ui.js'
  },

  /* Chapter 12A. The dangerous one is the key: the chapter is called 12A, but
   * 'ch12' already means Chapters 01 & 02 in session codes sitting in the
   * Sheet, so the two must never be run together. */
  {
    what: "Chapter 12A takes the 'ch12' key, so old session codes serve the wrong paper",
    from: "  ch12: { label: 'Chapters 01 & 02', sets: () => window.QUESTION_BANK_SETS || {} },",
    to:   "  ch12: { label: 'Chapter 12A', sets: () => window.QUESTION_BANK_SETS_CH12A || {} },",
    suite: 'test_ch12a.js'
  },
  {
    what: 'Chapter 12A is registered but its papers come from another chapter',
    from: "  ch12a: { label: 'Chapter 12A', sets: () => window.QUESTION_BANK_SETS_CH12A || {} }",
    to:   "  ch12a: { label: 'Chapter 12A', sets: () => window.QUESTION_BANK_SETS_CH03 || {} }",
    suite: 'test_ch12a.js'
  },
  {
    what: 'segment names lose their bar, so DE reads as D times E',
    from: "  s = s.replace(/\\\\overline\\{([^{}]*)\\}/g, '<span class=\"overline\">$1</span>');",
    to:   "  ;",
    suite: 'test_ch12a.js'
  },
  {
    what: "Heron's formula loses its root sign",
    from: "  s = replaceSqrt(s);",
    to:   "  ;",
    suite: 'test_ch12a.js'
  },
  {
    what: 'the radicand is closed at the first brace rather than the matching one',
    from: "      if (s[j] === '{') depth++;\n      else if (s[j] === '}') depth--;",
    to:   "      if (s[j] === '}') depth--;",
    suite: 'test_ch12a.js'
  },

  /* Chapter 04. It never carried the historical 'ch12' key confusion Chapter
   * 12A did, but the same "registered under its own name, papers come from
   * somewhere else" mistake is just as possible to make by hand. */
  {
    what: 'the roster is drawn as editable for everyone, offering an instructor controls that will be refused',
    from: "function rosterCanEdit() {\n  return rosterViewer ? Boolean(rosterViewer.canEdit) : isAdmin();",
    to:   "function rosterCanEdit() {\n  return true;",
    suite: 'test_instructor_roster.js'
  },
  {
    what: "the roster card goes back to being hidden from anyone who is not an admin",
    from: "  if (intakeSection) intakeSection.hidden = false;",
    to:   "  if (intakeSection) intakeSection.hidden = !isAdmin();",
    suite: 'test_instructor_roster.js'
  },
  {
    what: 'the search index is built with one unscoped call again, which the backend refuses',
    from: "    if (rosterCanEdit()) {\n      const data = await rosterCall('trainee_list', { token: authToken }, 'energytechTraineeAll');",
    to:   "    if (true) {\n      const data = await rosterCall('trainee_list', { token: authToken }, 'energytechTraineeAll');",
    suite: 'test_instructor_roster.js'
  },
  /* The collapsible instructor cards. The first of these is the one worth
   * holding down: lifting every heading to the top of its card looks tidier
   * and quietly breaks "My sessions", whose heading lives inside a container
   * the app hides wholesale to show a session report. */
  {
    what: 'every card heading is lifted to the top of its card, stranding "My sessions" above an open report',
    from: "    h2.parentNode.insertBefore(head, h2);",
    to:   "    panel.insertBefore(head, panel.firstChild);",
    suite: 'test_panels.js'
  },
  {
    what: 'a folded card is not remembered, so the page resets itself every visit',
    from: "      writePanelState(saved);",
    to:   "      ;",
    suite: 'test_panels.js'
  },
  /* Retired in this exact shape, not reassigned: PANELS_COLLAPSED_BY_DEFAULT
   * itself now genuinely differs between the two copies, on purpose --
   * ['connectionPanel'] here (this file still has that card), ['passwordPanel']
   * in energytech-api/public/app.js (Phase 5 dropped the card entirely; see
   * that file's own comment on the constant). test_panels.js was repointed to
   * drive the REAL served page, so it no longer reads this file's copy of the
   * constant at all -- mutating the VALUE here proves nothing about what a
   * trainee-facing regression would actually do, and mutating the served
   * mirror's different value under this same from/to would fail the pre-flight
   * check that the pattern exists in THIS file first. The mutation below tests
   * the shared lookup mechanism instead, which is still byte-identical in both
   * copies and is what a regression in either one would actually have to break. */
  {
    what: 'nothing starts folded by default any more, whichever panel that used to be',
    from: "      : PANELS_COLLAPSED_BY_DEFAULT.includes(panel.id));",
    to:   "      : false);",
    suite: 'test_panels.js'
  },
  {
    what: 'Chapter 04 is registered but its papers come from another chapter',
    from: "  ch04: { label: 'Chapter 04', sets: () => window.QUESTION_BANK_SETS_CH04 || {} }",
    to:   "  ch04: { label: 'Chapter 04', sets: () => window.QUESTION_BANK_SETS_CH12A || {} }",
    suite: 'test_ch04.js'
  }
];

/* The worksheet exporter is a third file, and a third patch target. Most of
 * these are LaTeX-level: they only show up when pdflatex is actually run over a
 * paper drawn from the real bank, which is what test_worksheet.js does. */
// WS is declared at the top, with the snapshot machinery.
const wsOriginal = fs.readFileSync(WS, 'utf8');
const WS_MUTANTS = [
  {
    what: 'a session name stops being escaped, so one & kills the compile',
    from: "    .replace(/([&%$#_{}])/g, '\\\\$1')",
    to:   "    .replace(/([&%#_{}])/g, '$1')",
    suite: 'test_worksheet.js'
  },
  {
    what: 'a paragraph break run into the next sentence is left as one control sequence',
    from: "  s = s.replace(/\\\\par(?=[A-Z])/g, '\\\\par ');",
    to:   "  s = s;",
    suite: 'test_worksheet.js'
  },
  {
    what: 'the split also breaks \\parbox, which is a real macro',
    from: "  s = s.replace(/\\\\par(?=[A-Z])/g, '\\\\par ');",
    to:   "  s = s.replace(/\\\\par(?=[A-Za-z])/g, '\\\\par ');",
    suite: 'test_worksheet.js'
  },
  {
    what: 'the diagram placeholder is left in the worksheet',
    from: "  s = s.replace(/\\[\\[DIAGRAM\\]\\]/g, diagramTex || '');",
    to:   "  s = s;",
    suite: 'test_worksheet.js'
  },
  {
    what: 'the tape ruler is handed its reading where its scale should go',
    from: "\\\\taperuler{${Number(d.start)}}{${Number(d.end)}}{${Number(d.reading)}}",
    to:   "\\\\taperuler{${Number(d.reading)}}{${Number(d.start)}}{${Number(d.end)}}",
    suite: 'test_worksheet.js'
  },
  {
    what: 'an image keeps its folder, which is not where the bundle puts it',
    from: "    const file = worksheetImageSrc(d.src).replace(/^.*\\//, '');",
    to:   "    const file = worksheetImageSrc(d.src);",
    suite: 'test_worksheet.js'
  },
  {
    what: 'the same image is bundled once per question that uses it',
    from: "      if (out.indexOf(src) === -1) out.push(src);",
    to:   "      out.push(src);",
    suite: 'test_worksheet.js'
  },
  {
    what: 'the mastery table numbers questions from zero',
    from: "    byLesson[lesson].push(idx + 1);",
    to:   "    byLesson[lesson].push(idx);",
    suite: 'test_worksheet.js'
  },
  {
    what: 'two consecutive questions are written as a range',
    from: "    if (j - i >= 2) parts.push(`Q${sorted[i]}--Q${sorted[j]}`);",
    to:   "    if (j - i >= 1) parts.push(`Q${sorted[i]}--Q${sorted[j]}`);",
    suite: 'test_worksheet.js'
  },
  {
    what: 'an empty paper exports as a blank worksheet instead of being refused',
    from: "  if (!questions.length) throw new Error('There are no questions to export.');",
    to:   "  if (false) throw new Error('There are no questions to export.');",
    suite: 'test_worksheet.js'
  },
  {
    what: 'the answer key is written in a different order from the paper',
    from: "    jsArray('ANSWER', questions.map(q => String(q.answer || 'a').trim())),",
    to:   "    jsArray('ANSWER', questions.map(q => String(q.answer || 'a').trim()).slice().sort()),",
    suite: 'test_worksheet.js'
  },
  {
    what: 'pdfLaTeX is not told what a real minus sign is',
    from: "\\DeclareUnicodeCharacter{2212}{\\ensuremath{-}}",
    to:   "% no minus declaration",
    suite: 'test_worksheet.js'
  },
  {
    what: 'pdfLaTeX is not told what a superscript four is',
    from: "\\DeclareUnicodeCharacter{2074}{\\ensuremath{^{4}}}",
    to:   "% no superscript-four declaration",
    suite: 'test_worksheet.js'
  },
  {
    what: 'a fraction outside math mode is left to stop the compile',
    from: "\\let\\ETdfrac\\dfrac  \\renewcommand{\\dfrac}[2]{\\ensuremath{\\ETdfrac{#1}{#2}}}",
    to:   "% no dfrac guard",
    suite: 'test_worksheet.js'
  },
  {
    what: 'the zip checksums every entry as zero',
    from: "  let c = 0 ^ (-1);",
    to:   "  return 0; let c = 0 ^ (-1);",
    suite: 'test_worksheet.js'
  },

  /* --- the fillable header --- */
  {
    what: 'the header fields are closed before the last page ships, orphaning its boxes',
    from: "  \\clearpage\n  \\ws@closetext{Name}%",
    to:   "  \\ws@closetext{Name}%",
    suite: 'test_worksheet.js'
  },
  {
    what: 'a header box is left bare in the line, so it lands a slot early',
    from: "  \\leavevmode\\makebox[#2][l]{%",
    to:   "  \\leavevmode{%",
    suite: 'test_worksheet.js'
  },
  {
    what: 'one of the header fields is never closed into a field at all',
    from: "  \\ws@closetext{Group}%",
    to:   "  %",
    suite: 'test_worksheet.js'
  },
  {
    what: 'Clear all goes back to bare resetForm(), which empties the name too',
    from: "    doc.resetForm(fields);",
    to:   "    doc.resetForm();",
    suite: 'test_worksheet.js'
  },

  /* Both of these shipped and came back from the instructor, so both are now
   * held down. Each one alone empties every drawing out of a Chapter 12A
   * worksheet or stops the compile outright. */
  {
    what: "the worksheet is handed the screen's SVG, which pdflatex cannot read",
    from: "  return String(src || '').replace(/\\.svg$/i, '.pdf');",
    to:   "  return String(src || '');",
    suite: 'test_worksheet.js'
  },
  {
    what: 'the picture is bundled as PDF but the document still asks for the SVG',
    from: "    const file = worksheetImageSrc(d.src).replace(/^.*\\//, '');",
    to:   "    const file = String(d.src).replace(/^.*\\//, '');",
    suite: 'test_worksheet.js'
  },
  {
    what: 'the angle sign is left undeclared, so every geometry question stops the compile',
    from: "\\DeclareUnicodeCharacter{2220}{\\ensuremath{\\angle}}",
    to:   "%",
    suite: 'test_worksheet.js'
  },
  {
    what: 'the parallel sign is left undeclared',
    from: "\\DeclareUnicodeCharacter{2225}{\\ensuremath{\\parallel}}",
    to:   "%",
    suite: 'test_worksheet.js'
  }
];

const WS_APP_MUTANTS = [
  {
    what: 'the worksheet is never offered after a session is created',
    from: "  showWorksheetExport();",
    to:   "  ;",
    suite: 'test_worksheet_ui.js'
  },
  {
    what: 'Overleaf is not told to use pdfLaTeX, and the machinery is pdfTeX-only',
    from: "  const fields = { engine: 'pdflatex' };",
    to:   "  const fields = {};",
    suite: 'test_worksheet_ui.js'
  },
  {
    what: 'a paper with photographs is posted as bare LaTeX, without them',
    from: "  if (built.images.length) {",
    to:   "  if (false) {",
    suite: 'test_worksheet_ui.js'
  },
  {
    what: 'the export sends a fresh draw rather than the paper the code was made from',
    from: "  const built = WorksheetExport.buildWorksheetTex(currentSession, currentQuiz);",
    to:   "  const built = WorksheetExport.buildWorksheetTex(currentSession, selectQuestionsFor(Object.assign({}, currentSession, { seed: 'other' })).selected);",
    suite: 'test_worksheet_ui.js'
  }
];

/* The service worker is a fourth patch target. It got one the day a missing
 * comma in its precache list was found: the file had not parsed, so
 * register() rejected, app.js swallowed the rejection, and the app quietly had
 * no offline support at all for weeks. Nothing caught it because every suite
 * drives the page over a live server, where a dead service worker looks
 * exactly like a working one. test_appshell.js registers it for real. */
const swOriginal = fs.readFileSync(SW, 'utf8');

/* Stylesheet mutants. Only worth having where the LAYOUT is the bug -- here,
 * a row-actions cell that collapsed to nothing and let its buttons sit on top
 * of the account badge. A test that measures geometry is the only kind that
 * notices, so this proves the measurement is real. */
const cssOriginal = fs.readFileSync(CSS, 'utf8');
const CSS_MUTANTS = [
  {
    what: 'the row actions column collapses over the account badge again',
    from: ".roster-table .row-actions { display: flex; gap: 4px; justify-content: flex-end; min-width: max-content; }",
    to:   ".roster-table .row-actions { display: flex; gap: 4px; justify-content: flex-end; }",
    suite: 'test_instructor_roster.js'
  }
];

const SW_MUTANTS = [
  {
    what: 'the precache list loses a comma, so the worker does not parse and never registers',
    from: "  './images/ch03_q68_screw.jpg',",
    to:   "  './images/ch03_q68_screw.jpg'",
    suite: 'test_appshell.js'
  },
  {
    what: 'the worker promises to precache a file that is not there, failing the whole install',
    from: "  './icon-192.png',",
    to:   "  './icon-192-missing.png',",
    suite: 'test_appshell.js'
  }
];

/* The browser suites fetch the app over HTTP. If the server is rooted at a COPY
 * of the source tree, every app.js mutation below is patching a file the browser
 * never loads, and all of them "pass" while testing nothing. That happened
 * (claude/12-exam-page-and-leak.md) via a static file server pointed at a copy
 * instead of a symlink to the source.
 *
 * D3 removed that whole class of failure for test_roster.js specifically:
 * energytech-api/src/app.js now serves the front-end itself, straight off
 * energytech-api/public/ with express.static(), in the same process the test
 * requires and starts. There is no separate static server and no symlink left
 * to check. What CAN still drift is src/app.js's own static-root argument, if
 * a later change points it at a build/dist copy instead of public/ directly --
 * so that argument is read back out of the live source and resolved for real,
 * not just asserted against itself, before the mutation results are worth
 * reading. */
// ENERGYTECH_API_ROOT is declared near the top of the file, alongside
// SERVED_MIRROR.
const ENERGYTECH_API_SRC_APP = path.join(ENERGYTECH_API_ROOT, 'src', 'app.js');
const ENERGYTECH_API_PUBLIC_APP = path.join(ENERGYTECH_API_ROOT, 'public', 'app.js');

function resolveServedAppJs() {
  const source = fs.readFileSync(ENERGYTECH_API_SRC_APP, 'utf8');
  const m = source.match(/express\.static\(path\.join\(__dirname,\s*([^)]+)\)\)/);
  if (!m) throw new Error(`could not find an express.static(path.join(__dirname, ...)) call in ${ENERGYTECH_API_SRC_APP}`);
  const segments = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
  return path.join(path.dirname(ENERGYTECH_API_SRC_APP), ...segments, 'app.js');
}

try {
  const served = resolveServedAppJs();
  if (fs.realpathSync(served) !== fs.realpathSync(ENERGYTECH_API_PUBLIC_APP)) {
    console.log('The path src/app.js serves is not energytech-api/public/app.js:');
    console.log('  served: ' + fs.realpathSync(served));
    console.log('  source: ' + fs.realpathSync(ENERGYTECH_API_PUBLIC_APP));
    console.log('Browser mutations would patch a file nothing loads. Fix the server root first.');
    process.exit(1);
  }
} catch (err) {
  console.log('Cannot check what the server is serving (' + err.message + ').');
  process.exit(1);
}

/* Every mutant patches a string that must actually be in the file. If one is
 * missing the source has either moved on or is still carrying a mutation from a
 * run that died -- and in the second case every result below would be measuring
 * the mutant rather than the code. Checked up front and fatal, rather than
 * reported as SKIPPED two hundred lines into the output where it reads like a
 * footnote. */
{
  const sources = { [APP]: appOriginal, [WS]: wsOriginal, [SW]: swOriginal, [CSS]: cssOriginal };
  const missing = [];
  // MUTANTS/CODE excluded -- retired along with Code.gs, not checked, not run.
  [[APP_MUTANTS, APP], [WS_MUTANTS, WS], [WS_APP_MUTANTS, APP],
   [SW_MUTANTS, SW], [CSS_MUTANTS, CSS]]
    .forEach(([list, file]) => list.forEach(m => {
      if (!sources[file].includes(m.from)) missing.push(`${path.basename(file)}: ${m.what}`);
    }));
  if (missing.length) {
    console.log('The sources do not match what the mutants expect:\n');
    missing.forEach(s => console.log('  ' + s));
    console.log('\nEither the code has moved on and these patterns need updating, or a');
    console.log('previous run died holding a mutation and the file is still patched.');
    console.log('Nothing below would mean anything, so this run stops here.');
    process.exit(1);
  }
}

/* Unlike a stale `from` (fatal -- every later result would be measuring the
 * mutant), a mutant naming a suite that does not exist on disk (this is how
 * the four test_password_reset_ui.js mutations sat for years before that
 * suite was written) is reported up front, not fatal -- stopping the whole
 * run for it would hide every other result behind it -- and skipped below
 * rather than let execFileSync's ENOENT be mistaken for a caught mutation.
 * A missing suite proves nothing about the guard it was meant to test. */
const missingSuites = new Set();
{
  const allMutants = [...APP_MUTANTS, ...WS_MUTANTS, ...WS_APP_MUTANTS, ...SW_MUTANTS, ...CSS_MUTANTS];
  allMutants.forEach(m => {
    if (!fs.existsSync(path.join(__dirname, m.suite))) missingSuites.add(m.suite);
  });
  if (missingSuites.size) {
    console.log('No suite on disk for:');
    [...missingSuites].forEach(s => console.log('  ' + s));
    console.log('Every mutant naming one of these is reported separately below, not run.\n');
  }
}

let caught = 0, survived = [], noSuite = [];
console.log('baseline:');
// test_my_history.js, test_history.js, test_exam_release.js, test_retake.js,
// test_report.js and test_password_reset.js are retired (gas_stub, superseded
// by energytech-api/tests/*.test.js -- see the Phase 6 backfill commits).
// test_exam_confirm.js was renamed test_exam_dropped_response.js when its
// premise inverted (claude/11-exam-handed-in.md in energytech-api).
for (const suite of ['test_shuffle.js', 'test_exam_view.js', 'test_exam_dropped_response.js', 'test_report_ui.js', 'test_worksheet.js', 'test_worksheet_ui.js', 'test_card_video.js', 'test_password_reset_ui.js', 'test_panels.js']) {
  try {
    execFileSync('node', [path.join(__dirname, suite)], { stdio: 'pipe' });
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
let inFlight = null;                    // { file, base, mirror } while a mutant is applied
function restoreInFlight() {
  if (!inFlight) return;
  try { fs.writeFileSync(inFlight.file, inFlight.base); } catch { /* nothing better to do */ }
  if (inFlight.mirror) {
    try { fs.copyFileSync(SNAPSHOT[inFlight.mirror], inFlight.mirror); } catch { /* nothing better to do */ }
  }
  try { if (fs.existsSync(MARKER)) fs.unlinkSync(MARKER); } catch { /* ditto */ }
  inFlight = null;
}

/* Written to disk BEFORE the file is patched and removed after it is put back.
 * The in-memory restore above is the fast path; this is what survives a kill
 * the process never gets to see. */
function markInFlight(file, mirror, what) {
  try {
    fs.writeFileSync(MARKER, JSON.stringify(
      { file, snapshot: SNAPSHOT[file], mirror: mirror || null, mirrorSnapshot: mirror ? SNAPSHOT[mirror] : null, what },
      null, 1
    ));
  } catch { /* the run is still correct, only the crash recovery is lost */ }
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
  const mirror = SERVED_MIRROR[file] || null;
  for (const m of list) {
    if (missingSuites.has(m.suite)) {
      console.log(`  NO SUITE ${m.what}  (${m.suite} does not exist)`);
      noSuite.push(m.what + ` [${m.suite}]`);
      continue;
    }
    if (!base.includes(m.from)) {
      console.log(`  SKIPPED  ${m.what}  (the code it patches has moved)`);
      survived.push(m.what + ' [pattern not found]');
      continue;
    }
    inFlight = { file, base, mirror };
    markInFlight(file, mirror, m.what);
    fs.writeFileSync(file, base.replace(m.from, m.to));
    // The mirror is a SEPARATE file, not a copy of `base` -- app.js and
    // service-worker.js have diverged from their ROOT twins since Phase 5
    // (only worksheet_tex.js and style.css still match byte for byte).
    // Writing `base`'s mutated content over the mirror would silently
    // replace the real served file with a different, wrong one for the
    // whole mutation window. So the same from/to is applied to the mirror's
    // OWN current content instead, touching only the matched snippet -- and
    // if that snippet is not there, the mirror is left alone and the result
    // below is flagged rather than trusted.
    let mirrorPatched = null;
    if (mirror) {
      const mirrorBase = fs.readFileSync(mirror, 'utf8');
      if (mirrorBase.includes(m.from)) {
        fs.writeFileSync(mirror, mirrorBase.replace(m.from, m.to));
        mirrorPatched = true;
      } else {
        mirrorPatched = false;
      }
    }
    let failed = false;
    try { execFileSync('node', [path.join(__dirname, m.suite)], { stdio: 'pipe' }); }
    catch { failed = true; }
    restoreInFlight();
    const mirrorNote = mirrorPatched === false
      ? `  [served ${path.basename(mirror)} does not contain this pattern -- only ROOT was mutated; a browser-driven result here may not mean what it looks like]`
      : '';
    if (failed) { caught++; console.log(`  caught   ${m.what}  (${m.suite})${mirrorNote}`); }
    else { survived.push(m.what + (mirrorNote ? ' [mirror not patched]' : '')); console.log(`  SURVIVED ${m.what}  (${m.suite})${mirrorNote}`); }
  }
}

// MUTANTS/CODE excluded -- retired along with Code.gs.
runMutants(APP_MUTANTS, APP, appOriginal);
runMutants(WS_MUTANTS, WS, wsOriginal);
runMutants(WS_APP_MUTANTS, APP, appOriginal);
runMutants(SW_MUTANTS, SW, swOriginal);
runMutants(CSS_MUTANTS, CSS, cssOriginal);

const total = APP_MUTANTS.length + WS_MUTANTS.length + WS_APP_MUTANTS.length
            + SW_MUTANTS.length + CSS_MUTANTS.length;
console.log(`\n${caught} of ${total} broken guards were caught by the tests.`);
if (noSuite.length) {
  console.log(`\nNO SUITE TO RUN (${noSuite.length}, not counted above or below):`);
  noSuite.forEach(s => console.log('  ' + s));
}
if (survived.length) {
  console.log('\nNOT ACTUALLY TESTED:');
  survived.forEach(s => console.log('  ' + s));
  process.exit(1);
}
if (noSuite.length) process.exit(1);
