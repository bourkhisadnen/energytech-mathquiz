# Chapters 1 & 2 — full answer-key audit (v37)

All 456 questions across the four versions were independently re-derived and compared against the stored key. Result: **456 / 456 agree.**

## Defects found and fixed in `question_bank.js`

1. **version_c Q26** — lowest common denominator. Changed to 9, 12, 15 (LCD 180) and the key from (c) to (b).
2. **Six malformed operator bodies** — version_c and version_d, Q9 / Q11 / Q12. Fixed.
3. **original_pdf Q28** — stepped shaft. Key changed (c) → (d).
4. **original_pdf Q32** — figure was a bad crop. Replaced with complete figure.

## Tests

All green: 797 checks across 18 suites. **57 / 57 mutations are caught.**
