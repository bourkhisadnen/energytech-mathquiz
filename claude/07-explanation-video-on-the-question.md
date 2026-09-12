# The explanation video on the question it belongs to (v49)

The wrong-questions list under a marked paper has always carried the YouTube links. Now
the same link also sits **inside the box of the question it belongs to**, as a
**▶ Watch the explanation** button, so a trainee reading the question they missed does not
have to scroll to the foot of a hundred-question paper and match Q-numbers by eye.

Two places show it:

- **Practice, straight after submitting** — `calculateScore` adds it to each card it flags
  wrong.
- **An exam, once the instructor releases the results** — the trainee opens the attempt
  under *My results* and the review cards carry it too (`renderAttempt`).

## Where it must not appear

One rule, `showExplanationVideos(reveal)`, used by both the list and the cards. Two copies
could drift, and the way they would drift is a video appearing on an exam — naming the
method for a question being scored.

| Situation | Video? | Why |
|---|---|---|
| Practice, after submit | yes | marking is out |
| Exam, being sat / just handed in | no | marking is withheld (`reveal` is false) |
| Exam, instructor's own preview | no | `mode !== 'assessment'` — the case the mode check exists for |
| Exam, after the instructor releases | yes | reached only through `my_attempt`, which the backend refuses until released |
| Question they got right | no | nothing to explain |
| Question with no QR code on the worksheet | no button | 7 of 114 in ch12, 20 of 94 in ch03; the list still names them |

Trainees **cannot submit with anything unanswered** (`requireAll: true` is hardcoded on the
submit path), so there is no unanswered case to design for on their side.

## Notes

- `setCardVideo` always removes before it adds, so marking a paper twice cannot leave two
  buttons on one card. Clearing the answers removes them along with the marking — leaving
  them would name the wrong questions just as plainly as the red borders did.
- The review path only shows a link when the paper could be **rebuilt from the bank**:
  `video_ok` is what stops a generated variant inheriting the original's video, and it
  lives on the question, not on the stored answer.
- `.card-video` is hidden in print — a printed paper cannot be clicked.

## Two things found on the way

**A missing favicon.** Nothing in `index.html` pointed at `icon.svg`, so every browser asked
the server root for `/favicon.ico` and got a 404 on every load — and with the service worker
active it handled that miss too. One `<link rel="icon">` fixed it. Found because the new test
loads the page twice.

**The mutation harness could leave a source file patched.** A run cut off at a time limit left
`if (built.images.length)` reading `if (false)` in `app.js`, and an hour of testing afterwards
was measuring the mutant — passing, wrongly. `execFileSync` blocks the event loop for the whole
of each suite, so a SIGTERM arriving mid-suite followed by a hard kill never reaches the signal
handlers the harness already had.

`mutate_backend.js` now:

- keeps a pristine snapshot of each patched file on disk and writes a marker naming the
  mutation before applying it; the next run finds the marker and restores the file **before
  reading the originals** (or it would snapshot the mutant as pristine);
- refuses to start at all if any mutant's `from` string is missing from its file, which
  catches both a leftover mutation and a pattern the code has moved past. Fatal and up front,
  rather than a SKIPPED line two hundred lines into the output.

Both paths were verified against a real kill, not a simulation.

## Files

- `app.js` — `showExplanationVideos`, `setCardVideo` (live marking), `reviewVideoLink`
  (released review)
- `style.css` — `.card-video`, hidden in print
- `test_card_video.js` — 35 checks: the live path, the released-exam review, the held-back
  exam having nothing to open, and the instructor's exam preview staying silent while their
  practice preview does not

## State

925 checks across 22 suites, all green. 89/89 mutations caught. Service worker at
`v49-video-on-the-question`.
