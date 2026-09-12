# API Contract — extracted from the test suites

This is a record of what the front end (`app.js`) actually sends and actually reads back,
taken from the fake backends the test suites use. Nothing here has been tidied, renamed,
or normalized — where a field is inconsistent, optional, or only appears in one test, that
is written down as found.

## Sources, and why they are cited per action

Three different kinds of test double appear in `tools/`, and they are not equally
authoritative:

- **`[browser mock]`** — a hand-written `page.route(/script\.google\.com/, ...)` handler
  inside a Playwright test. This is a fixture that pretends to be the deployed Apps Script
  Web App, answering exactly the shape the author decided the frontend needs for that one
  scenario. This is the primary source for this document, and the one the user asked for.
- **`[gas_stub]`** — `test_backend.js`, `test_report.js`, `test_exam_release.js`,
  `test_retake.js`, `test_password_reset.js`, `test_history.js`, `test_my_history.js`,
  `test_name_migration.js`, `test_coercion.js`, `test_compat.js` all load the **real**
  `google_apps_script/Code.gs` and run it against `gas_stub.js`, an in-memory stand-in for
  `SpreadsheetApp`/`Utilities`. This is not a mock of the backend — it is the backend,
  running against fake Sheets. It is the more authoritative source for business rules
  (who may do what, what gets refused and why) and is cited separately from browser mocks.
- **`[Code.gs]`** — read directly from `google_apps_script/Code.gs`, used only where
  neither test type exercises a field that `app.js` nonetheless consumes. Flagged clearly
  every time it's used, since it's the one case where this document reports source code
  rather than a test result.

Every action below states which of these it's drawn from. Where a mock only returns the
generic `{ ok: true, message: 'ok' }` fallback for an action instead of a real branch,
that is called out explicitly — it means the *frontend* calls that action, but no browser
test actually specifies its shape.

## Transport, as it exists today

- **Reads** go through `getJsonp(url, params, callbackPrefix)` (`app.js:2755`): a `<script>`
  tag pointed at `${url}?action=...&...&callback=...`, so every parameter is a URL query
  parameter and the reply is `callbackName({...json...})`. There is no HTTP status code to
  fail on — a malformed or missing callback times out instead.
- **Writes** go through a plain `fetch(url, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) })`
  (`app.js:1666`, `2568`, `4056`). The response is opaque by construction (`no-cors`): the
  app cannot read status or body, so "did it work" is answered later by re-reading data
  with a GET action, never by the POST's own response. Each POST body carries a `type`
  field instead of `action`.
- Every GET action takes `token` as a plain query parameter alongside the request's own
  fields. There is no separate auth header or cookie anywhere in this transport.

---

## Diagnostics

### `ping`
- **Params:** none required.
- **Response:** `{ ok: true, message: 'EnergyTech Quiz backend is running.' }`
- **Source:** `[browser mock]` `test_roster.js:44` (also the `default:` branch of that same
  switch, `test_roster.js:179`, and the plain fallback `{ ok: true, message: 'ok' }` used
  by every other mock in the repo when an action isn't otherwise recognized).
- **Note:** `app.js`'s `testBackendConnection()` (`app.js:2800`) relies on the *contrast*
  between `ping` (must succeed even with no token) and `admin_list_instructors` /
  `roster_list` (must be *refused* with no token) to tell a current deployment from an old
  one that doesn't recognize those actions and falls through to a generic ok reply. Any
  reimplementation that answers an unrecognized action with `{ok:true}` will silently
  break this probe.

---

## Instructor auth and accounts

### `auth_login`
- **Params:** `{ action: 'auth_login', username, password }` (`app.js:2042`).
- **Response, success:** `{ ok: true, token, username, displayName, role }` where
  `role` is `'instructor'` or `'admin'`.
- **Response, must-change:** same shape plus `mustChangePassword: true` — the frontend
  treats this as "logged in exactly far enough to change the password," not a login
  (`app.js:2064`).
- **Response, failure:** `{ ok: false, error: 'Wrong username or password.' }`.
- **Source:** `[browser mock]` `test_roster.js:45-50`, `test_report_ui.js:71-72`,
  `test_panels.js:29-30`. `[gas_stub]` `test_backend.js:22-33` (bootstrap admin
  `adnen`/`12341234`, approval gating before a signed-up instructor can log in),
  `test_password_reset.js:36-68` (`mustChangePassword` branch, and that a reset
  invalidates the previous token entirely — see the password-reset section below).
- **Note (compat):** `app.js:2052` explicitly treats a reply with `ok:true` but no
  `token`/`username` as a **failure** — this is how it detects a pre-instructor-accounts
  deployment that has no `auth_login` branch and falls through to a generic ok reply.

### `auth_logout`
- **Params:** `{ action: 'auth_logout', token }` (`app.js:2098`), fire-and-forget
  (`.catch(() => {})`), response never read.
- **Source:** no mock defines a specific reply; every mock's generic fallback
  (`{ ok: true, message: 'ok' }`) answers it. `[gas_stub]` implicitly exercised wherever
  a subsequent call with the same token is expected to fail (e.g. `test_my_history.js:154-158`
  logs out then re-checks `my_history` is refused).

### `auth_signup`
- **Params:** `{ action: 'auth_signup', username, password, displayName }` (`app.js:2132`).
- **Response:** `{ ok: true }` on success; `{ ok: false, error }` (e.g. duplicate username)
  on failure.
- **Source:** `[gas_stub]` only — `test_backend.js:26-27`, `test_password_reset.js:23-27`,
  `test_compat.js:165-166`. **No browser-UI mock defines an `auth_signup` branch anywhere
  in `tools/`.** The instructor "request an account" screen that calls this action is
  therefore untested end-to-end in a real browser.
- **Note:** a freshly-signed-up account has `status: 'pending'` and cannot log in until
  an admin approves it (`test_backend.js:28-31`).

### `auth_change_password` (instructor)
- **Params:** `{ action: 'auth_change_password', token, oldPassword, newPassword }`
  (`app.js:2167`; also reached through `rosterCall` from the forced-change flow,
  `app.js:2445`).
- **Response:** `{ ok: true }` / `{ ok: false, error }` (wrong old password, or blocked
  behind `mustChangePassword` for every action *except* this one and its trainee
  equivalent — see the password-reset section).
- **Source:** `[gas_stub]` only — `test_backend.js` uses it implicitly through
  `admin_set_status`/login flows; `test_password_reset.js:82-88`,
  `:109`, `test_compat.js:171-173`. **No browser-UI mock defines this branch.**

### `admin_list_instructors`
- **Params:** `{ action: 'admin_list_instructors', token }` (`app.js:2185`).
- **Response, browser mocks:** `{ ok: true, instructors: [] }` — every browser-UI mock in
  the repo (`test_roster.js:51`, `test_report_ui.js:73`, `test_worksheet_ui.js:31`,
  `test_card_video.js:94`) returns an **empty list**. `test_instructor_roster.js:59-63` is
  the one browser mock with real content:
  ```
  { ok: true, instructors: [
    { username, displayName, role, status, assignedGroups: [{intake, group}, ...] },
    ...
  ]}
  ```
- **Response, `[gas_stub]`:** `test_backend.js:358-361` confirms the same per-instructor
  shape, including `assignedGroups` for a non-admin and (implicitly) that an admin's
  `assignedGroups` is not meaningful (admins see every group already).
- **Response, unauthenticated:** must be `{ ok: false, error }`, never a generic ok reply
  — this is the second leg of `testBackendConnection`'s version probe (`app.js:2813-2815`).
- **Fields used by `app.js`'s renderer** (`app.js:2269-2313`, so drawn from consumption,
  not from an assertion): `username`, `displayName`, `status` (`'pending' | 'approved' | 'rejected'`),
  `role` (`'instructor' | 'admin'`), `assignedGroups`.

### `admin_set_status`
- **Params:** `{ action: 'admin_set_status', token, targetUsername, status }`
  (`app.js:2318`). Status values sent by the UI: `'approved'` (Approve button,
  `app.js:3092`) and `'rejected'` (both the Reject button on a pending request *and* the
  button labelled "Revoke" on an already-approved account — `app.js:2288`,
  `3090-3092` — there is no distinct `'revoked'` value sent from this action; revoking
  an approved instructor sends the same `status: 'rejected'` as rejecting a pending one).
- **Response:** `{ ok: true }` / `{ ok: false, error }`.
- **Source:** `[gas_stub]` `test_backend.js:30-31` (approves a pending request).
  No browser-UI mock exercises this branch specifically.

### `admin_set_role`
- **Params:** `{ action: 'admin_set_role', token, targetUsername, role }`
  (`app.js:2473`). Role values sent by the UI: `'admin'` (Make admin,
  `app.js:3094`), `'instructor'` (Remove admin, `app.js:3096`).
- **Response:** `{ ok: true }` / `{ ok: false, error }`.
- **Source:** `[gas_stub]` `test_password_reset.js:27` (`admin_set_role` used to make
  a second account admin, so a lone admin can be rescued — see §7 there). No browser-UI
  mock exercises this branch.

### `admin_set_instructor_groups`
- **Params:** `{ action: 'admin_set_instructor_groups', token, username, groups }`
  where `groups` is a **single string**, semicolon-joined `"intake/group;intake/group"`,
  or `''` to unassign everything (`app.js:2261`, confirmed sent that way by
  `test_instructor_roster.js:212-213,228`).
- **Response:** `{ ok: true, username, assignedGroups: [{intake, group}, ...] }` on
  success (`test_instructor_roster.js:66`); `{ ok: false, error }` on refusal.
- **Source:** `[browser mock]` `test_instructor_roster.js:64-66`. `[gas_stub]`
  `test_backend.js:295-301,350-351` — an instructor cannot assign groups (not even to
  themselves), an admin cannot be assigned groups (they already see everything), and
  assigning a group that doesn't exist is refused rather than silently stored.

### `admin_reset_instructor_password`
- **Params:** `{ action: 'admin_reset_instructor_password', token, targetUsername }`
  (`app.js:2361`).
- **Response, success:** `{ ok: true, username, temporaryPassword, displayName }`
  (`displayName` inferred from `app.js:2364`'s use of `data.displayName || username`;
  not independently asserted by any test).
- **Response, failure:** `{ ok: false, error }` — refused for a non-admin caller
  (`/[Aa]dmin/` in the error), for an admin trying to reset **themselves** (told to use
  Change password instead), or for an unknown username.
- **Source:** `[gas_stub]` only — `test_password_reset.js:40-109`. **No browser-UI mock
  defines this branch anywhere in `tools/`.**
- **Design note (from the code comments, since this looks arbitrary out of context):**
  there is deliberately no way for a lone admin to reset their own forgotten password —
  `test_password_reset.js` §7 and `app.js:2295-2304`'s "You are the only admin" banner
  exist because the only rescue is a second admin resetting the first.

---

## Roster: intakes, groups, trainees

### `roster_list`
- **Params:** `{ action: 'roster_list', token }` (`app.js` via `rosterCall`, `:3543`).
- **Response, admin:**
  ```
  { ok: true,
    intakes: [{ label, status: 'active' }, ...],
    groups: [{ intake, name, trainees, withAccount }, ...],
    viewer: { username, role, canEdit: true, assignedGroups: null } }
  ```
- **Response, instructor with groups assigned:** same shape, but `intakes`/`groups`
  filtered to only what's assigned; `viewer.canEdit: false`,
  `viewer.assignedGroups: [{intake, group}, ...]`.
- **Response, instructor with nothing assigned:** `intakes: []`, `groups: []`,
  `viewer.canEdit: false`, `viewer.assignedGroups: []`. Still `ok: true` — a covering
  instructor is allowed to call this, they're just shown nothing
  (`test_backend.js:284-288`).
- **Source:** `[browser mock]` `test_roster.js:52-61` (full CRUD-backed version),
  `test_instructor_roster.js:41-48` (the `viewer` object, admin-vs-instructor filtering).
  `[gas_stub]` `test_backend.js:39-40,284-314`.
- **Note:** must be refused (`{ok:false}`) with no token — the first leg of the
  version-probe pair with `admin_list_instructors` (`app.js:2816-2818`).

### `intake_save`
- **Params:** `{ action: 'intake_save', token, label, previousLabel? }`. Omitting
  `previousLabel` creates; including it renames (`app.js:4930,5066`).
- **Response, create:** `{ ok: true, label }`.
- **Response, rename:** `{ ok: true, label }` (the new label).
- **Response, failure:** `{ ok: false, error }` — empty label, duplicate label
  (case-insensitive), unknown `previousLabel`, or not an admin.
- **Source:** `[browser mock]` `test_roster.js:68-83`. `[gas_stub]`
  `test_backend.js:41-52,122-129` (rename cascades to every group and trainee whose
  `intake` matched the old label), `test_coercion.js:13-27` (a month-like label such as
  `MAY26` must round-trip as the literal string, never a coerced date).
- **Note:** delete is blocked while any group still references the intake —
  `{ ok: false, error: 'Intake X still has N group(s). Delete or move them first.' }`
  (`test_roster.js:84-91`, `test_backend.js:109-111`).

### `intake_delete`
- **Params:** `{ action: 'intake_delete', token, label }` (`app.js:5079`).
- **Response:** `{ ok: true, deleted: label }` / `{ ok: false, error }` (blocked while
  groups exist, as above).
- **Source:** as `intake_save` above.

### `group_save`
- **Params:** `{ action: 'group_save', token, intake, name, previousName? }`
  (`app.js:4949,5094`).
- **Response:** `{ ok: true, name }` (create or rename).
- **Response, failure:** `{ ok: false, error }` — name must match `^G([1-9]|1[0-9]|20)$`
  (`G1`–`G20`, case-normalized), intake must exist, duplicate name within the same intake
  refused, not-admin refused.
- **Source:** `[browser mock]` `test_roster.js:92-109`. `[gas_stub]`
  `test_backend.js:54-73,131-133` (rename cascades trainees' `group` field).
- **Note:** delete is blocked while any trainee is in the group —
  `{ ok: false, error: '<name> in <intake> still has N trainee(s). Remove them first.' }`.

### `group_delete`
- **Params:** `{ action: 'group_delete', token, intake, name }` (`app.js:5106`).
- **Response:** `{ ok: true, deleted: name }` / `{ ok: false, error }`.
- **Source:** as `group_save` above.

### `trainee_save`
- **Params:** `{ action: 'trainee_save', token, energytechId, name, intake, group, previousId? }`.
  `previousId` present ⇒ edit/move an existing row; absent ⇒ create
  (`app.js:4973,5133`).
- **Response, create:** `{ ok: true, energytechId }`.
- **Response, edit:** `{ ok: true, energytechId, updated: true }`.
- **Response, failure:** `{ ok: false, error }` — empty ID, target group doesn't exist,
  or (create only) ID already in use by another row.
- **Source:** `[browser mock]` `test_roster.js:118-134`. `[gas_stub]`
  `test_backend.js:75-90` (editing via `previousId` moves the row rather than creating a
  second one), `test_coercion.js:34-39` (an all-digit ID like `0012345` keeps its leading
  zeros — never coerced to a number), `test_name_migration.js:44-102` (name is a single
  field; the old two-column `Family Name`/`Given Name` schema is migrated in place, joined
  given-then-family, and the API never exposes `familyName`/`givenName`).

### `trainee_delete`
- **Params:** `{ action: 'trainee_delete', token, energytechId }` (`app.js:5156`).
- **Response:** `{ ok: true, deleted: energytechId }`.
- **Response, failure:** `{ ok: false, error: 'Trainee <id> has recorded attempt(s). Revoke the account instead.' }`
  — deletion is permanently blocked once the trainee has any attempt on record, with no
  override (`test_roster.js:135-141`, `test_backend.js:138,233-237`).

### `trainee_set_account`
- **Params:** `{ action: 'trainee_set_account', token, energytechId, status }`. Values
  observed sent by the UI: `'revoked'` (bulk revoke, `app.js:5032`) and `'active'`
  (restoring — only exercised in `[gas_stub]` tests, e.g. `test_password_reset.js:171,178`;
  no UI element for turning an account back on other than this action existing).
- **Response:** `{ ok: true, status }` / `{ ok: false, error }` (unknown trainee).
- **Source:** `[browser mock]` `test_roster.js:142-148` (only sets/reads `accountStatus`,
  does not enumerate all valid values). `[gas_stub]` `test_my_history.js:116-144` — revoking
  clears the trainee's live token immediately (an old token dies even before it expires;
  reactivating does **not** revive the old token, a fresh login is required), and the
  status is re-checked on every call, not cached at login (`test_my_history.js §8b`).

### `trainee_move`
- **Params:** `{ action: 'trainee_move', token, intake, group, ids }` where `ids` is a
  **comma-joined string** of EnergyTech IDs (`app.js:5013`).
- **Response:** `{ ok: true, moved: <count>, missing: [<id>, ...] }` — `missing` lists any
  ID that didn't resolve to a real trainee; unresolvable IDs don't fail the whole call.
- **Response, failure:** `{ ok: false, error }` — target group doesn't exist, or no IDs
  given at all.
- **Source:** `[browser mock]` `test_roster.js:149-162`. `[gas_stub]`
  `test_name_migration.js:96-98` (moving a trainee leaves their name alone).

### `trainee_list`
- **Params:** `{ action: 'trainee_list', token, intake?, group? }` (`app.js:3829,4064`, and
  the unfiltered form `{ token }` alone used by `refreshTrainees`, `app.js:3901`).
- **Response, admin, filtered:** `{ ok: true, trainees: [{ energytechId, name, intake, group, accountStatus }, ...] }`.
- **Response, admin, unfiltered:** same shape covering every trainee in the centre.
- **Response, instructor:** `{ ok: false, error: 'Name the intake and group.' }` if either
  `intake` or `group` is missing; `{ ok: false, error: 'That group is not assigned to you.' }`
  if named but not covered by them; the plain filtered success shape if it is covered.
  **A non-admin can never get the unfiltered (whole-centre) list** — this refusal is
  security-relevant, not cosmetic: `test_instructor_roster.js`'s whole §5 exists to pin that
  the roster search UI never even attempts the unscoped call, because *if it ever did* and
  a future backend edit relaxed the refusal, the search box would quietly leak the whole
  centre to any signed-in instructor.
- **`accountStatus` values observed:** `'none'`, `'active'`, `'revoked'`.
- **Source:** `[browser mock]` `test_roster.js:62-67`, `test_instructor_roster.js:49-58`.
  `[gas_stub]` `test_backend.js:39-40,81-83,289-312`.

### `admin_reset_trainee_password`
- **Params:** `{ action: 'admin_reset_trainee_password', token, energytechId }`
  (`app.js:2373`).
- **Response, success:** `{ ok: true, energytechId, name, temporaryPassword }`.
- **Response, failure:** `{ ok: false, error }` — not on roster, no account yet
  (`'no account yet'`, told to sign up instead of being handed a password), account
  revoked (`'turned off'`, told to reactivate first), or (for a non-admin instructor)
  the trainee's group isn't assigned to them (`'assigned to you'`).
- **Source:** `[browser mock]` `test_instructor_roster.js:67-68,251-264` (this is the one
  write a non-admin instructor is allowed to make — for a trainee in a group assigned to
  them). `[gas_stub]` `test_backend.js:328-338`, `test_password_reset.js:116-197` — the
  temporary password:
  - never contains `O`, `0`, `I`, `l`, or `1` (avoids characters that are misheard read
    aloud or misread on screen),
  - is fresh every call (never repeats across 12 consecutive resets in the test),
  - is at least 6 characters,
  - appears **nowhere else** — not in `trainee_list`, `roster_list`,
    `admin_list_instructors`, or the raw sheet — it comes back exactly once, in this
    response, and the trainee's `mustChangePassword` flag is the only trace left behind.

---

## Trainee auth

### `trainee_login`
- **Params:** `{ action: 'trainee_login', energytechId, password }` (`app.js:3358`).
- **Response, success:** `{ ok: true, token, trainee: { energytechId, name, intake, group, accountStatus } }`.
- **Response, must-change:** same plus `mustChangePassword: true`.
- **Response, failure:** `{ ok: false, error: 'Wrong EnergyTech ID or password.' }`.
- **Source:** `[browser mock]` throughout the exam/trainee suites (e.g.
  `test_exam_ui.js:45-46`, `test_retake_ui.js:43-44`). `[gas_stub]`
  `test_backend.js:140-180` — logging in **retires the previous token** (only one live
  session per account at a time; the token from signup stops working the moment a login
  issues a new one).

### `trainee_signup`
- **Params:** `{ action: 'trainee_signup', energytechId, password }` (`app.js:3400`).
- **Response, success:** `{ ok: true, token, trainee: { energytechId, name, intake, group, accountStatus: 'active' } }`
  — no password/hash material of any kind in the reply (`test_backend.js:148`).
- **Response, failure:** `{ ok: false, error }` — ID not on any roster, password under 6
  characters, or an account already exists for that ID (case-insensitive match on the ID).
- **Source:** `[browser mock]` `test_roster.js:163-171`. `[gas_stub]` `test_backend.js:140-151`.

### `trainee_logout`
- **Params:** `{ action: 'trainee_logout', token }` (`app.js:3427`), fire-and-forget.
- **Source:** answered by the generic fallback in every browser mock;
  `[gas_stub]` `test_my_history.js:154-158` confirms the token is actually retired.

### `trainee_change_password`
- **Params:** `{ action: 'trainee_change_password', token, oldPassword, newPassword }`
  (`app.js:3442`, and via `rosterCall` from the forced-change flow, `:2445`).
- **Response:** `{ ok: true }` / `{ ok: false, error }`.
- **Source:** `[gas_stub]` only — `test_backend.js:162-165`, `test_password_reset.js:146-150`.
  No browser-UI mock defines this branch.

### `trainee_me`
- **Params:** `{ token }`.
- **Response:** `{ ok: true, trainee: { energytechId, name, ... } }`.
- **Source:** `[gas_stub]` only — `test_backend.js:159-160`, `test_name_migration.js:76-78`
  (used there specifically to prove a **token issued before the name-column migration**
  still resolves correctly afterward). **`app.js` never calls this action.** It exists in
  `Code.gs` and is exercised by the backend test suite, but has no frontend caller and
  therefore no browser mock either. Worth deciding deliberately whether the new backend
  keeps it (dead code) or drops it.

---

## Password-reset / forced-change mechanics (cross-cutting)

Not a single action, but a rule enforced identically on both the instructor and trainee
side, worth documenting once rather than per-action:

- A reset (`admin_reset_instructor_password` / `admin_reset_trainee_password`) **destroys
  the account's current live token outright**, not merely flags it. A session open on
  another device gets `{ ok: false, error: 'Session expired' | 'Not logged in' }` (an
  unknown-token refusal), **not** `{ mustChangePassword: true }` — the distinction is
  tested explicitly (`test_password_reset.js:56-63`) because a token merely being blocked
  behind the flag would look identical from the outside and hide a bug where the token
  wasn't actually destroyed.
- Logging in with the temporary password succeeds and returns `mustChangePassword: true`.
  Every other action refuses with `{ ok: false, mustChangePassword: true }` while that flag
  is set — **including submitting a quiz attempt** (`test_password_reset.js:138-144`: the
  submission is refused outright, not silently downgraded to a walk-in identity).
  `auth_change_password` / `trainee_change_password` are the only two actions that work
  while blocked.
- Changing the password clears the flag and the temporary password stops working
  immediately.
- `Code.gs`'s own `ensureSheets_()` adds the `Must Change Password` column to both the
  Instructors and Trainees sheets when it's missing, without disturbing existing rows
  (`test_password_reset.js:199-213`) — relevant to the migration's `must_change_password`
  boolean column, which needs no equivalent since it isn't retrofitted onto anything.

---

## Sessions (instructor side)

### `quiz_session` (POST, `type` not `action`)
- **Sent as:** `fetch(url, { method:'POST', mode:'no-cors', body: JSON.stringify({ type: 'quiz_session', token, session: {...} }) })`
  (`app.js:2485-2511,2568`). Response is opaque; never read directly — confirmed
  afterward by polling the `session` GET action (see below).
- **`session` object fields sent by the current UI:**
  ```
  { sessionCode, sessionName, intake, group, allowWalkIn, shuffleEachLaunch,
    questionSetKey, questionSet, questionCount, seed, orderMode, mode,
    showOriginalNumbers, requireAll: true }
  ```
- **Compatibility:** an **older** frontend build sends a strict subset — no `intake`, no
  `allowWalkIn` (`test_compat.js:94-107`) — and the backend must still accept it, defaulting
  the missing fields (`intake: ''`, `allowWalkIn: false`).
- **`sessionCode` generation** (client-side, `app.js:4479-4483`): `<GROUP-OR-INTAKE, alnum, upper, max 6 chars>-<random 4-digit number 1000-9999>`, e.g. `G1-4826`. Not guaranteed unique — the format has no server-side uniqueness check surfaced anywhere in the tests.
- **Re-saving cascades:** saving over an existing `sessionCode` creates a **new** logical
  session — any previous `published` state is **not** carried over; a freshly re-saved
  exam always starts unreleased again (`test_exam_release.js:139-146`,
  `[gas_stub]`). The migration plan's `superseded_at` column is the intended
  implementation of this rule.
- **Ownership:** the session's owner is whoever's `token` created it; `session_publish`,
  `session_unpublish`, `session_report`, `retake_allow`, `retake_list` are all refused to
  any other non-admin instructor.

### `session` (GET)
- **Params:** `{ action: 'session', code }`, optionally `{ ..., token }` — the token is
  what unlocks the `sitting` field (`app.js:2867,2888`).
- **Response, found, no token:** `{ ok: true, session: {...}, sitting: null }`.
- **Response, found, with token:** `{ ok: true, session: {...}, sitting: { sat, allowed, maySit } }`
  where, for `mode: 'assessment'`, `maySit = sat < allowed`; for `mode: 'practice'`,
  `maySit` is always `true` regardless of `sat`/`allowed`.
- **Response, not found:** `{ ok: false, error: 'Session not found.' }` (or similar —
  wording varies slightly by mock; the frontend only checks `ok`).
- **Source:** `[browser mock]` throughout the exam suites, e.g. `test_exam_confirm.js:44-45`,
  `test_exam_view.js:41-44`. `[gas_stub]` `test_retake.js:73-83` (the sitting math
  end-to-end), `test_coercion.js:66` (`session.intake` round-trips as the literal label
  text, not a coerced value), `test_compat.js:89-107` (an old-shaped session with no
  `intake`/`allowWalkIn` still resolves and reports safe defaults).
- **Note (client behavior around this, not the API itself):** the frontend distinguishes
  "backend said no such session" (`ok:false`) from "couldn't reach the backend at all"
  (`fetchSessionByCode`'s `{ unreachable: true }`, `app.js:2884-2901`) and shows a different
  message for each — deliberately, so a trainee isn't told to retype a code that was
  actually fine (`app.js:2929-2933`). An exam that cannot resolve `sitting` because the
  backend is unreachable **refuses to start at all** rather than guessing
  (`test_retake_ui.js §6`) — there being no way to know if this trainee already sat it.

### `session_list`
- **Params:** `{ action: 'session_list', token }` (`app.js:4431`).
- **Response:** `{ ok: true, sessions: [ { sessionCode, sessionName, intake, group, mode, questionSet, shuffleEachLaunch, published, attempts, timestamp }, ... ] }`,
  newest first, scoped to the caller's own sessions unless admin (all sessions).
  A trainee token is refused outright (`{ ok: false }`), not merely scoped to nothing.
- **Source:** `[gas_stub]` `test_exam_release.js:128-137` (ownership scoping, newest-first,
  `attempts` and `published` fields). `[browser mock]` `test_report_ui.js:44-54` supplies
  a richer fixture including `timestamp` and an `owner` field, but `owner` is **not**
  independently confirmed by the `[gas_stub]` test — treat it as UI-mock-only until
  checked against `Code.gs` directly.

### `session_publish` / `session_unpublish`
- **Params:** `{ action: 'session_publish' | 'session_unpublish', token, sessionCode }`
  (`app.js:4547`).
- **Response:** `{ ok: true, published: true|false }` / `{ ok: false, error }` — refused for
  a non-owning instructor, a trainee token, no token, or an unknown code.
- **Effect:** flips whether the exam's marks (score/total/percent + the attempt id needed
  to open the paper) are visible through `my_history`/`my_attempt` for every trainee in
  that session, and whether that lesson's questions count in the trainee's own lesson-bar
  analysis. Nothing about `trainee_history`/`attempt_detail` (the instructor's own view)
  is gated by this — the instructor always sees the mark, release only controls whether
  the *trainee* does.
- **Source:** `[gas_stub]` only — `test_exam_release.js` (the whole file). **No
  browser-UI mock in `tools/` defines either action**; the UI's Release/Hide buttons that
  call `setSessionPublished()` are therefore never driven end-to-end against a mocked
  JSONP handler, only against the real `Code.gs`.

### `retake_list`
- **Params:** `{ action: 'retake_list', token, sessionCode }` (`app.js:4517`).
- **Response:** `{ ok: true, sessionCode, trainees: [{ energytechId, name, sat, allowed, maySitAgain }, ...] }`,
  sorted by `energytechId`. `sessionCode` in the response is confirmed by `Code.gs:938`
  directly (`[Code.gs]`) — no test in either category asserts it, but `app.js`'s
  `renderRetakePanel` (`:4496`) depends on it matching the requested code to know the
  panel has actually loaded rather than still be showing a stale one.
- **Source:** `[gas_stub]` only — `test_retake.js:120-127`. **No browser-UI mock defines
  this branch.**

### `retake_allow`
- **Params:** `{ action: 'retake_allow', token, sessionCode, energytechId }`
  (`app.js:4528`).
- **Response, success:** `{ ok: true, sessionCode, energytechId, sat, allowed }` (per
  `Code.gs:908`, `[Code.gs]`; `[gas_stub]` `test_retake.js:86-88` only asserts `sat`/`allowed`).
- **Response, failure:** `{ ok: false, error }` — refused for a non-owning instructor, a
  trainee token, no token, an unknown trainee, or an unknown session.
- **Effect:** entitlement is `1 + (number of grants)`. A grant is **spent by being used**
  — after the granted sitting is submitted, `maySit` goes back to `false`; it is not a
  standing door left open (`test_retake.js §6-7`).
- **Source:** `[gas_stub]` only — `test_retake.js`, `test_report.js:145-153` (a re-sat
  trainee still counts as **one** trainee in the session report, with `sittingCount: 2`
  and a `sittings` array of every sitting, newest first, standing on the **latest**
  sitting's score). **No browser-UI mock defines this branch** — `test_retake_ui.js`
  simulates the effect of a grant by directly mutating a local `allowed` counter in its
  own mock rather than routing the click through `retake_allow`, so the actual request
  shape for that button is untested in a browser.

---

## Sitting an exam / submitting

### `quiz_attempt` (POST, `type` not `action`)
- **Sent as:** `fetch(url, {..., body: JSON.stringify(payload)})` (`app.js:1666`), where
  `payload` is built by `buildSubmissionPayload()` (`app.js:1583-1627`):
  ```
  { type: 'quiz_attempt',
    attemptId: 'ATT-<timestamp>-<random6>',
    submittedAt: <ISO8601>,
    traineeToken: <string, '' for a walk-in>,
    student: { name, group, energytechId, spspId: energytechId },
    session: <the currentSession object, or {}>,
    quiz: { sessionCode, sessionName, mode, questionSet, questionSetKey, seed,
            orderMode, orderSeed, questionCount },
    score: { correct, total, percent, wrongQuestions: [<'Q<n> (Original Q<m>)'>, ...],
             unansweredQuestions: [...] },
    items: [ { quizNumber, originalNumber, lesson, studentAnswer, correctAnswer, result }, ... ],
    userAgent }
  ```
- **When `traineeToken` is present and valid,** the backend ignores the `student` block
  entirely and takes name/group/ID/intake from the roster row the token belongs to —
  the client-typed name/group/ID are **only used for a walk-in** (`test_backend.js §11`,
  `test_compat.js §4-5`). A garbage or expired token is treated exactly like no token at
  all (walk-in), never as an error (`test_backend.js:218-226`).
- **`result` values:** `'correct' | 'wrong' | 'unanswered'`.
- **One sitting per exam, enforced at the write, not just in the UI:** a second
  `quiz_attempt` for the same `(sessionCode, trainee)` pair where `mode: 'assessment'` is
  refused — `{ ok: false, error: 'already been submitted' }` (wording varies slightly
  between mocks: `'already submitted'` in `test_retake_ui.js:29`) — and **nothing is
  written**. Practice mode has no limit at all (`test_retake.js §1-4`). A walk-in sitting
  (no token) has **no limit either**, exam or not — "turn walk-ins off for an exam" is the
  documented mitigation, not a server-side rule (`test_retake.js §10`).
- **Because the POST is opaque (`no-cors`),** the frontend cannot read this response at
  all — success or failure both look like "the request didn't throw." What actually
  happened is inferred afterward by re-reading via `my_history`/`session` (see
  `confirmExamRecorded`-style logic tested in `test_exam_confirm.js`).
- **Source:** `[browser mock]` for the client-visible shape, throughout the exam suites.
  `[gas_stub]` `test_backend.js §11`, `test_retake.js`, `test_compat.js §4-5` for the
  server-side identity/limit rules.

### `trainee_import` (POST, `type` not `action`)
- **Sent as:** `{ type: 'trainee_import', token, intake, rows: [{ energytechId, name, group? }, ...] }`
  (`app.js:4059`) — `group` per-row overrides the top-level `intake`-wide default group
  used for rows that don't specify one (in practice the current UI always sends the group
  per row already, resolved client-side from the CSV).
- **Response:** opaque (`no-cors`); the frontend confirms what actually landed by
  re-reading `trainee_list` in a retry loop afterward (`app.js:4061-4070`).
- **Server behavior, `[gas_stub]`** (`test_backend.js §6`, `test_roster.js:185-202`):
  creates any group named in a row that doesn't already exist; skips a row whose group
  name doesn't match `G1`–`G20` and (per `test_roster.js:195`) **aborts the whole import**
  if any row's group is malformed, rather than partially importing; skips a duplicate
  `energytechId` (existing row is left untouched, not overwritten); lower-cases-normalizes
  IDs on the way in; a non-admin caller's import is refused entirely
  (`test_backend.js:106-107`).

---

## History and reports

### `trainee_history` (instructor route)
- **Params:** `{ action: 'trainee_history', token, energytechId }`.
- **Response:** `{ ok: true, trainee: { energytechId, name, group, intake, ... }, attempts: [...], lessons: [...] }`.
  - `attempts`: newest first, each `{ attemptId, timestamp, sessionCode, sessionName, mode, questionSet, questionSetKey, seed, questionCount, orderMode, score, total, percent, registered, released? }`.
    Under an unreleased exam gate (viewed by the instructor who is **not** the session
    owner and not an admin — see below), attempts from sessions they didn't run are
    simply **absent from the list**, not present-with-nulls.
  - `lessons`: `{ lesson, correct, total, percent }`, worst (lowest `percent`) first,
    computed only from questions the viewer is allowed to see (their own sessions, unless
    admin) — an unanswered question counts toward `total` but not `correct`.
- **Scoping:** an instructor sees only attempts from sessions **they themselves ran**;
  an admin sees everything for that trainee regardless of who ran it
  (`test_history.js §7`).
- **Source:** `[browser mock]` `test_profile.js:36-40`. `[gas_stub]`
  `test_history.js` (whole file), `test_backend.js §14` (a covering instructor sees only
  attempts on sessions **they** created, even for a trainee they're allowed to view).

### `attempt_detail` (instructor route)
- **Params:** `{ action: 'attempt_detail', token, attemptId }`.
- **Response:** `{ ok: true, attempt: { attemptId, timestamp, name, group?, energytechId?, sessionCode, sessionName, mode, questionSet, questionSetKey, seed, questionCount, orderMode, orderSeed, score, total, percent }, items: [ { quizNumber, originalNumber, lesson, answer, correctAnswer, result }, ... ] }`.
  **Note the field-name change from the submission payload:** items are read back with
  `answer`, not the `studentAnswer` name they were submitted under
  (`test_history.js:75`, `test_report_ui.js:96-102`).
- **Response, refused:** `{ ok: false, error }` — unknown attempt id, or (for a
  non-admin) an attempt from a session owned by a different instructor
  (`test_report.js:182-183`), or an unreleased exam attempt for anyone but the owning
  instructor/admin (see `session_publish`, and `test_exam_release.js:74-79`: the refusal
  carries **no answers at all**, not even redacted ones — `!/correctAnswer|"items"/.test(...)`).
- **Source:** `[browser mock]` `test_profile.js:41-46`, `test_report_ui.js:91-103`.
  `[gas_stub]` `test_history.js:68-77`, `test_exam_release.js:74-88`.

### `my_history` (trainee's own route)
- **Params:** `{ action: 'my_history', token }` — identity comes **only** from the token;
  any other parameter (e.g. a stray `energytechId`) is ignored, not honored
  (`test_my_history.js §8c`).
- **Response:** `{ ok: true, trainee: {...}, attempts: [...], lessons: [...] }` — same
  per-attempt/per-lesson shape as `trainee_history`, but scoped to "every attempt this
  trainee has sat, regardless of which instructor ran the session" (the opposite scoping
  rule from the instructor route) and excluding anything belonging to another trainee.
- **Attempt fields include `registered`:** `'yes'` (their own signed-in attempt),
  `'walk-in'` (a guest sitting recorded under this trainee's typed ID by someone else, or
  by themselves before signing in — shown to them, not hidden, specifically so they find
  out) (`test_my_history.js §10`).
- **Unreleased exam branch:** the row for an unreleased exam is present (so the trainee
  knows it was recorded) but reports `released: false`, `score: null, total: null, percent: null`,
  `attemptId: ''` (nothing to open), while still carrying the real `sessionName`
  (`test_exam_release.js §1`). Its questions are excluded from `lessons` entirely — not
  zeroed, **absent** — so an exam mark cannot be reconstructed by reading the lesson bars
  (`test_exam_release.js §2`).
- **Source:** `[browser mock]` throughout the trainee-facing suites, e.g.
  `test_trainee_view.js:60-62`, `test_exam_ui.js:47-58`. `[gas_stub]`
  `test_my_history.js` (whole file), `test_exam_release.js §1-2,6`.

### `my_attempt` (trainee's own route)
- **Params:** `{ action: 'my_attempt', token, attemptId }`.
- **Response:** same shape as `attempt_detail`, scoped to the token's own attempts only
  — another trainee's real attempt id is refused with no leakage of any field
  (`test_my_history.js §5`), and an unreleased exam's attempt is refused with the message
  `'Your instructor has not released the results of this exam yet.'` even to the trainee
  who sat it (`test_exam_ui.js:61-62`, `test_exam_release.js §3`).
- **Source:** `[browser mock]` `test_exam_ui.js:63-69`, `test_trainee_view.js:63-64`,
  `test_profile.js` (shared body). `[gas_stub]` `test_my_history.js §4-7`.

### `session_report`
- **Params:** `{ action: 'session_report', token, sessionCode }` (`app.js:4653`).
- **Response, success:**
  ```
  { ok: true,
    session: { sessionName, mode, intake, group, published, ... },
    trainees: [ { energytechId, name, group, intake, onRoster, attemptId, timestamp,
                  score, total, percent, registered, sittingCount, sittings: [{attemptId, percent, ...}, ...] }, ... ],
    absent: [ { energytechId, name, intake, group }, ... ] }
  ```
  - `trainees` holds one row per trainee even if they sat more than once; `sittingCount`
    and the `sittings` array (newest first) capture the retake history, and the row's own
    `score`/`total`/`percent`/`attemptId` stand on the **latest** sitting.
  - `absent` is every trainee in the session's own group who has **no** row — trainees
    from a *different* group are never called absent even if they also never sat it.
  - `onRoster: false` marks a walk-in whose typed name/ID don't (yet) match a real roster
    row; once the same ID is added to the roster, the row's `name` switches to the
    roster's name and `onRoster` flips to `true` retroactively — the roster is treated as
    the current authority on a name, not the sitting.
  - The full mark is shown to the instructor here **regardless of whether the exam has
    been released to trainees** — release only gates what `my_history`/`my_attempt`
    (the trainee-facing routes) show; the report is how the instructor decides whether to
    release in the first place (`test_report.js §3`).
- **Response, refused:** `{ ok: false, error }` — no token, unknown `sessionCode`
  (`'not found'`), empty code, or (for a non-admin) a session owned by another instructor
  (`'another instructor'`). A row the requesting viewer could not open via `attempt_detail`
  (e.g. re-stamped to another owner) is **excluded from `trainees` rather than listed and
  then failing to open** (`test_report.js §6b`).
- **Pass mark is hardcoded at 70%,** distinct from the 50/80 bands used elsewhere in the
  app (`test_report_ui.js §4` — this is a UI-rendering detail, `.good-text`/`.bad-text`,
  not a field in the response itself, but worth carrying over since it's a real rule).
- **Source:** `[browser mock]` `test_report_ui.js:78-103` (full fixture including the
  `held-back` UI text). `[gas_stub]` `test_report.js` (whole file, the authoritative
  source for every field above).

### `summary` (instructor dashboard)
- **Params:** `{ action: 'summary', token }` (`app.js:1733`).
- **Response:**
  ```
  { ok: true,
    attempts: [ { timestamp, name, group, energytechId, sessionCode, mode, questionSet,
                  score, total, percent, wrongCount, unansweredCount,
                  ownerUsername, ownerDisplayName, intake, registered }, ... ],
    questionAnalysis: [ { sessionCode, mode, questionSet, questionSetKey, originalNumber,
                           lesson, attempts, correct, wrong, unanswered, successRate,
                           commonWrong, ownerUsername, ownerDisplayName }, ... ],
    lessonAnalysis: [ { sessionCode, mode, questionSet, questionSetKey, lesson,
                         attempts, correct, wrong, unanswered, successRate,
                         ownerUsername, ownerDisplayName }, ... ],
    viewer: { username, displayName, role } }
  ```
- **Scoping:** non-admin sees only their own sessions' data in all three arrays; admin
  sees everything, and `app.js` shows an extra "Instructor" column when
  `viewer.role === 'admin'` (`app.js:1763-1767`).
- **`commonWrong`** is a formatted string, `'<letter> (<count>)'`, or `''` if nobody
  answered wrong.
- **Source:** **`[Code.gs]` only** (`Code.gs:2120-2198`) for `questionAnalysis` and
  `lessonAnalysis` — `[gas_stub]`'s two tests that call `summary`
  (`test_backend.js:228-230`, `test_compat.js:154-162`) only assert fields on `attempts`
  (`intake`, `registered`, `score`/`total` presence); neither asserts a single field of
  `questionAnalysis` or `lessonAnalysis`. **No browser-UI mock defines a `summary` branch
  at all** — the whole "Most problematic questions/lessons" section of the dashboard is,
  as far as the test suite is concerned, driven by field names read directly from
  `app.js`'s own rendering code and cross-checked against `Code.gs`, not verified by any
  test in either category. This is the single largest gap in test coverage found in this
  audit — worth a dedicated integration test before the new backend replaces it.

---

## Actions in `app.js` with no browser-UI mock (`[gas_stub]`/`[Code.gs]` only)

Every one of these is called by the frontend, and every one of them has real, tested
business logic — but none of them is driven through a hand-written JSONP fixture in a
Playwright test, only against the real `Code.gs`:

- `auth_signup`
- `auth_change_password` (instructor)
- `trainee_change_password`
- `admin_reset_instructor_password`
- `session_publish` / `session_unpublish`
- `retake_list`
- `retake_allow`
- `summary` (worst of the group — see above; not even asserted by the `[gas_stub]` tests
  beyond the `attempts` array)

## Action defined in the backend with no frontend caller at all

- `trainee_me` — real, tested (`[gas_stub]`), never called from `app.js`. Decide on
  purpose whether the new backend keeps an equivalent or drops it.

## Field-naming inconsistency worth carrying over deliberately (or fixing on purpose)

- A submitted item uses `studentAnswer`; every read-back of that same item
  (`attempt_detail`, `my_attempt`, `trainee_history`, `my_history`'s items where
  applicable) uses `answer`. This is a real, current asymmetry, not a typo introduced
  here — confirmed independently in `test_history.js:75`, `test_my_history.js:90`,
  `test_report_ui.js:96-102`, and the submission builder at `app.js:1617-1624`.
