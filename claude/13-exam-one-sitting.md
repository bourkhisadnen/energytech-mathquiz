# One sitting per exam (v42)

Before this, nothing stopped a trainee re-entering an exam code: the paper
loaded again, freshly shuffled, and a second attempt row was written. Both
counted — the instructor's roster listed both, the lesson bars averaged them,
and the dashboard treated them as separate rows.

## The rule

**An exam is one sitting per trainee.** Practice quizzes are unlimited, which is
what practice is for.

Re-entering the code shows: *"You have already sat this exam. If something went
wrong, ask your instructor to allow you another sitting."* The paper is **not
drawn** — seeing the questions a second time is worth something in itself, marks
released or not.

## Enforced in two places

The app refuses to draw a second paper, but that is the browser's opinion. The
write refuses too: `saveAttempt_` checks before appending, so a second
submission is not recorded whatever posts it. `doPost` now returns that refusal
rather than a blanket `ok` — the browser posts no-cors and cannot read it, but
the reply is at least honest.

## Granting another sitting

**My sessions → Who sat it** folds out a list of everyone who has sat that exam,
showing sittings used of sittings allowed, with *Allow another sitting* against
anyone who is out. That is for the tablet that dies mid-paper, which is the only
reason it exists.

Grants are rows in a new **Retakes** sheet (Timestamp, Session Code, EnergyTech
ID, Granted By), and entitlement is `1 + grants`. Counting grants rather than
flipping a flag means **a grant is spent by being used**: one grant is one more
sitting, not an open door. Only the session's owner (or an admin) can grant one,
and only to somebody on the roster.

## The double-submit bug

Pressing Submit a second time on the same paper posted the whole sitting again
as a separate attempt. `studentSubmitted` was being set but never read — a dead
guard. Since the submission is opaque (no-cors), a trainee unsure whether it went
through is quite likely to press again, so this was not hypothetical. Now the
second press says *"Your answers were already submitted"* and sends nothing.

## Session lookup is network-first now

`fetchSessionByCode` used to prefer the locally cached session and only fall back
to the network. That was fine when the reply was just a definition; it is not
fine now that it also carries whether this trainee has already sat the exam,
because a cached copy would happily hand out a second paper. The order is
reversed, with the cache as fallback.

Two consequences:

- **An exam will not start without the backend.** If the sitting record cannot be
  read there is no way to know whether they have already sat it, and guessing is
  the one thing not to do. The trainee is told the server cannot be reached.
- **"Cannot reach the server" and "session not found" are now different
  messages.** They were the same before, which sent trainees off retyping a code
  that was right all along.

## Known gap: walk-ins

A guest sitting types their own EnergyTech ID and holds no token, so there is
nothing to identify them by and nothing to stop them sitting twice. **Leave
"Allow trainees without an account" off for exams.** `test_retake` section 10
records this behaviour rather than pretending it is solved.

## Upgrading

A **Retakes** sheet is created on first use; nothing else changes. Code.gs
changed, so Apps Script needs a new deployed version.

## Tests

- `test_retake.js` — 34 checks: the block, that it is per trainee not per exam,
  practice being unlimited, the session load reporting it before a paper is
  drawn, a grant being spent by use, who may grant, and the walk-in gap.
- `test_retake_ui.js` — 17 checks in a browser: the refusal message, no paper
  drawn, the double-submit fix, practice still unlimited, the door closing again
  after a granted retake, and an exam refusing to start with no backend.
- `mutate_backend.js` — now 29 mutations. **29 of 29 caught.**

Both browser mocks were tightened while writing these. `test_exam_ui` originally
let one identity sit twice, which the app no longer allows — it now tracks
sittings per trainee, the same shape the backend enforces. This is the second
time in this feature that a too-forgiving mock hid real behaviour; it is worth
treating as the default suspicion when a browser test passes too easily.
