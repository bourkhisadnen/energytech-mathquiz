# Exporting a session as an interactive worksheet (v48)

After **Create session code** the instructor can export the same paper as a self-marking
PDF worksheet, in the style of the hand-written Chapter 03 worksheet: a fillable identity
header, one PDF radio group per question, a live total, a **Calculate Score** button that
lists wrong and unanswered questions, and an objective mastery table that colours
red-to-green.

## Why the export is LaTeX

The decisive fact: **the question bank is stored as LaTeX**. `body` and `choices` hold
`\dfrac`, `\calcstack`, whole `tikzpicture` environments — 685 fractions and 57 `\draw`
commands across 832 questions. That is what the printed worksheets were set in.

So the export passes those bodies through **untouched** and lets pdfTeX set them. Nothing
re-implements a fraction. The alternative considered and rejected was building the PDF in
the browser with pdf-lib: it can do AcroForm radio groups and document-level JavaScript
perfectly well, but it would have meant hand-rolling a LaTeX math and TikZ renderer, and
the output would have been visibly worse than the worksheet being copied.

## How the instructor gets a PDF

A static page cannot run TeX, so:

- **Open in Overleaf** (primary) — POSTs to `https://www.overleaf.com/docs` with
  `engine=pdflatex` and either `snip` (the LaTeX itself) or, when the paper uses
  photographs, `snip_uri` as a `data:application/zip;base64,...` URL plus
  `main_document=worksheet.tex`. Overleaf compiles in the browser; the instructor presses
  Recompile and downloads. No install.
- **Download .tex** (fallback) — a `.tex`, or a `.zip` when images are needed.

Images are prefetched when the export panel appears, not when a button is pressed: a click
handler that awaits a fetch has lost its user gesture by the time it submits, and the
Overleaf tab gets blocked as a popup.

The zip is written by a 30-line STORE-only writer in `worksheet_tex.js` (JPEG and PNG are
already compressed; a deflate dependency buys nothing).

## The fillable header

Name, EnergyTech ID and Group are **AcroForm text fields**, not dotted rules: typed on
screen, kept when the file is saved. `NeedAppearances` is true, so a viewer draws whatever
value the field holds — including one written in by a script, which is what makes the
round-trip testable.

**One field, one widget per page.** The header is a running header, shipped out once per
page, and `\TextField` called from there emits a *separate top-level field per page*, all
carrying the same `/T`. The PDF spec does not allow that among siblings and it leaves each
viewer to guess that the six boxes are one box. So the fields are built the way the radio
groups already were: a parent object reserved on first use, a widget appended per page, and
the parent written at the end with every widget as a kid. Verified structurally — 1 entry,
N kids, on papers up to 61 pages.

Two traps found by compiling:

- **`\AtEndDocument` runs before LaTeX's own `\clearpage`**, so the last page had not
  shipped when the fields were closed and its widget was orphaned. The hook now starts with
  its own `\clearpage`.
- **A bare `\pdfannot` in a horizontal list lands one slot early.** The Name box appeared at
  the start of the line and the Group box was painted over the word "Group:". The radio
  widgets had always wrapped theirs in `\makebox`; the text fields now do too. A test
  asserts no two header rectangles overlap.

`etReset` ("Clear all") resets a named list — the questions and the output fields — rather
than calling `doc.resetForm()` bare, which would also empty the name. Someone having
another go at the questions has not stopped being themselves.

Name has a line to itself: the roster is full of names like "Mohammed Abdullah Saleh
Al-Otaibi", and a box that clips one is worse than a dotted rule.

## The answer key

`ANSWER[]` is embedded in the PDF as document-level JavaScript — it must be, for the PDF to
mark itself. **It is readable in a text editor.** The instructor chose to have exams export
a self-marking paper too, so the only protection is the warning, which sits next to the
buttons on every export and is covered by a test.

The key is written **from JavaScript**, not accumulated by TeX. The hand-written worksheet
collected it into `\ws@keys` and emitted it with `\write`, and `\write` breaks its output at
`max_print_line` — 79 characters on a stock TeX Live. A paper long enough to pass that would
have had a comma turned into a newline in the middle of its key and graded wrongly from that
question on. Generating it directly removes the failure mode; both come from the same list in
the same order, so question *n* is question *n*.

## What compiling the real bank turned up

Every one of these was found by running pdflatex, not by reading. A bank written for a
browser renderer is full of LaTeX that only nearly works.

| Hazard | Count | Fix |
|---|---|---|
| `\par` run into the next sentence (`\parRound your answer`) | 24 | split on `\par` + capital only, so `\parbox` survives |
| Literal Unicode: `… ² ³ ° µ − × ⁴ '` | 1038 | `\DeclareUnicodeCharacter` with `\ensuremath` |
| `\dfrac` used outside math mode | many | `\let` + `\renewcommand` wrapping in `\ensuremath` |
| `[[DIAGRAM]]` placeholder | 36 | substituted with TikZ or `\includegraphics` |
| `<br>` left in two hand-edited bodies | 2 | converted to `\par` |

On TeX Live 2023 only U+2212 and U+2074 actually need declaring; the rest are kept
deliberately because Overleaf lets a project pin an older TeX Live. Only the two
load-bearing ones carry a mutation, because only those two can be shown to fail here.

Diagrams: 10 questions already carry their `tikzpicture` in the body and need nothing.
12 tape rulers get a parametrised `\taperuler{start}{end}{reading}` (the hand-written one
was hardcoded 12–18). 2 series circuits get `\etcircuit`. 22 use photographs, which are
bundled.

## The bug the tests missed, and now don't

`worksheet_tex.js` defined a bare `function splitChoices`, and **so does app.js**. The app
loads its scripts as plain `<script>` tags into one global scope; app.js loads second, its
version won, and every answer option exported as `[object Object]`. The worksheet still
compiled and still had four radio buttons per question — which is exactly why nothing
noticed.

Fixed by wrapping the module in an IIFE that exposes one `WorksheetExport` object. The
lesson in the tests: check the option *text*, not just that options exist.

Two related races surfaced from the same change. `.pane-empty` was worn by both the
"Loading…" placeholder and the real empty-state message in the profile, the report and the
attempt view, so tests could read "Loading…" and believe it. Placeholders now carry
`is-loading` and the tests wait for content.

## Files

- `worksheet_tex.js` — the generator (namespaced as `WorksheetExport`)
- `app.js` — `showWorksheetExport`, `downloadWorksheet`, `openWorksheetInOverleaf`
- `index.html` — the export panel under the session code
- `test_worksheet.js` — 88 checks; the second half compiles real papers with pdflatex, one
  per hazard, plus a whole 94-question set end to end, then fills the header, saves,
  reopens and reads the values back
- `test_worksheet_ui.js` — 43 checks; downloads the file **the browser produced** and
  compiles it, then reads the key back out of the PDF

## State

888 checks across 21 suites, all green. 82/82 mutations caught. Every question in both
banks — all 832 — compiles with zero errors; the key inside the compiled PDF matches the
bank exactly; the header is one field per name with a widget on every page on papers up to
61 pages. Service worker at `v48-worksheet-header-fields`.
