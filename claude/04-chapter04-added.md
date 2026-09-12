# Chapter 04 added to the quiz app

**Date:** 2026-09-08; chapter-order fix and source-typo fixes 2026-09-09.
Build `v56-ch04-source-typos` (was `v55-chapter-order`, `v54-ch04`,
`v53-ch12a-original-pdf`).
Front-end only — `Code.gs` untouched, so no Apps Script redeploy.

## What was added

Chapter 04 — measurement: significant figures, precision, greatest possible
error, reading a vernier caliper and a micrometer, comparing the accuracy of
two measurements, and significant-figure arithmetic. Lesson codes `4-1.1` to
`4-6.1`.

- **4 papers × 50 questions** (internally "A, B, C, D"; A is keyed and labeled
  as the original worksheet from the start — see below)
- **32 distinct scale drawings** (the worksheet's own TikZ recompiled) plus
  **2 shared reference photos** (a labelled vernier caliper, a labelled
  micrometer — the same picture in all four versions, unlike Chapter 12A's
  per-version photograph)
- **50 explanation videos** — every question on this sheet carries a QR code,
  and the URL is literal text in the `.tex` (`\\qrcode[...]{URL}`), so this
  chapter's links were read directly out of the source rather than decoded
  from a rendered image
- App total is now 4 chapters, 16 papers, 1,360 questions

Sources: `Ch04A/B/C/D_questions.tex` and `Ch04_answer_key.tex`, plus two
reference photos of a labelled caliper and a labelled micrometer. **The
corrected `.tex` files now live in `tools/ch04/worksheets/`** — see the
source-typo section below for why that directory exists.

## Version A keyed as the original worksheet from the start

Adnen's instruction for this chapter was explicit: *"here too, version A is
the Original PDF worksheet"* — a direct reference to the Chapter 12A fix made
immediately before this (Chapter 12A had shipped as a fourth parallel
"Version A" and needed a rename to `original_pdf` / "Original PDF worksheet"
after the fact). Chapter 04 was built keyed and labeled that way from the very
first `build_bank.py` run, so there was no paper-ordering bug and no
rename/regression cycle to go through this time.

Its key is **`ch04`**, with no naming clash to route around — unlike `ch12a`,
which had to avoid the already-meaningful `ch12`.

## Chapter list order: by syllabus number, not by date added

Reported by Adnen the day after delivery, with a screenshot: the tick-box tree
read *Chapter 03, Chapter 12A, Chapter 04* — because `ch04` had been appended
to the end of the `CHAPTERS` object in `app.js`, and **nothing sorts that
list**. The question tree, `allPapers()` and the per-chapter counts all walk
`Object.keys(CHAPTERS)`, so the literal's write order is exactly what the
instructor sees. Moving `ch04` above `ch12a` in the object was the whole fix.

This is the same class of bug as Chapter 12A's paper-ordering complaint one day
earlier (`version_a` falling to the end of `SET_ORDER`), one level up the tree:
**both the chapter order and the paper-within-chapter order are declared in
`app.js`, and both silently put a new entry last unless it is placed
deliberately.** Now stated in a comment above `CHAPTERS`, in the README, and
locked down by two assertions in `test_ch04.js` §1 — one on the registry, one
on the rendered tree's own labels, since the registry could be right while the
DOM order is wrong.

Correct order, everywhere: **Chapters 01 & 02, Chapter 03, Chapter 04, Chapter
12A.** A future Chapter 12B goes after 12A; a future Chapter 05 goes between 04
and 12A — not on the end.

## Version A had no answer key

The uploaded `Ch04_answer_key.tex` has columns for **B, C and D only**.

### How the key was established

Following the same "prove, then trust" method as Chapter 12A: `solve_ch04.py`
re-derives each answer from the question text and, for the twenty reading/
part-ID questions, the figure's own numbers — read straight off the TikZ
source's raw tick coordinates (`scalereader.py`), never by rendering and
looking. It never reads an answer before computing one.

Run against the three versions that came with a key, it reproduces **150 of
150** — zero disagreements, zero unsolved. Then `mutate_ch04.py` corrupts one
key per question family and requires a complaint: **13 of 13 families bite.**
Only then was the same code, unchanged, pointed at the original worksheet:
**50 of 50**, of which the four "name the part" questions are independently
confirmed by elimination against the one caliper/micrometer photo every
version shares. Letter spread 12/11/11/15 (a/b/c/d) — no letter carries the
paper.

### The one genuine figure-level ambiguity

Version A's Q22 (\"read the vernier caliper in inches\") has a figure whose
visible window sits entirely inside one inch's tenths — no bold whole-inch
tick is drawn, so nothing in that scale alone fixes which inch is meant. The
same ambiguity, on the B/C/D validation, showed up exactly once (Version D's
Q23) and was at first left unsolved by design (`scalereader.py` refuses rather
than guesses when two whole-inch completions both land on real choices).

It resolves with a second, independent cue already inside the same figure:
every caliper drawing also carries a top "mm" scale, read off the *same*
physical jaw position. Both this question's choices and Version D's Q23's
choices include that mm number, mislabeled with "in" units, as a deliberate
unit-confusion decoy (`\"56.75 in\"` and `\"32.65 in\"` respectively — a student
who reads the wrong scale would get exactly that). Converting the decoy back
to inches lands within about 0.002 in of the true value once the correct whole
number is chosen, and nowhere close for the wrong one — confirmed first
against Version D's Q23 (whose real answer, `1.286 in`, is on the official
key), then trusted on Version A's Q22 (`2.236 in`, choice B). `solve_caliper()`
only uses this to choose between candidates that are already real choices on
the question, and only when it points unambiguously (a clear margin over any
other candidate) — never to invent a value. After this fix, `check_ch04.py`
reports 150 of 150 with **zero unsolved**, and the full 50-question Version A
key resolves with no exceptions.

**Told the user this is a derivation and worth comparing against the original
worksheet's official key if he has it.**

## Two typos in the teacher's own files — carried, then corrected at source

Both were found while validating the derived key and were **carried faithfully
at first**, on this project's long-standing principle of trusting source
content rather than guessing at what it "should" say, with each documented and
carved out of a test. On 2026-09-09 Adnen asked for both to be fixed, so they
were corrected **in the `.tex` sources themselves** and the bank rebuilt from
those — not patched in the generated JS, which would have left the printable
worksheets still wrong and the next rebuild undoing the fix.

- **Q4's lesson code** read `1-1.1` — a Chapter 1 code — in all four versions,
  on a "how many significant digits" question sitting mid-run among Q1–Q6,
  which all carry `4-1.1`. Now `4-1.1` in all four.
- **Version A's Q45** listed the same decoy twice: options A and C both read
  `$206{,}700$ cm$^2$`. Option C is now `$200{,}000$ cm$^2$``.

**Choosing the replacement was a decision worth not guessing at.** Versions B,
C and D build that same question from an identical template — every one offers
{1 significant figure, 2 (the answer), 3, raw unrounded product} — and
Version A was the only one missing the 1-figure value, which is almost
certainly what the duplicated option was meant to be. Adnen was asked, given
that reasoning and two alternatives, and chose it. Each wrong option now models
a distinct error: not rounding at all (206,700), over-rounding to one figure
(200,000), and cutting rather than rounding (206,000).

**No answer changed** — the key is still option B, the 2-figure `$210{,}000$``.
Verified by diffing the regenerated bank field-by-field against the previous
one: exactly 5 changed fields (4 lesson codes + 1 choices string), 0 changed
answers, 0 changed figures. The derivation was then re-run from the corrected
sources: still 150/150 on B/C/D, still 13/13 mutation families, still 50/50
on A with Q45 = b.

Both test carve-outs were **removed and inverted**: `test_ch04.js` §10 now
fails if either typo returns (rather than tolerating it), and
`test_papers.js`'s duplicate-choice check is once again a plain "no paper
repeats an option" with no exceptions. A rebuild from a *fresh* copy of the
teacher's original uploads would reintroduce both — which is exactly what
those inverted assertions are there to catch. To make that unlikely, the
corrected `.tex` files are now kept in **`tools/ch04/worksheets/`**; Chapter
12A's tool directory carries no `.tex` because nothing there was ever edited,
but here the corrected source *is* part of the fix.

## Figure pipeline (reused from Chapter 12A, no regressions this time)

Same `pdflatex` + `preview`/`tightpage` approach, one compile per version,
each figure emitted twice from that same compile — `<hash>.svg` (via
`pdftocairo -svg`) for the screen, `<hash>.pdf` (via `qpdf --pages`) for the
worksheet export. 32 definitions across the four versions, no collisions to
deduplicate (each of the 8 reading questions is independently randomized per
version, so all 32 are distinct).

Learning Chapter 12A's lesson directly: the ×2.4 screen-scale and the PDF-twin
copy were written into `copy_figures()` **from the first run**, not applied as
a manual pass afterward — so there was no rebuild-wipes-the-scaling regression
to catch this time.

The two reference photos (labelled caliper, labelled micrometer) are plain
PNGs, not SVG-derived — they pass through the worksheet export unchanged
(`worksheetImageSrc` only swaps `.svg` to `.pdf`; a `.png` src is untouched).

## App changes

- `CHAPTERS` gains `ch04`, **placed between `ch03` and `ch12a`** (see the
  chapter-order section above)
- `question_bank_ch04.js` (set ids `original_pdf`, `version_b`, `version_c`,
  `version_d`), `figures_ch04/` (32 SVG + 32 PDF), `images/ch04_caliper.png`
  and `images/ch04_micrometer.png`
- `EXPLANATION_VIDEO_LINKS.ch04` — 50 links, one per question, no exceptions
- No `renderMath`/`worksheet_tex.js` LaTeX-handling additions were needed:
  `\\overline`, `\\dfrac`/`\\frac`, `\\text`, `\\div`, `\\cdot` were already handled
  from Chapter 12A and Chapters 01–03; only `\\medskip`/`\\smallskip` (stripped)
  and `\\ldots` (converted to the ellipsis character, already a declared
  Unicode character in the worksheet preamble) needed build-time conversion

## Testing

- **`test_ch04.js` — 51 checks.** Includes checking the stored B/C/D keys
  against the teacher's **original `.tex` file**; the two chapter-order
  assertions described above; the inverted source-typo assertions; a
  distinct-drawing check in place of Chapter 12A's grep-for-a-number check
  (`pdftocairo`'s SVG output renders TikZ text as glyph outlines, not literal
  characters, so Chapter 12A's `has16`/`has10` style assertions were actually
  matching y-coordinate substrings by coincidence — not repeated here).
- **`test_worksheet.js` §13 — 13 checks**, including a real pdflatex compile
  of a whole Chapter 04 paper with zero errors, and a "drawn" count that
  counts both `.pdf` and `.png` XObject references in the log (Chapter 12A's
  version only counted `.pdf`, since that chapter's photo count per paper
  never gave the shortfall enough weight to fail the loose `>=` check — this
  chapter's ratio of PNG photos to TikZ figures did).
- **`test_worksheet_ui.js` §9c** — exports from the browser, unpacks the
  posted zip, and compiles it; confirms the two shared photos travel as PNG
  and the drawings as PDF, none as SVG.
- `test_papers.js`: 16 papers across 4 chapters, `OWNED` picture-folder map
  gains `ch04`, duplicate-choice check back to no-exceptions.
- `mutate_backend.js` gains one mutation: swap Chapter 04's registration to
  read from Chapter 12A's bank, caught by `test_ch04.js`.
- Full battery: **all suites green** (`test_ch04.js` 51/51, `test_ch12a.js`
  45/45, `test_papers.js` 117/117, `test_worksheet.js` 114/114,
  `test_worksheet_ui.js` 64/64`)
- Mutation suite: **113 of 113**, re-run after the source fixes, with all three
  patched sources verified byte-identical to their pristine snapshots afterward
- Chapter-04-specific solver mutation suite (`tools/ch04/mutate_ch04.py`):
  **13 of 13** question families bite
- Final run against the **unpacked delivery zip**, not the working tree

### A flaky check, now fixed rather than tolerated

`test_ch12a.js` §5 (\"every drawing loaded\") failed on the **first** run against
a freshly started `http-server`: it waited a fixed 600 ms after building an
82-question paper, then read `naturalWidth`, and on a cold server some of the
54 drawings plus the 280 KB photograph had not arrived. It passed on every
re-run. Seen three times (reporting 1, then 8, then 28 files) before being
fixed — at which point it was worth fixing rather than documenting, because a
check that cries wolf trains the next reader to dismiss a real failure here.

Both this and the equivalent check in `test_ch04.js` §5 now wait on the images'
own load state (`waitForFunction` until every `img.complete`) instead of a
fixed timeout. This does not weaken them: `complete` is true for a *failed*
load too, so `naturalWidth` still judges whether a picture actually rendered —
the wait only stops the test racing the network. Verified by restarting the
server cold and running immediately: passes, where the old version reproduced
the failure reliably under exactly that condition.

## Still open

- The original worksheet's key is derived. Worth comparing against the real
  key if it exists.
- **Rebuild Chapter 04 from `tools/ch04/worksheets/`, not from the original
  uploads** — the uploads still contain both source typos.
- **When the next chapter is added, place it in the `CHAPTERS` object by its
  syllabus number**, not on the end — and give its base paper the
  `original_pdf` / "Original PDF worksheet" keying from the first build. Those
  two conventions between them cover both ordering complaints this project has
  had.
