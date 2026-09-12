# The trainee's own results (v40)

A trainee logging in now sees their whole record on their home screen, below the session code box, and can open any past quiz question by question — the same review page they get after pressing Submit.

## What they see

- Four stats: quizzes taken, average, best, questions answered.
- **Lessons to go back over** — the same weakest-first lesson bars the instructor sees, worded for the trainee.
- **My quizzes** — every attempt, newest first. Tapping a row opens it: every question rebuilt from its stored seed, with the answer they gave and the right one marked.

## Tests

- `test_my_history.js` — 45 checks on the backend rules.
- `test_trainee_view.js` — 22 checks in a real browser.
- `mutate_backend.js` — **7 of 7 caught.**
