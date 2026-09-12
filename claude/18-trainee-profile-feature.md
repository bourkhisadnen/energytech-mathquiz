# Trainee profile and attempt review (v35)

Adnane asked for: clickable trainee name → profile page with solving history and insights such as weakest lessons; each history item clickable → the detailed results.

## Backend — two read actions

- `trainee_history(energytechId)` — the roster row, every attempt (newest first), and a per-lesson tally sorted worst-first.
- `attempt_detail(attemptId)` — the attempt row plus its item rows in quiz order.

## Tests — 441 checks across fourteen suites

- `test_history.js` (30)
- `test_profile.js` (38)

Mutation-tested: ranking lessons best-first, trusting a mismatched rebuild, and dropping the ownership filter — all caught.
