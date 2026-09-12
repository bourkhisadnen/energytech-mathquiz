# Chapter 04 — how the bank was built and how its answers were checked

The worksheet arrived as four LaTeX files (versions A to D, 50 questions each)
plus one answer key covering **B, C and D only**. Version A had no key, and
was keyed `original_pdf` / "Original PDF worksheet" from the very first build
of this chapter — no `version_a`-then-rename detour, unlike Chapter 12A.

Run in this order, from this directory:

| script | what it does |
|---|---|
| `parse_ch04.py` | pulls the questions, options, lesson codes, figures and QR links out of the four `.tex` files |
| `mkfig.py` / `render_figs.py` | compiles every TikZ figure with pdflatex and converts it to SVG (32 distinct scale drawings across the four versions) |
| `render_pdfs.py` | produces the PDF twin of every figure, from the same compile, for the worksheet export (pdflatex cannot read SVG) |
| `sigfig.py` | significant-figure, precision and greatest-possible-error arithmetic for decimal and fractional measurements |
| `scalereader.py` | reads a vernier caliper or micrometer reading directly off a figure's raw TikZ tick coordinates — the same idea as Chapter 12A's `geom.py`, for scale instruments instead of polygons |
| `solve_ch04.py` | re-derives every answer from the question (and its figure, where there is one) and compares against the supplied key |
| `check_ch04.py` | runs `solve_ch04.py` against all of B, C and D and reports wrong/unsolved counts |
| `mutate_ch04.py` | corrupts one key per question family and requires the solver to notice |
| `build_bank.py` | writes `question_bank_ch04.js`, copies the figures and photos, and collects the video links (read directly out of `\qrcode[...]{URL}` in the .tex, not decoded from an image) |

## Why this is trustworthy

`solve_ch04.py` never reads an answer before deriving one. Run against the
three versions that came with a key, it reproduces **150 of 150** answers, and
`mutate_ch04.py` shows that all **13** question families would have complained
had one of those answers been wrong. The same code, unchanged, then produces
Version A's key: 50 of 50, of which the four "name the part" questions are
independently confirmed by elimination against the one reference photo every
version shares.

## The one figure-level ambiguity, and how it was resolved

Q22 on the original worksheet ("read the vernier caliper in inches") has a
figure whose visible window doesn't cross a whole-inch mark, so there is no
bold anchor fixing *which* inch is meant — the same ambiguity that, on this
chapter's B/C/D validation, showed up once (Version D's Q23) and was at first
left unsolved rather than guessed.

The figure gives a second, independent cue, though: every caliper figure also
draws a top "mm" scale, read off the *same* physical jaw position. The paper's
own choices include that mm number mislabeled with "in" units — a classic
unit-confusion decoy — and converting it back to inches reproduces the correct
whole-inch digit to within the generator's own rounding, on both the one
already-keyed instance (Version D's Q23, confirmed against the official key)
and Version A's Q22. `scalereader.py`'s `solve_caliper()` uses this only to
choose between figure-grounded candidates that are already real choices on the
question, never to invent a value, and only when it points unambiguously
(a clear margin over any other candidate) — the same "refuse rather than
guess" standard the rest of this chapter's solvers hold to.

## Two typos in the teacher's own file, corrected at source (2026-09-09)

Both were carried faithfully at first and then fixed on request, **in the
`.tex` files themselves**, with the bank rebuilt from the corrected sources —
so the app, the worksheet export and the printable worksheets all agree. The
derivation was re-run afterwards: still 150/150 on B/C/D, still 50/50 on A, and
**no answer changed**.

- **Q4's lesson code** was written `1-1.1` (a Chapter 1 code) in all four
  `.tex` files, on a question sitting mid-run among Q1–Q6, which all carry
  `4-1.1`. Now `4-1.1` in all four.
- **Version A's Q45** listed the same decoy twice (options A and C both
  `$206{,}700$ cm$^2$`). Option C is now `$200{,}000$ cm$^2$` — the
  1-significant-figure value. That is the member of the {1sf, 2sf, 3sf, raw
  product} set that B, C and D all carry and A was missing, so all four
  versions now offer the same four kinds of option. The key is unchanged
  (option B, `$210{,}000$ cm$^2$`).

If you re-derive from a **fresh** copy of the teacher's worksheets, expect both
typos to reappear — `test_ch04.js` §10 fails loudly if they do.

**This is why `worksheets/` exists.** Chapter 12A's tool directory carries no
`.tex` files, because nothing in that chapter's sources was ever edited: the
uploads were the source of truth. Here the corrected `.tex` **is** part of the
fix, so the four question files and the answer key are kept beside the scripts.
Rebuild from these, not from the original uploads. (The scripts' `SRC` paths
still point at the working directory they were run in — as in `tools/ch12a/`,
they are a record of how the bank was derived rather than a turnkey build.)
