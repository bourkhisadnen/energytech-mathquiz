# Covering instructors: assigned groups, and a read-only roster

**Date:** 2026-09-12. Build `v59-covering-instructors` (was `v58-instructor-cards`).
**This one changes `Code.gs` — the Apps Script must be redeployed.** Every
change since Chapter 12A had been front-end only; this is the first that is not.

Adnen: only an admin creates intakes, groups and trainees; an admin can assign
groups to one or more instructors (for cover); an assigned instructor sees the
same roster card filtered to their groups, and may still reset their trainees'
passwords and open a trainee's record by clicking the name.

## What was already true

Worth recording, because it shaped the work: **every roster mutation was
already admin-only** in the backend (`intake_save`, `group_save`,
`trainee_save`/`delete`/`move`/`import`, `trainee_set_account` all call
`requireAdmin_`). Requirement one needed no code at all.

What was missing was the other half. `roster_list` and `trainee_list` were
readable by **any** signed-in instructor, unfiltered — harmless only because
the page hid the whole card from non-admins. The moment the card is shown to
instructors, that hiding is the only thing standing between one instructor and
the entire centre's roster, and hiding is not a rule. So the filtering moved
into `Code.gs`.

## The four questions, and Adnen's answers

All four were genuine policy forks, so they were put to him rather than guessed:

| question | chosen |
|---|---|
| whose papers appear in a trainee's history for a covering instructor | **only that instructor's own sessions** |
| how far an assignment reaches | **roster only** — not results, not session control |
| where the admin assigns | **per instructor**, on the Instructor accounts card |
| (implicit) delete the connection card, from the previous piece of work | — |

The first answer is the one that saved the most work: "only my own sessions" is
already what `traineeHistory_` does, so history needed **no backend change**.
It is worth knowing that a covering instructor stepping in fresh therefore sees
an *empty* record until they set their own paper. That is the chosen policy,
not a bug, and it is written into the README so it does not get "fixed" later.

## How assignment is stored

A single **`Assigned Groups`** column appended to the `Instructors` sheet,
holding `JAN26/G1;JAN26/G3`. A column rather than a sheet of its own because
`ensureHeaders_` appends it to an existing spreadsheet without touching a row —
the migration path every added column in this project has used.

`coversGroup_(auth, intake, group)` is the single question the whole feature
turns on: admins always true, everyone else by list membership. Every guard
calls it, so there is one place to be wrong rather than five.

Assigning a group that does not exist is **refused**, not stored. A stale
assignment to a renamed group would sit in the sheet granting nothing while
looking to the admin like access had been given.

## What an assigned instructor may do

See their groups and trainees; reset a trainee's password; open a trainee's
record. Nothing else. The password reset is the one write, and it is
deliberately no longer `requireAdmin_`: a trainee who has forgotten their
password is standing in front of whoever is teaching them that morning, and
sending them to find an admin is the reason the reset exists.

The action kept its `admin_reset_trainee_password` name so saved links and the
front end carry on working — the guard inside decides, not the name.

## Front-end notes

- The roster card is shown to everyone; `rosterCanEdit()` reads
  `viewer.canEdit` **from the backend's own reply**, falling back to the local
  role only before the first load lands. The page reflects what the server
  said rather than deciding for itself.
- **The search box would have broken.** It built its index with one unscoped
  `trainee_list`, which the backend now refuses from a non-admin — the search
  would have silently found nothing. Rather than remove the feature, an
  instructor's index is built group by group from `rosterCache.groups`, already
  filtered by the backend. `test_instructor_roster.js` §5 asserts the unscoped
  call is never made, because a page that made it would look fine right up
  until someone relaxed the backend.
- Empty states and the card's subtitle change wording for a read-only viewer;
  telling an instructor to press **+ New** when they have no + New is worse
  than saying nothing.

## A pre-existing layout bug, surfaced

The roster's row-actions column collapsed to 18px while holding 211px of
buttons, so Edit/Reset/Delete sat on top of the account badge. Cause:
`width: 1%` on the last cell is the usual "shrink to content" trick, and
`display: flex` on that same cell defeats it. **This affected admins too** and
had been there unnoticed — the roster card is only reached with trainees in it,
and no screenshot in this project had ever shown a populated group. Fixed with
`min-width: max-content`, and `style.css` is now a **fifth mutation target**
carrying one geometry mutant, since only a test that measures notices.

## Testing

- **`test_backend.js` §14 — 32 new checks** against the real `Code.gs`: an
  unassigned instructor sees no intakes, no groups, and is refused a direct
  `trainee_list`; an assigned one sees exactly their group and the intake it
  sits in; cannot create, edit, delete or move anything; can reset a password
  for their own trainee and not for the group next door; the temporary password
  actually works; unassigning takes it all back.
- **`test_instructor_roster.js` — 27 checks**, new: what the page draws for
  each role, the assign/unassign round trip, the scoped search, and the row
  actions fitting their column.
- **Two existing tests asserted the OLD policy and were updated, not deleted:**
  `test_roster.js` §13 (\"intake editor hidden from a plain instructor\" → shown
  but read-only) and `test_password_reset.js` §10 (admin-only → an instructor
  *with no groups* still refused). Each carries a comment saying what changed.
- **Ten new mutants**, all verified to bite: unfiltered `roster_list`, an
  unchecked `trainee_list`, an unchecked password reset, assignment losing its
  admin guard, an unvalidated group name, `coversGroup_` returning true for
  everyone, plus four on the page.
- **One mutant was written and then removed.** Deleting the "name the intake
  and group" early return in `trainee_list` *survived*: `coversGroup_` refuses
  an empty group anyway, so the check only improves the error message. The
  comment in `Code.gs` now says so, rather than implying the line is
  load-bearing.
- A stale mutant was retired: "any instructor may reset a trainee's password"
  patched `requireAdmin_`→`requireAuth_`, which is now the real code. The
  harness's pre-flight caught it and refused to run — exactly what it is for.
- Full battery: **31 suites**.

## Still open

- **Redeploy `Code.gs`.** Nothing here works until then, and the app is
  harmless in the meantime: the new column simply is not there, and every
  instructor sees an empty roster card.
- Suggested but not built, since Adnen chose "roster only": letting the
  dashboard cover assigned groups, and letting a covering instructor release
  marks or grant retakes on the regular teacher's exams. Both are a small step
  from `coversGroup_` if cover ever needs to be a full stand-in.
- An instructor's roster search fires one call per assigned group. Fine for a
  handful; if anyone is ever assigned a dozen, it wants batching.
