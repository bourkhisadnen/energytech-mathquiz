# Exams: per-launch shuffling, and releasing results (v41)

Two features, both exam-only. Practice quizzes are untouched.

## 1. A different arrangement for every trainee

A new tick box on the session form, shown only when the mode is **Assessment**: *Shuffle question and choice order for each trainee.* It is cleared automatically if the mode is switched back to practice, so a stale tick cannot survive.

With it on, every load of the code produces a fresh arrangement — a different question order **and** a different order of the four choices within each question. The trainee at the next desk is looking at the same paper, arranged differently; so is the same trainee if they reload.

## Tests

- `test_shuffle.js` — 21 checks
- `test_exam_release.js` — 45 checks
- `test_exam_ui.js` — 24 checks in a browser
- `mutate_backend.js` — 21 mutations. **21 of 21 caught.**
