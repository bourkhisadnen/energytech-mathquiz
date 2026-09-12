# A handed-in exam is over (v45)

Adnane found it: after submitting an exam the paper was still on screen with
**Clear answers** and **Submit answers** both live. Clearing reset the
`studentSubmitted` flag, which unlocked Submit — so a trainee could hand in,
clear, re-answer and submit again.

The backend refused the second write (one sitting per exam, v42), so the Sheet
was never wrong. **The app said "Your answers have been submitted successfully"
anyway.** That is the serious part: a trainee re-does the paper, is congratulated,
and walks away believing the new answers count. Their recorded mark is the first
attempt.

## What happens now

Submitting an exam **retires the paper**: the questions come off the screen and
out of memory, and Submit, Clear and Download go with them. What is left is the
confirmation. There is nothing to clear and nothing to re-answer.

Four independent things stop the re-sit, each tested on its own because any one
could be undone by itself:

1. the paper is removed from the page,
2. `currentQuiz` is emptied,
3. `clearAnswers()` refuses outright for a submitted exam and does **not** reset
   `studentSubmitted` — the actual bug,
4. `submitOnlineResult()` still refuses a second send.

Buttons disappearing is presentation. 3 and 4 are the rules, and the tests call
them directly, the way somebody with a browser console would.

## The confirmation is now checked, not assumed

The POST is `no-cors`, so the reply is opaque and "submitted successfully" was
always a guess. For a practice quiz a wrong guess costs nothing. For an exam it
is the worst outcome in the app — nobody finds out until marks are released.

After an exam submission the app now **reads the record back**
(`confirmExamRecorded`). Entitlement is one sitting, so once the write has landed
the backend stops offering the paper; `maySit === false` is the proof. Three
outcomes, three different messages:

| what happened | what the trainee is told |
|---|---|
| the write landed | "**Recorded.** Your instructor will release the result…" |
| it silently did not | "**Your answers may not have been recorded.** Do not leave — tell your instructor now" (shown as an error) |
| the check could not be made | "Could not confirm with the server that this was recorded." |

The middle one is the case that must never be reported as success, and
`test_exam_confirm` drives it by having the mock swallow the POST while returning
a perfectly good response.

## Two harness faults found on the way

**A killed mutation run left the source patched.** `mutate_backend.js` applies a
mutation by editing the real file and restoring it on the next line. I killed a
run in between, which deleted `setExamMode(false);` from app.js and left it
deleted. The next test failed for a reason that had nothing to do with the code
under test, and my "is the source intact?" check grepped for the wrong marker.
The restore is now a `SIGINT`/`SIGTERM`/`SIGHUP`/`uncaughtException`/`exit`
handler, so the file comes back however the process dies.

**A test asserted through CSS instead of the rule.** The download-button mutation
stopped biting once the handed-in panel hid the whole button row: the button was
invisible whatever the JavaScript did. The test now checks the `hidden` property
as well as visibility — a rule masked by a stylesheet is an untested rule.

**And a flaky test, fixed rather than re-run.** `test_roster` failed about half
the time on "group delete blocked". The intake-delete assertion above it already
left the words "still has" on the status line, so the wait for that phrase
returned instantly and the assertion read the *previous* message. It now waits
for the specific refusal. Four consecutive clean runs.

## Tests

- `test_exam_view.js` — 51 checks (was 34): adds the paper being retired, the
  buttons going, `clearAnswers` refusing, a second submit sending nothing, and
  the read-back confirmation.
- `test_exam_confirm.js` — 12 checks, new: the three outcomes above.
- `mutate_backend.js` — 41 mutations. **41 of 41 caught.**

Full suite at v45, all green: backend 85, papers 60, roster 57, exam view 51, my
history 45, exam release 45, compat 43, profile 38, retake 34, name migration 33,
history 30, import/move 25, exam UI 24, coercion 23, trainee view 22, shuffle 21,
retake UI 19, instant 18, exam confirm 12, subpath 12, diag 10, jsonp 8,
urlsplit 3.
