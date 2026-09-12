# Password reset — trainees and instructors

**Status:** built, tested, delivered. Service worker `v50-password-reset`.

## The problem

Trainees and instructors forget passwords. There is no email anywhere in this
app, so there is no reset link to send. Whatever we built had to work with the
only channel that actually exists: two people in the same room.

## What it does

An admin presses **Reset password**, the backend generates a temporary password,
returns it once, and the account is flagged **must change**. The admin reads the
password out; the person logs in with it and can do exactly one thing — choose
their own.

### Where the buttons are

- **A trainee:** Instructor Mode → roster workspace → **Reset password** on the
  trainee's row. Only shown when `accountStatus === 'active'`.
- **An instructor:** Instructor Mode → Instructor accounts (admin) →
  **Reset password** on the colleague's row. Not shown against the admin's own
  name — **Change my password** is the route for a password you still know.

### The temporary password

`makeTempPassword_()` — 8 characters in two groups of four (`67UU-KDCW`), from
the alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. No `O`, `0`, `I`, `l` or `1`,
because it gets read out loud and copied off a screen. Shown once with a
**Copy** button; only its hash reaches the sheet, and no listing (roster, roster
summary, instructor accounts) ever returns it. Lost before use → reset again.

## Decisions taken

| Question | Decision | Why |
|---|---|---|
| Reset mechanism | Temporary password + forced change at first login | No email exists; this is the only channel |
| Who may reset a trainee | Admins only | Same rule as every other roster edit |
| Who may reset an instructor | Any admin, including of a fellow admin | Otherwise a forgotten admin password is unrecoverable |
| An admin resetting themselves | Refused | Would sign them out mid-action; that is what Change password is for |
| Locked-out lone admin | A second admin does it | Nothing in-app can rescue a single admin — the panel now says so |

## The rules that matter

A reset does three things at once, and all three are load-bearing:

1. **The old password stops working** — new hash, new salt.
2. **Every device that account was signed in on is signed out**, immediately.
   Someone who forgot a password may well have lost the phone it was signed in
   on. Token columns are cleared (instructors 11–12, trainees 9–10).
3. **The account is flagged must-change.** `ALLOWED_WHILE_MUST_CHANGE` is the
   entire whitelist: `auth_change_password`, `auth_logout`,
   `trainee_change_password`, `trainee_logout`, `trainee_me`, `ping`. Everything
   else — roster, dashboard, sessions, a trainee's own history — gets
   `{ok:false, mustChangePassword:true}`.

**A flagged trainee cannot sit a paper.** The submission path used to fall back
to walk-in identity when a token failed to resolve; that would have quietly
recorded the attempt under the same name with no account attached. It now
refuses with `mustChangePassword` instead.

Choosing the new password clears the flag and spends the temporary one. The
change-password form refuses the temporary password as the new one.

## Schema

One new column on each sheet, **Must Change Password** — `Trainees` index 11,
`Instructors` index 12. Added by `ensureHeaders_` the first time the new
`Code.gs` answers a request. Existing rows untouched, no migration step.

## Testing

- `test_password_reset.js` — 59 checks (backend rules, boundaries, alphabet,
  header upgrade on an old sheet)
- `test_password_reset_ui.js` — 36 checks (real browser, both roles, the
  forced-change form)
- Full battery: 26 suites green
- Mutation suite: **103/103**

### A survivor worth remembering

The mutant *"a reset leaves the old session alive on whatever device had it"*
survived two rounds of fixes.

First round: the assertion only checked that the old token stopped working. But
the must-change flag is set at the same moment, and that alone refuses the call
— so the assertion passed with the token-clearing line deleted. Fixed by
asserting **which** refusal comes back: an unknown token says "Session expired",
a blocked one says "Your password was reset".

It still survived. The reason was ordering: the test logged Sara back in with
the temporary password *before* checking her old token, and a login issues a new
token that overwrites the stored one — killing the old session by itself. The
check had to move ahead of the re-login. (The trainee half of the test already
had the right order, which is why only the instructor mutant survived.)

Both failures are the same shape: the test observed an outcome that the code
under test was not the only possible cause of.

## Also fixed along the way

`rosterCall` in `app.js` carried a compatibility guard that threw on **any**
`{ok:true, message:...}` reply, meaning a trainee's own "Change my password" was
already broken in production. Narrowed to match `/backend is running/i`.
