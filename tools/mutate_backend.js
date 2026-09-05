/* Mutation test for the trainee's own-record route.
 *
 * The suite passing proves nothing on its own -- a guard that always returns
 * true passes every test that only ever exercises the allowed case. So each
 * guard is deliberately broken, one at a time, and the suite must fail. A
 * mutation that survives is a guard nothing is actually testing. */
const { execFileSync } = require('child_process');
const fs = require('fs');

const path = require('path');

const ROOT = '/tmp/energytech_app/energytech_quiz_app_session_sync_fixed';
const CODE = ROOT + '/google_apps_script/Code.gs';
const APP = ROOT + '/app.js';
const WS = ROOT + '/worksheet_tex.js';

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
const SNAP_DIR = '/tmp/energytech_app/.mutation-snapshot';
const MARKER = path.join(SNAP_DIR, 'in-flight.json');

function recoverFromEarlierRun() {
  if (!fs.existsSync(MARKER)) return;
  let info = null;
  try { info = JSON.parse(fs.readFileSync(MARKER, 'utf8')); } catch { /* unreadable */ }
  if (info && info.file && info.snapshot && fs.existsSync(info.snapshot)) {
    fs.copyFileSync(info.snapshot, info.file);
    console.log('RECOVERED: an earlier run died holding a mutation.');
    console.log(`  ${info.file}`);
    console.log(`  was left as: ${info.what}`);
    console.log('  It has been restored from the snapshot before anything else ran.\n');
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
[CODE, APP, WS].forEach(f => {
  const dest = path.join(SNAP_DIR, path.basename(f));
  fs.copyFileSync(f, dest);
  SNAPSHOT[f] = dest;
});

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
    from: "    const file = String(d.src).replace(/^.*\\//, '');",
    to:   "    const file = String(d.src);",
    suite: 'test_worksheet.js'
  },
  {
    what: 'the same image is bundled once per question that uses it',
    from: "      if (out.indexOf(q.diagram.src) === -1) out.push(q.diagram.src);",
    to:   "      out.push(q.diagram.src);",
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

/* Every mutant patches a string that must actually be in the file. If one is
 * missing the source has either moved on or is still carrying a mutation from a
 * run that died -- and in the second case every result below would be measuring
 * the mutant rather than the code. Checked up front and fatal, rather than
 * reported as SKIPPED two hundred lines into the output where it reads like a
 * footnote. */
{
  const sources = { [CODE]: original, [APP]: appOriginal, [WS]: wsOriginal };
  const missing = [];
  [[MUTANTS, CODE], [APP_MUTANTS, APP], [WS_MUTANTS, WS], [WS_APP_MUTANTS, APP]]
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

let caught = 0, survived = [];
console.log('baseline:');
for (const suite of ['test_my_history.js', 'test_history.js', 'test_exam_release.js', 'test_shuffle.js', 'test_retake.js', 'test_exam_view.js', 'test_exam_confirm.js', 'test_report.js', 'test_report_ui.js', 'test_worksheet.js', 'test_worksheet_ui.js', 'test_card_video.js']) {
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
  try { if (fs.existsSync(MARKER)) fs.unlinkSync(MARKER); } catch { /* ditto */ }
  inFlight = null;
}

/* Written to disk BEFORE the file is patched and removed after it is put back.
 * The in-memory restore above is the fast path; this is what survives a kill
 * the process never gets to see. */
function markInFlight(file, what) {
  try {
    fs.writeFileSync(MARKER, JSON.stringify({ file, snapshot: SNAPSHOT[file], what }, null, 1));
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
  for (const m of list) {
    if (!base.includes(m.from)) {
      console.log(`  SKIPPED  ${m.what}  (the code it patches has moved)`);
      survived.push(m.what + ' [pattern not found]');
      continue;
    }
    inFlight = { file, base };
    markInFlight(file, m.what);
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
runMutants(WS_MUTANTS, WS, wsOriginal);
runMutants(WS_APP_MUTANTS, APP, appOriginal);

const total = MUTANTS.length + APP_MUTANTS.length + WS_MUTANTS.length + WS_APP_MUTANTS.length;
console.log(`\n${caught} of ${total} broken guards were caught by the tests.`);
if (survived.length) {
  console.log('\nNOT ACTUALLY TESTED:');
  survived.forEach(s => console.log('  ' + s));
  process.exit(1);
}
