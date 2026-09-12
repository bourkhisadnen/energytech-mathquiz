# The exam page, and the leaks it uncovered (v44)

## The clean page

While a trainee is sitting an **assessment**, the screen is cleared to the paper
and a strip saying whose it is. Everything else comes off: the session code box,
their results and history, change password, the Back button, the header buttons,
the footer.

The strip carries name, EnergyTech ID, intake / group, the exam's name, its code,
how many questions, and a live **"n of N answered"** counter — without which the
only way to check nothing was missed is to scroll the whole paper again.

Submitting brings the screen back, with the exam now a pending row in their list.

**Practice quizzes are untouched.** This is an exam measure; in practice a trainee
may well want to load another code straight afterwards.

Implementation is a single `body.exam-mode` class with the hiding rules in CSS,
rather than a pile of `.hidden` assignments — leaving exam mode is then one class
removal and cannot strand a panel.

Note: "Original Q45" still appears on each card, controlled by the existing
**Show original question numbers** session setting. For an exam it is worth
unticking; the app honours the session's value on the trainee side.

## The leak: "Download result" handed over the exam

Two rounds of this, and the second one is the more useful lesson.

### Round one: it revealed the key mid-exam

`downloadResult()` called `calculateScore()` with no arguments, defaulting to
`reveal: true`. Pressing **Download result** during an exam therefore marked the
correct choice on every card *and* downloaded the score, the percentage and the
wrong-question list. Verified before fixing: `Score: 1 / 4`, the wrong-question
list, four `.correct-choice` marks lit up. A trainee could press it, read the
key, fix their answers and submit full marks.

Fixed by computing with `reveal: false` and hiding the button in exam mode.

### Round two: it came back after Submit — Adnane spotted this

The hiding was tied to `setExamMode(on)`, and exam mode **ends at Submit**. So
the button reappeared the instant the paper went in, and pressing it downloaded
`Score: 3 / 4` and the wrong-question list for an exam whose results had not been
released — straight past the release gate.

The mistake was conceptual, not a typo: the download was tied to
*exam-mode-the-screen-state*, a thing that ends, when the rule is about
*the session being an exam*, a thing that does not.

Now:

- `examSessionActive()` asks whether `currentSession.mode === 'assessment'`, which
  stays true after submission.
- `syncResultDownload()` hides the button on that basis, and is called when a
  paper is built, after submitting, and when the home screen renders.
- **`downloadResult()` itself refuses** for an exam and points at My results.
  Hiding a button is presentation; the refusal is the rule. A trainee with a
  browser console does not get a different answer.

## What let it through

`test_exam_view` checked the button **during** the exam and never after. The
section that ran after submitting checked only that the page came back.

That is the shape to watch for: a state that is asserted at one moment and
assumed to persist. The suite now checks the button after submitting, calls
`downloadResult()` directly at that point and requires no file at all, and greps
the whole quiz area for the score. Two mutations pin it — one restoring the
screen-state coupling, one removing the refusal — and both are caught.

A knock-on: with the exam path returning early, the `reveal: false` fix became
unreachable for exams, so its mutation stopped biting. Rather than drop it, it is
now tested through practice mode, where the side effect is still wrong — pressing
*download* should not quietly mark a paper the trainee is still working on.

## A flaw in the mutation harness

Every one of the five app.js mutations for this feature survived at first. Not
five bugs — the browser suites fetch the app over HTTP from `/tmp/ghpages/
energytech-mathquiz`, which was a **copy** of the source tree. The mutator was
patching a file the browser never loaded, so every mutation "passed" while
testing nothing.

`test_shuffle` was unaffected because it reads app.js off disk directly, which is
why its mutations bit and hid the problem.

Fixed by making the served path a symlink to the source directory, so no copy
exists to go stale. `mutate_backend.js` now refuses to run unless
`realpath(served app.js) === realpath(source app.js)`.

Worth remembering: the browser suites were **passing** throughout. A green suite
against a stale copy is indistinguishable from a green suite against the real
thing, unless something forces the comparison.

## Tests

- `test_exam_view.js` — 41 checks: each piece of chrome hidden, the identity
  strip, the progress counter, nothing marking answers on screen, the direct
  `downloadResult()` call during *and after* the exam, the screen returning after
  submit, and practice mode as a control (including that downloading there does
  not mark the paper).
- `mutate_backend.js` — 36 mutations across Code.gs and app.js. **36 of 36
  caught.**

Full suite at v44, all green: backend 85, papers 60, roster 57, my history 45,
exam release 45, compat 43, exam view 41, profile 38, retake 34, name migration
33, history 30, import/move 25, exam UI 24, coercion 23, trainee view 22, shuffle
21, instant 18, retake UI 17, subpath 12, diag 10, jsonp 8, urlsplit 3.

`test_roster` failed once during this session and passed on three consecutive
re-runs — a timing-sensitive browser assertion, not a regression. Worth watching.
