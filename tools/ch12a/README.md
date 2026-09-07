# Chapter 12A — how the bank was built and how its answers were checked

The worksheet arrived as four LaTeX files (versions A to D, 82 questions each)
plus one answer key covering **B, C and D only**. Version A had no key.

Run in this order, from this directory:

| script | what it does |
|---|---|
| `parse.py` | pulls the questions, options, lesson codes, figures and QR links out of the four `.tex` files |
| `render_figs.py` | compiles every TikZ figure with pdflatex and converts it to SVG (162 distinct drawings across the four versions) |
| `figdata.py` | reads the numeric labels printed inside each figure — most of these questions keep their dimensions in the picture, not the sentence |
| `geom.py` | reads a figure's actual geometry: its corners, which printed dimension is written against which edge, and which one marks a height |
| `verify_ch12a.py` | re-derives every answer from the question and its drawing, and compares against the supplied key |
| `mutate_verifier.py` | corrupts one key per question family and requires the verifier to notice |
| `key_a.py` | produces Version A's key, by computation and, where possible, by transfer from a version that has one |
| `build_bank.py` | writes `question_bank_ch12a.js`, copies the figures and collects the video links |

## Why this is trustworthy

`verify_ch12a.py` never reads an answer before deriving one. Run against the
three versions that came with a key, it reproduces **246 of 246** answers, and
`mutate_verifier.py` shows that all **48** question families would have
complained had one of those answers been wrong. The same code, unchanged, then
produces Version A's key: 82 of 82, of which 13 are independently confirmed by a
version that asks the identical question over the identical drawing.

## The trap worth remembering

"The same question" is not "the same sentence". Q17–Q23 are all *Name the
polygon* with the same four options, and Q45 is *what kind of triangle is this*
— identical wording in every version, a different shape drawn in each. Anything
that transfers an answer between versions has to compare the **drawing** too;
comparing the text alone silently equates a hexagon with an octagon.
