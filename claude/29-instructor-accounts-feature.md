# Instructor accounts (multi-instructor login)

Added 2026-08-16.

## Why

Adnen wanted colleagues to be able to use the quiz app too. The prior "instructor password" was a single shared password — not real access control.

## Decisions made

- **Data scope:** Isolated per instructor, but admins see everything.
- **Login method:** Username + password managed in the Google Sheet, checked server-side, hashed (salted SHA-256).
- **Account creation:** Self-signup — stays `pending` until an admin approves it.

## Known tradeoffs

- Login/signup send the password as a URL query param (via JSONP, over HTTPS).
- No rate limiting on login attempts.
- Good enough for classroom-tool access control; not a hardened auth system.
