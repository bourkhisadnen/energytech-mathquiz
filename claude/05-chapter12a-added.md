# Chapter 12A added to the quiz app

**Date:** 2026-09-07. Build `v53-ch12a-original-pdf` (was `v52-ch12a-worksheet`
before the rename below, `v51-chapter-12a` before the export fix before that).
Front-end only — `Code.gs` untouched, so no Apps Script redeploy.

## What was added

Chapter 12A — geometry: angles, polygons, area and perimeter, right triangles and
similar figures. Lesson codes `12-1.1` to `12-4.1`.

- **4 papers × 82 questions** (internally "A, B, C, D"; A is keyed and labeled
  as the original worksheet — see below)
- **162 distinct drawings**, the worksheet's own TikZ recompiled
- **80 explanation videos**, decoded straight from the QR codes in the `.tex`
- App total is now 3 chapters, 12 papers, 1,160 questions

Sources: `Ch12A/B/C/D_questions.tex` and `Ch12_answer_key.tex`.

## The chapter key: `ch12a`, not `ch12`

The obvious key was taken. `ch12` has meant **Chapters 01 & 02** since before
Chapter 03 existed, and session codes carrying it are already stored in the
Sheet. Giving `ch12` to the chapter actually called 12A would have silently
redirected every one of those to the wrong paper — a data-corrupting rename, not
a cosmetic one. Chapter 12B will be `ch12b`.

There is now a mutation test for exactly this: swap `ch12` to point at the 12A
bank and the suite must fail.

## Version A is keyed and labeled as the original worksheet

Initially shipped as a fourth parallel version — set id `version_a`, label
"Version A" — sitting alongside B/C/D. Two problems, both reported by Adnane
after seeing the compiled PDF:

1. **The four papers listed B, C, D, then A**, not A to D. `app.js`'s
   `SET_ORDER` (`['original_pdf', 'version_b', 'version_c', 'version_d']`) is
   what orders the paper list and the question tree; an id it doesn't
   recognize — `version_a` — falls through to the end, after the three it does.
2. **The label should read "Original PDF worksheet"**, matching the convention
   Chapters 01 & 02 and Chapter 03 already use for their base version — not
   "Version A", which reads as one of four interchangeable variants when in
   fact this is the sheet the QR codes and photographs actually point back to.

Both were the same root cause: A is not a fourth parallel version, it's *the
original*, and it wasn't keyed that way. Renaming its set id from `version_a`
to `original_pdf` and its label from `"Version A"` to `"Original PDF
worksheet"` fixed both asks in one change — the rename alone puts it first in
`SET_ORDER`, no ordering code needed to change.

**Fallout worth knowing about:** two chapters now share the exact label
`"Original PDF worksheet"`. `test_worksheet_ui.js` §9b used to find Chapter
12A's paper by searching the question tree for that text; with three chapters
using it, that search would have hit Chapters 01 & 02's row first. Fixed by
selecting the exact paper via its `data-paper="ch12a:original_pdf"` attribute
instead of by label text (`makeSession` gained a `paperKey` option for this).

## Version A had no answer key

The uploaded `Ch12_answer_key.tex` has columns for **B, C and D only**.

**It is not recoverable from the others.** Only ~31 of 82 questions are
option-permutations of A; the rest are genuine variants with different numbers.
Straight transfer yields 13 answers, not 82.

### How the key was established

`tools/ch12a/verify_ch12a.py` re-derives each answer from the question text and
the numbers printed in its drawing. It never reads an answer before computing
one.

The validation is the point: **run against the three versions that came with a
key, it reproduces 246 of 246** — zero disagreements, zero unsolved. Then
`mutate_verifier.py` corrupts one key per question family and requires a
complaint: **48 of 48 families bite.** Only then was the same code, unchanged,
pointed at the original worksheet: **82 of 82**, of which 13 are independently
confirmed by a version asking the identical question over the identical
drawing. Letter spread 15/20/21/26 — no letter carries the paper.

15 answers were also worked by hand as a spot check; all agreed.

**Told the user this is a derivation and worth comparing against the original
worksheet's official key if he has it.**

## Reading the drawings

Most of these questions keep their dimensions in the picture, not the sentence —
"The area of the next trapezoid is", with 10.0 m and 16.0 m written on the
figure. So the solver reads the picture:

- `figdata.py` — the text of every TikZ `\\node`
- `geom.py` — the polygon's actual corners, which printed dimension is written
  against which edge, and which label sits on a **dashed** segment (that is how
  these figures mark a height)

Three solver bugs were caught only because B/C/D have a key to check against:

1. **Shape identified by macro name.** The original worksheet calls a drawing
   `\\figTrapB`; B/C/D call the same kind of drawing `\\figQEG`. Keying off the
   name meant every B/C/D quadrilateral went unsolved. Now classified from the
   geometry.
2. **Q57 "type according to its SIDES" answered "Right triangle."** The 3-4-5
   drawing carries a 90° mark, and the solver seized on it. The key says
   **Scalene** in all three versions — the question asks about sides, and the
   square corner is a distractor.
3. **Q62 guessed leg-then-hypotenuse.** Trying the leg first and falling back
   picked the decoy every time: these papers put the *other* calculation among
   the options on purpose. The unknown is now identified from the drawing — the
   side carrying the letter, and whether it faces the square corner.

## Two traps worth remembering

**"The same question" is not "the same sentence."** Q17–Q23 are all *Name the
polygon* with the same four options, and Q45 is *what kind of triangle is this*
— word-for-word identical in every version, a **different shape drawn in each**`.
Anything transferring an answer between versions must compare the drawing too.
The first version of `test_ch12a.js` did not, and reported 23 false failures.
The Python derivation had it right from the start (it compares figure content
hashes); the browser test learned it the hard way.

**A tolerance wide enough for rounding is wide enough for the decoy.** Q6 offers
130 and 132; Q42 offers 31.0 and 31.3. A 2% window matched both and the question
came back unanswered. `pick_number` now tries tightest-first and refuses — never
guesses — when two options match at the same tolerance. This is the same lesson
as the Chapters 1 & 2 verifier's "form matters as much as value".

## Figure pipeline (reusable for Chapter 12B)

`pdflatex` + `preview`/`tightpage` puts every figure on its own cropped page in
one compile per version. Deduplicated by a hash of the TikZ source — 251
definitions collapse to 162 drawings.

**Each drawing is emitted twice, from that same compile:**

- `<hash>.svg` (via `pdftocairo -svg`) — what the page shows, and what the
  service worker precaches
- `<hash>.pdf` (via `qpdf --pages`, so the page is lifted out whole rather than
  re-rendered) — what the worksheet export sends to Overleaf

Delivered as `<img src>` rather than inlined: cairo writes `clipPath id="clip-0"`
in every file, so inlining several into one page would collide.

`pdftocairo` writes the size in **PDF points**, so figures arrived ~135 px wide —
fine on paper, too small on screen. Presentation width/height scaled ×2.4; the
`viewBox` is untouched, so the geometry and every label stay exactly where they
were.

**Both the ×2.4 scaling and the PDF twin are now inside `build_bank.py`'s
`copy_figures()`**, not separate one-off steps. They weren't, originally — the
first delivery applied the scaling and the PDF copy as manual passes over
`figures_ch12a/` after `copy_figures()` ran. Re-running `build_bank.py` for the
rename above wiped both: `copy_figures()` deletes everything in `figures_ch12a/`
and recopies fresh, unscaled SVGs from the `figsvg/` cache, and never touched
PDFs at all. Caught before delivery by diffing the regenerated SVGs against the
previously-shipped zip (byte-identical except the `width`/`height` attributes
had reverted to ~1x). Fixed at the root: `copy_figures()` now calls
`scale_svg_for_screen()` and copies the matching `figpdf/<hash>.pdf` for every
figure it writes, so a rebuild can't drop either again. **This matters for
Chapter 12B**, which reuses this exact pipeline — running `build_bank.py` there
will no longer require a manual re-scale/re-copy pass afterward.

## The worksheet export broke, and how

**Both bugs were reported by Adnane after the first delivery, not caught by the
tests — because nothing in the suite had ever built a Chapter 12A worksheet.**
The chapter was tested; the *export of* the chapter was not. `test_worksheet.js`
built its bank from `QUESTION_BANK_SETS` and `..._CH03` and simply never saw the
new one.

1. **SVG handed to pdfLaTeX.** It cannot read SVG at all — *"LaTeX Error:
   Unknown graphics extension: .svg"* — and the worksheet came out with no
   drawings. Fixed by building a PDF twin of every figure and swapping by
   extension in `worksheetImageSrc`, which **both** the `\\includegraphics` line
   and the bundle list now go through. Naming the picture in two places is how
   one ends up asking for a file the other did not pack.
2. **∠ and ∥ undeclared.** The bank stores the angle and parallel signs as
   characters (the build turns `\\ang` and `\\parallel` into them for the browser
   renderer), and the LaTeX kernel knows neither, so every geometry question
   stopped the compile. Added `\\DeclareUnicodeCharacter{2220}` and `{2225}` to
   the preamble beside the nine already there.

The PDFs are **not** precached by the service worker: 3.5 MB on every trainee's
device for a button only an instructor presses, and only while online.

Guarded now by four mutations and by `test_worksheet.js` §12 and
`test_worksheet_ui.js` §9b — the latter checks what the *browser actually
fetched and packed*, since the exporter can name the right file and the fetch
still bring back the wrong one.

## App changes

- `CHAPTERS` gains `ch12a`
- `question_bank_ch12a.js` (set ids `original_pdf`, `version_b`, `version_c`,
  `version_d`), `figures_ch12a/` (162 SVG + 162 PDF),
  `images/ch12a_q76_[a-d].png`
- `EXPLANATION_VIDEO_LINKS.ch12a` — 80 links; Q17 and Q21 have no QR code on the
  sheet. Same link per question number across all four versions, and correctly
  so: every B/C/D variant only changes numbers, none changes subject, so no
  `video_ok: false` is needed here (unlike Chapter 03)
- `renderMath` gains `\\overline` (segment names — the bar is what separates the
  segment DE from D×E) and `\\sqrt` with a stretched bar for Heron's formula
- `worksheet_tex.js` gains `worksheetImageSrc` and two Unicode declarations

## Testing

- **`test_ch12a.js` — 45 checks.** Includes checking the stored B/C/D keys
  against the teacher's **original `.tex` file**, not against anything the build
  produced.
- **`test_worksheet.js` §12 — 13 checks**, including a real pdflatex compile of a
  whole Chapter 12A paper with zero errors.
- **`test_worksheet_ui.js` §9b** — exports from the browser, unpacks the posted
  zip, and compiles it. Selects its paper by `data-paper` key, not label text,
  now that the label is shared across chapters (see above).
- `test_papers.js` extended: 12 papers across 3 chapters, and its
  "no picture from another chapter" check rewritten to name each chapter's own
  folders and reject everything else — the old form named one rival chapter and
  would have stopped checking the moment a third arrived.
- Full battery: **27 suites green**
- Mutation suite: **112 of 112**
- Final run against the **unpacked zip**, not the working tree

### Mutations that survived a first attempt

**"the radicand is closed at the first brace rather than the matching one."** No
question in this chapter has a nested brace inside a root, so nothing exercised
the brace counting. The first fix — testing through `renderMath` — *also failed
to kill it*, because `renderMath` strips every leftover brace on its way out, so
a radicand that closed in the wrong place still came back looking tidy. Only
asserting the exact output of `replaceSqrt` caught it.

Same shape as the password-reset survivor: **the test observed an outcome that
the code under test was not the only possible cause of.** Third time this exact
mistake has appeared in this project.

### The pre-flight earned its keep

Editing `diagramTexFor` and `imagesUsedBy` invalidated two existing mutants'
`from` strings. `mutate_backend.js` refused to start and named both, instead of
running a sweep in which two guards silently tested nothing.

### A rebuild silently regressing its own output

Rerunning `build_bank.py` to apply the rename above regenerated
`question_bank_ch12a.js` correctly (same data, same figure hashes — verified
byte-identical to the shipped zip) but, as described in the figure pipeline
section, quietly reverted the SVG scaling and dropped the PDF twins, because
those had been separate manual steps rather than part of the pipeline. Nothing
in the test suite caught this on its own the first time it was checked — the
suite tests behavior (does the paper compile, do the numbers in the picture
match the answer), not exact file bytes, and a de-scaled SVG still "has a
number 16.0 in it" by the same coincidental substring match the test already
relied on. Found only by diffing the regenerated `figures_ch12a/` against the
previously-delivered zip before repackaging. Worth remembering for Chapter
12B: **diff a rebuild's output against the last known-good delivery, don't
just re-run the tests and call it done**, when the rebuild touches a pipeline
step that used to be manual.

## Still open

- The original worksheet's key is derived. Worth comparing against the real
  key if it exists.
- Chapter 12B to follow, same four-version shape → key `ch12b`. The pipeline in
  `tools/ch12a/` carries over unchanged — **including `render_pdfs.py`, which is
  not optional**: skip it and the worksheet export ships without drawings. Its
  base version should be keyed `original_pdf` / labeled "Original PDF
  worksheet" from the start, per the convention settled here — no `version_a`
  detour needed this time.
