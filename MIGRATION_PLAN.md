# EnergyTech Assessment Platform — Migration Action Plan

**From:** static front-end + Google Apps Script + Google Sheets
**To:** static front-end + Node/Express API + PostgreSQL on Railway
**Target scale:** 50 instructors · 100 groups × 25 trainees (2,500) · 15 chapters × 4 versions (60 papers)
**Written:** 2026-09-12

---

## 0. Scope, and what this plan deliberately excludes

**In scope:** replacing the backend. Same features, same behaviour, faster and concurrent-safe. Plus the one architectural fix that only a real backend makes possible: **server-side scoring**, which closes the "answers readable client-side" hole that has been open since the first build.

**Explicitly out of scope, for this migration:**

- The UI redesign. It is a separate project with a separate risk profile. Doing both at once means that when something breaks you cannot tell which change broke it.
- New features. No additions to the exam rules, the reports, the worksheet export or the question banks.
- Rebuilding the question banks. `build_bank.py` and the `tools/` pipelines are untouched.

**One variable at a time.** The success criterion for this migration is: *the app behaves identically, and the existing browser test suites pass against the new backend.*

---

## 1. Decisions to make before writing any code

These six are yours, not mine. Each one changes the work downstream, and each is much cheaper to decide now than halfway through.

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D1** | Server-side scoring — now or later? | (a) Port the backend only, keep `question_bank*.js` on the client. (b) Move questions and keys into Postgres, mark on the server. | **(b), but in Phase 4, after the record-keeping port is proven.** It is the whole reason a real backend is worth having, and it is much harder to retrofit later. But it is also the riskiest part — see D2. |
| **D2** | Where does paper selection and shuffling happen? | (a) Stay on the client (`selectQuestionsFor`, `shuffleChoicesOf`), server only marks. (b) Move to the server. | **(b) — required if D1 is (b).** Carries the single biggest technical risk in this plan: the seeded PRNG must be reimplemented **bit-exactly**, or every historical attempt loses its rebuild. See §7.3. |
| **D3** | Where is the front-end served from? | (a) Stay on GitHub Pages, API on Railway (cross-origin: CORS + `SameSite=None` cookies). (b) Express serves the static build from the same Railway service (same origin). | **(b).** Same origin removes CORS config, cookie friction, and service-worker scope problems in one move. Keep the GitHub Pages build as the rollback target. |
| **D4** | Token transport | (a) Bearer token in `Authorization` header, stored in `localStorage`. (b) `httpOnly; Secure; SameSite=Lax` cookie. | **(a) for the migration, (b) as a follow-up.** (b) is genuinely more secure (XSS cannot read it) but adds CSRF handling and touches every call site. (a) is already a large improvement over today's password-in-a-URL-query-string. Decide deliberately rather than by default. |
| **D5** | Password hashes | (a) Force everyone to reset at cutover (the v50 must-change machinery already exists). (b) Keep the salted SHA-256 hashes, verify-and-upgrade to bcrypt on each successful login. | **(b).** (a) means reading temporary passwords aloud to up to 2,500 people. (b) is ~15 lines of code and invisible to users. |
| **D6** | Cutover date | Any | **A term boundary, or at minimum a week with no scheduled assessments.** Never during an assessment week. Put the date in the calendar before Phase 1 starts, and work backwards. |

Write your answers at the top of this file before starting. If D1 or D2 changes mid-build, a lot of work is wasted.

---

## 2. Target architecture

```
                     ┌──────────────────────────────┐
   Browser  ────────▶│  Railway service (Node 20)   │
   (PWA, service     │  ├─ Express                  │
    worker, LaTeX    │  ├─ static/  (front-end,     │
    renderer)        │  │    figures_*/, images/)   │
                     │  ├─ /api/*                   │
                     │  └─ pg connection pool       │
                     └──────────────┬───────────────┘
                                    │
                     ┌──────────────▼───────────────┐
                     │  Railway PostgreSQL 16       │
                     └──────────────────────────────┘
```

**What stays exactly as it is:**

- The whole LaTeX rendering path (`renderMath`), figures as `figures_ch*/<hash>.svg` + `.pdf`, `images/*.png`
- `worksheet_tex.js` and the Overleaf export flow
- The composite set-key encoding (`ch03:version_b=1-20,25`) — well-tested, keep it verbatim
- The `seed` / `orderSeed` split and its semantics
- The ownership rule (instructor sees own sessions; admin sees all)
- The release-gate semantics, *including* excluding unreleased attempts from the lesson bars
- The service worker and the icon set

**What disappears:**

- `google_apps_script/Code.gs` (~all of it)
- JSONP entirely — `getJsonp`, the `callback` parameter, the untokened-refusal probe trick
- `no-cors` POSTs and the "the reply is opaque so success is a guess" problem, and with it `confirmExamRecorded`'s reason for existing (keep the read-back anyway; it is cheap and now actually authoritative)
- `ensureHeaders_`, `ENSURED_`, `writeRow_`/`appendTextRow_`/`setTextCell_` and the whole text-coercion defence — a typed column cannot coerce `MAY26` into a date
- `setup()`, `eraseAllRecords_`, `CONFIRM_ERASE`
- The 15s→30s timeout, the retry-once-on-read, `reconcileSoon` debouncing, and `testBackendConnection`'s four-probe diagnostic. All of these exist to paper over Apps Script cold starts.

---

## 3. Database schema

Nine tables. Every text identifier is `TEXT` or `CITEXT`, which structurally kills the v31 coercion class of bug.

```sql
-- ---------- people ----------
CREATE TABLE instructors (
  id                 BIGSERIAL PRIMARY KEY,
  username           TEXT NOT NULL UNIQUE,
  display_name       TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  password_algo      TEXT NOT NULL DEFAULT 'bcrypt',   -- 'sha256-salt' for legacy rows
  password_salt      TEXT,                             -- legacy only
  role               TEXT NOT NULL DEFAULT 'instructor'
                       CHECK (role IN ('instructor','admin')),
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','active','revoked')),
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE intakes (
  id          BIGSERIAL PRIMARY KEY,
  label       TEXT NOT NULL UNIQUE,          -- 'MAY26' stays 'MAY26'
  created_by  TEXT REFERENCES instructors(username),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE groups (
  id          BIGSERIAL PRIMARY KEY,
  intake_id   BIGINT NOT NULL REFERENCES intakes(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,                 -- G1..G20
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (intake_id, name)
);

CREATE TABLE trainees (
  id                   BIGSERIAL PRIMARY KEY,
  energytech_id        TEXT NOT NULL UNIQUE, -- '0012345' keeps its zeros
  name                 TEXT NOT NULL,        -- one field, per v34
  intake_id            BIGINT NOT NULL REFERENCES intakes(id) ON DELETE RESTRICT,
  group_id             BIGINT NOT NULL REFERENCES groups(id)  ON DELETE RESTRICT,
  account_status       TEXT NOT NULL DEFAULT 'pending'
                         CHECK (account_status IN ('pending','active','revoked')),
  password_hash        TEXT,
  password_algo        TEXT,
  password_salt        TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_by           TEXT REFERENCES instructors(username),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- one live session per account, as today
CREATE TABLE auth_tokens (
  token        TEXT PRIMARY KEY,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('instructor','trainee')),
  subject_id   BIGINT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX auth_one_live ON auth_tokens (subject_kind, subject_id);

-- ---------- content ----------
CREATE TABLE questions (
  id              BIGSERIAL PRIMARY KEY,
  chapter_key     TEXT NOT NULL,             -- ch12, ch03, ch04, ch12a
  set_id          TEXT NOT NULL,             -- original_pdf, version_b..d
  original_number INT  NOT NULL,
  lesson          TEXT NOT NULL,             -- '4-1.1'
  body            TEXT NOT NULL,             -- LaTeX, verbatim from the bank
  choices         JSONB NOT NULL,            -- ["(a) …","(b) …","(c) …","(d) …"]
  answer          CHAR(1) NOT NULL CHECK (answer IN ('a','b','c','d')),
  video_ok        BOOLEAN NOT NULL DEFAULT TRUE,
  video_url       TEXT,
  figure_ref      TEXT,                      -- '<hash>.svg' or 'images/….png'
  bank_version    TEXT NOT NULL,             -- build id, so a rebuild is traceable
  UNIQUE (chapter_key, set_id, original_number)
);

-- ---------- sittings ----------
CREATE TABLE sessions (
  id                    BIGSERIAL PRIMARY KEY,
  code                  TEXT NOT NULL,
  name                  TEXT NOT NULL,
  mode                  TEXT NOT NULL CHECK (mode IN ('practice','assessment')),
  question_set_key      TEXT NOT NULL,       -- the composite encoding, unchanged
  question_count        INT  NOT NULL,
  seed                  BIGINT NOT NULL,
  order_mode            TEXT NOT NULL,
  shuffle_each_launch   BOOLEAN NOT NULL DEFAULT FALSE,
  show_original_numbers BOOLEAN NOT NULL DEFAULT TRUE,
  allow_walk_in         BOOLEAN NOT NULL DEFAULT FALSE,
  results_published     BOOLEAN NOT NULL DEFAULT FALSE,
  intake_id             BIGINT REFERENCES intakes(id),
  group_id              BIGINT REFERENCES groups(id),
  owner_username        TEXT NOT NULL REFERENCES instructors(username),
  superseded_at         TIMESTAMPTZ,         -- re-saving a code closes the old row
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- "a re-saved session is a new session" (v41) — only one live row per code
CREATE UNIQUE INDEX sessions_live_code
  ON sessions (code) WHERE superseded_at IS NULL;

CREATE TABLE retake_grants (
  id            BIGSERIAL PRIMARY KEY,
  session_id    BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  trainee_id    BIGINT NOT NULL REFERENCES trainees(id) ON DELETE RESTRICT,
  granted_by    TEXT NOT NULL REFERENCES instructors(username),
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE attempts (
  id               BIGSERIAL PRIMARY KEY,
  session_id       BIGINT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  trainee_id       BIGINT REFERENCES trainees(id),   -- NULL for a walk-in
  walkin_id_text   TEXT,                             -- what a guest typed
  walkin_name      TEXT,
  sitting_number   INT NOT NULL DEFAULT 1,
  group_id         BIGINT REFERENCES groups(id),     -- who was in the room
  intake_id        BIGINT REFERENCES intakes(id),
  order_seed       BIGINT,                           -- NULL = legacy single-stream
  score            INT NOT NULL,
  total            INT NOT NULL,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (trainee_id IS NOT NULL OR walkin_id_text IS NOT NULL)
);
-- makes "one sitting per exam" atomic instead of check-then-write
CREATE UNIQUE INDEX attempts_one_sitting
  ON attempts (session_id, trainee_id, sitting_number)
  WHERE trainee_id IS NOT NULL;
CREATE INDEX attempts_by_trainee ON attempts (trainee_id, submitted_at DESC);
CREATE INDEX attempts_by_session ON attempts (session_id);

CREATE TABLE item_responses (
  attempt_id      BIGINT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_index  INT NOT NULL,             -- position on the paper as sat
  question_id     BIGINT REFERENCES questions(id),
  lesson          TEXT NOT NULL,
  chosen          CHAR(1),                  -- NULL = unanswered
  correct_letter  CHAR(1) NOT NULL,         -- as the trainee saw it, post-shuffle
  is_correct      BOOLEAN NOT NULL,
  PRIMARY KEY (attempt_id, question_index)
);
```

### Three things this schema does that Sheets cannot

1. **`intakes.label` is `TEXT UNIQUE`.** The v31 bug (`MAY26` → `Tue May 26 2026…`, which then orphaned every group) is not fixed here — it is *impossible* here.
2. **`attempts_one_sitting` is a unique index.** Today's rule is a check-then-append, which has a real race: two tabs submitting together can both pass the check. The index makes the second one fail at the database, whatever posts it.
3. **`ON DELETE RESTRICT` everywhere.** "Deleting is blocked with an explanation rather than cascading" (v29) becomes a constraint rather than a hand-written guard that a future edit could forget.

### Enforcing the retake entitlement correctly

Entitlement is `1 + grants`, and "a grant is spent by being used" (v42). In one transaction:

```
BEGIN;
SELECT id FROM trainees WHERE id = $trainee FOR UPDATE;            -- serialise per trainee
SELECT count(*) FROM attempts WHERE session_id=$s AND trainee_id=$t;   -- used
SELECT count(*) FROM retake_grants WHERE session_id=$s AND trainee_id=$t; -- granted
-- refuse if used >= 1 + granted
INSERT INTO attempts (…, sitting_number) VALUES (…, used + 1);
INSERT INTO item_responses …;
COMMIT;
```

The `FOR UPDATE` on the trainee row is what makes the count trustworthy under concurrency; the unique index is the backstop if that lock is ever dropped by a future edit. **Both, not either** — that is the same "four independent things stop the re-sit" reasoning as v45.

---

## 4. The API contract — and where to get it for free

**Highest-leverage task in the whole plan, and the first one to do.**

The existing browser suites (`test_roster.js`, `test_exam_ui.js`, `test_retake_ui.js`, `test_trainee_view.js`, `test_report_ui.js`, `test_exam_confirm.js`, `test_profile.js`) all run against a **mocked backend**. Those mocks are a complete, executable specification of every JSON shape the front-end expects — written from the client's point of view, which is exactly the point of view the new API must satisfy.

**Task:** read every mock handler out of the browser suites and write them up as `API_CONTRACT.md` — one entry per action, with request params and response shape. Expect roughly 40 actions (24 were counted at v30, plus the history, report, release, retake, password-reset and my-\* actions added since).

Then **build the new API to satisfy that contract exactly**, JSON field names included. Two consequences:

- The front-end diff shrinks to transport only: `getJsonp(action, params)` → `api(action, params)` over `fetch` + JSON. The response handling does not change.
- The browser suites become your migration acceptance tests, unchanged. When `test_roster.js`'s 57 checks pass with the mock replaced by the real Railway API, the roster is ported. That is a far stronger signal than anything written from scratch.

Keep the flat `action`-style routing at first (`POST /api/call` with `{action, ...params}`) if it makes the diff smaller. REST-ifying the URLs is a cosmetic follow-up, not part of this migration.

**One deliberate exception:** login stops being a GET with the password in the query string. It becomes `POST /api/auth/login` with a JSON body. That one call site changes shape.

---

## 5. Phases

Hours are hands-on-keyboard with AI assistance, assuming you review rather than write from scratch. Calendar time depends on your hours per day — see §12.

### Phase 0 — Decisions and contract · 4–6 h

- [ ] Answer D1–D6 and write them at the top of this file
- [ ] Extract `API_CONTRACT.md` from the browser suites' mocks (§4)
- [ ] Take a full copy of the live spreadsheet (File → Make a copy) and a `File → Download → .xlsx` snapshot. Date both.
- [ ] Read the live header rows off every sheet and record them verbatim. **Do not trust the column indices in the `claude/` notes** — v34 and v50 both renumbered, and their stated indices disagree with each other (v34 puts `Created By` at 11; v50 puts `Must Change Password` at 11). The live header row is the only authority.
- [ ] Pick the cutover date (D6) and work backwards

**Exit:** decisions recorded, contract written, a dated spreadsheet copy exists, real column layouts captured.

### Phase 1 — Railway skeleton, schema, migrations · 6–8 h

- [ ] Railway account, project, PostgreSQL service, Node service
- [ ] Repo: Express + `pg` pool + `dotenv`, `/api/health` returning `SELECT now()`
- [ ] `git push` → auto-deploy working, health endpoint green from your browser
- [ ] Migration tool (`node-pg-migrate` or Knex) — **not** hand-run SQL. The v46 lesson is that a schema change you run by hand is a schema change you can run twice.
- [ ] Migration `001` creates the schema in §3
- [ ] `npm run migrate` runs on deploy; re-running is a no-op
- [ ] Confirm `DATABASE_URL` comes from the environment and nothing is hardcoded

**Exit:** `/api/health` is green on the live URL, and the schema applies cleanly to an empty database twice in a row.

### Phase 2 — Question bank into Postgres · 4–6 h

- [ ] `tools/seed_questions.js` reads `question_bank.js`, `_ch03.js`, `_ch04.js`, `_ch12a.js` and inserts into `questions`, tagging `bank_version` with the build id
- [ ] Seed is idempotent (`ON CONFLICT … DO UPDATE`) so a bank rebuild re-seeds rather than duplicating
- [ ] **Verify counts against the notes:** 4 chapters, 16 papers, 1,360 questions. 456 for Chapters 01 & 02, 94×4 for ch03, 50×4 for ch04, 82×4 for ch12a.
- [ ] Verify every stored `answer` matches the bank field-by-field (a diff, not a spot check — this is the same check that caught the ch04 rebuild regression)
- [ ] Figures and images stay as static files; nothing about them changes

**Exit:** 1,360 rows, and a field-by-field diff against the source banks reporting zero differences.

### Phase 3 — The API, in six groups · 20–28 h

Build in this order; each group inherits the previous group's pattern, so they accelerate.

| Group | Endpoints | Hours | Notes |
|---|---|---|---|
| **3a Auth** | login, logout, signup, change password, admin list/approve/revoke/promote, reset password | 4–5 | bcrypt + verify-and-upgrade (D5). Rate limiting here, not later. Drop the bootstrap `adnen`/`12341234` account — see §8. |
| **3b Roster** | intake/group/trainee CRUD, search, CSV import, bulk move, bulk revoke | 6–8 | Most endpoints, but all one pattern. The `previous*` parameter trap (v29) vanishes: a rename is an `UPDATE … WHERE id = $1`, so there is no way to accidentally create a second row. |
| **3c Sessions** | create, list mine, release/hide results, who-sat-it, grant retake | 3–4 | `superseded_at` implements "a re-saved session is a new session". |
| **3d Sitting** | fetch session by code, fetch paper, submit, confirm recorded | 5–7 | The hard one. Entitlement transaction (§3), server-side marking, `orderSeed`. Do this *after* 3a–3c are green. |
| **3e History** | trainee history, attempt detail, my history, my attempt | 3–4 | Share one body per pair with an access predicate, exactly as `historyFor_(id, mine)` does now (v40). Do not write them twice. |
| **3f Reports** | session report | 2–3 | Mostly SQL: grouping, averages, absentees, `REPORT_PASS_MARK = 70`. Aggregate in Postgres, not in JavaScript. |

- [ ] Every endpoint has an integration test (Jest + Supertest) hitting a **real** Postgres in Docker — no stub. The whole `gas_stub.js` fidelity saga (v31, v33, v34) was the cost of testing against a fake; that cost is now zero.
- [ ] Ownership and release-gate rules covered both ways per endpoint (permitted *and* refused)

**Exit:** every action in `API_CONTRACT.md` implemented, with integration tests green against a real database.

### Phase 4 — Server-side scoring · 8–12 h

Only if D1 is (b). This is where the client stops holding the answers.

- [ ] Port `selectQuestionsFor` to the server, including the composite key codec (`decodeSelection`, `parseRanges`)
- [ ] Port the seeded PRNG **bit-exactly**. See §7.3 — this is the highest-risk item in the plan.
- [ ] Port `shuffleChoicesOf`, including remapping `answer` with its option text
- [ ] `GET /api/quiz/:code` returns questions **with no `answer` field**, in the arrangement this trainee gets
- [ ] Marking moves to the submit handler; the client sends letters, the server decides correctness
- [ ] Review responses include `correct_letter` **only** where the current rules already allow it: practice after submit, exam after release. The lesson-bar exclusion for unreleased exams still applies.
- [ ] Instructor-only `GET /api/worksheet/:code` returns full questions *with* answers, gated on session ownership — the worksheet export needs the key to embed it, and the instructor is allowed it
- [ ] `question_bank*.js` is removed from the front-end bundle and from the service-worker precache list; the precache list and `test_appshell.js`'s file count are regenerated

**Exit:** a trainee with developer tools open, mid-exam, cannot find an answer key anywhere in what the browser received. Test this by actually looking, then assert it in a test.

### Phase 5 — Front-end rewiring · 8–12 h

- [ ] `getJsonp` → `api()`: one `fetch` + JSON helper, bearer token in the `Authorization` header (D4)
- [ ] Login posts a JSON body; the password never appears in a URL again
- [ ] Delete: `activeWebAppUrl()` and the whole saved-URL / on-screen-box split (v30's bug class disappears with it), the four-probe `testBackendConnection`, the 30s timeout, the read-retry, `reconcileSoon`
- [ ] **Keep** the v33 optimistic-apply pattern. It was built to hide Apps Script latency, but it is good UI regardless — the panel should still not wait on a network round trip.
- [ ] **Keep** `confirmExamRecorded`. The reply is no longer opaque, so it now proves something instead of guessing, and it costs one request.
- [ ] Express serves the static build (D3); regenerate the service-worker precache list and bump `CACHE_NAME`
- [ ] Re-run `test_appshell.js` — the precache list changed, so its file count and `node --check` both need to pass again

**Exit:** the app works end to end against Railway with Apps Script unreachable.

### Phase 6 — Test suite migration · 10–14 h

The suite is the most valuable thing this project has. Triage it explicitly.

| Suite | Fate |
|---|---|
| `test_backend.js` (85), `test_compat.js` (43), `test_coercion.js` (23), `test_jsonp.js` (8), `test_urlsplit.js` (3), `test_name_migration.js` (33) | **Retire.** They test `Code.gs`, Sheets coercion, JSONP and the URL split — none of which exist any more. Do not delete until the replacements are green; they are the record of what the old behaviour *was*. |
| Backend halves of `test_roster`, `test_report`, `test_history`, `test_my_history`, `test_retake`, `test_exam_release`, `test_password_reset`, `test_import_move` | **Rewrite as Supertest integration tests.** Same assertions, new transport. This is where most of the Phase 6 hours go. |
| Browser suites: `test_roster` (57), `test_papers` (117), `test_worksheet` (114), `test_worksheet_ui` (64), `test_exam_view` (51), `test_profile` (38), `test_retake_ui` (19), `test_exam_ui` (24), `test_trainee_view` (22), `test_shuffle` (21), `test_instant` (18), `test_exam_confirm` (12), `test_ch04` (51), `test_ch12a` (45), `test_appshell` (30), `test_diag` (10) | **Keep, repoint the mock at the real API.** These are the acceptance tests (§4). `test_diag` shrinks or goes with the diagnostic. |
| `mutate_backend.js` (113 mutations) | **Repoint.** The `Code.gs` mutants are replaced by mutants in the new API source; the `app.js`, `worksheet_tex.js` and `service-worker.js` mutants carry over. Keep the pre-flight that refuses to start when a `from` string is missing — it has already earned its keep twice. |
| `verify_ch03.py`, `verify_ch12.py`, `tools/ch12a/*`, `tools/ch04/*` | **Untouched.** They verify the banks, not the backend. |
| `test_subpath.js` (12) | **Revisit.** If the front-end moves to same-origin Railway (D3), the GitHub Pages subpath scenario may no longer apply — but keep it if Pages stays as the rollback target, because then it still has to work. |

- [ ] New suite: `test_answer_leak.js` — asserts no answer key reaches the client during an exam, from the network payloads, not from the DOM
- [ ] New suite: `test_concurrency.js` — two simultaneous submissions for one trainee/session; exactly one row lands
- [ ] Restore the symlink discipline from v44: the served front-end must be the source tree, not a copy, or mutations test nothing

**Exit:** every retained suite green against Railway; mutation suite green; the two new suites bite when mutated.

### Phase 7 — Operations · 5–7 h

This is the phase that is easiest to skip and worst to have skipped.

- [ ] **Backups.** Railway's own backups *plus* a nightly `pg_dump` to somewhere Railway does not control (Cloudflare R2 or Backblaze B2, both free at this size). 30-day retention.
- [ ] **A restore drill.** Restore last night's dump into a scratch database and open a report off it. Given that v46 was a data-loss incident recovered only because a spreadsheet copy existed, an untested backup does not count as a backup. Diarise the drill quarterly.
- [ ] **Error tracking.** Sentry free tier. Unhandled rejections and 500s go there, not only to the logs.
- [ ] **Uptime.** External ping on `/api/health` every 5 minutes (healthchecks.io / Better Stack free). Alert to your phone.
- [ ] **Logs.** Hobby keeps 7 days. Ship to a log service if you want longer, or accept 7 days.
- [ ] **Rate limits.** `express-rate-limit` on login and signup: per-IP and per-username, with backoff. This closes the "no rate limiting on login attempts" tradeoff acknowledged back at v16.
- [ ] **Secrets.** `DATABASE_URL`, token signing secret, Sentry DSN — all Railway environment variables. Nothing in Git. `.env` in `.gitignore`.
- [ ] **Spend cap.** Set a usage limit in Railway so a runaway loop cannot produce a surprise invoice.
- [ ] **`/api/health` reports the migration version** so you can tell at a glance which schema is live.

**Exit:** a restore has actually been performed, alerts reach your phone, and a spend cap is set.

### Phase 8 — Load test and capacity · 6–8 h

Stop guessing at the peak; measure it.

- [ ] Write a k6 (or `autocannon`) scenario: N trainees log in, fetch a 94-question paper, answer, submit
- [ ] Run at N = 25 (one group), 100 (four groups), 250, 500
- [ ] Record p50/p95/p99 latency and error rate at each step
- [ ] Watch Railway's usage dashboard during each run and record actual vCPU / GB-hours
- [ ] Convert to a monthly cost at Railway's published rates ($20/vCPU/mo, $10/GB/mo, $0.05/GB egress, $0.15/GB-mo storage)
- [ ] Decide the free-tier → Hobby switch point from that number rather than from an estimate

**What to size for.** Your true peak is not 2,500 — it is the number of trainees sitting *simultaneously*, which is bounded by timetabling:

```
peak concurrent ≈ (groups sitting at the same hour) × 25
```

Ten groups at once is 250; twenty is 500. My earlier 750 figure assumed 30% of the whole population at once, which almost certainly overstates a timetabled institution. **Get the real number from whoever builds the timetable, then load-test to 2× it.**

**Exit:** a table of measured p95 and measured cost at each N, and a sizing decision based on it.

### Phase 9 — Pilot, cutover, watch · 8–12 h

**9a — Data migration (rehearse twice, run once).** Full runbook in §6.

**9b — Pilot, 1–2 weeks.**

- [ ] 3–5 colleagues (include your supervisor) and 2 groups, ~50 trainees
- [ ] At least one real assessment, end to end: create → sit → submit → release → report → print
- [ ] Apps Script stays deployed and the Sheet stays live, untouched, as the rollback target
- [ ] Keep a defect log. Fix, redeploy, re-run the suite.

**9c — Cutover.**

- [ ] On the date from D6, never during an assessment week
- [ ] Re-run the data migration against the current Sheet (the pilot fortnight added rows)
- [ ] Verify row counts and spot-check five trainee profiles and two reports against the Sheet
- [ ] Switch the front-end; tag the previous build in Git as the rollback artefact
- [ ] Set the Apps Script deployment to a read-only mode or unpublish it, so nothing can write to the Sheet after the cut

**9d — Watch, one week.**

- [ ] Check Sentry and the Railway usage dashboard daily
- [ ] Compare the Railway invoice against the Phase 8 projection
- [ ] Only after a clean week: delete the retired test suites (Phase 6) and archive `Code.gs`

**Exit:** one full week of live use with no rollback, and costs within the projection.

---

## 6. Data migration runbook

Run it three times: twice as a rehearsal into a scratch database, once for real.

1. **Freeze.** No session creation or roster edits during the run. It takes minutes, not hours.
2. **Export.** Each sheet → `File → Download → .csv`. **Before exporting, format the ID and label columns as Plain text** (`Format → Number → Plain text`). The v31 coercion bug bites the *export* as readily as the write — `0012345` will come out as `12345` and `MAY26` as a date, and reformatting after the fact does not give the original text back.
3. **Inspect.** Open each CSV in a text editor, not a spreadsheet. Confirm leading zeros survived and no intake label became a date. If either failed, fix the formatting and export again — do not patch the CSV by hand.
4. **Import in dependency order.** `instructors` → `intakes` → `groups` → `trainees` → `sessions` → `retake_grants` → `attempts` → `item_responses`. Parse dates explicitly as `Asia/Riyadh`; never let the driver guess.
5. **Reconcile.** For each table, row count in Postgres must equal row count in the CSV. Mismatches get investigated, not rounded.
6. **Check the known-bad row.** The v31 incident left one intake row whose label is a localised date string. Decide whether it migrates as-is or gets dropped — it has no groups attached, so dropping it is clean.
7. **Spot-check by hand.** Five trainees across different intakes: profile stats, weakest lessons, and one attempt's review must match the old app's output exactly. Two session reports: sat / average / passed / failed / absentees must match.
8. **Legacy attempts.** Rows with no `order_seed` keep `NULL` and must rebuild through the legacy single-stream path (v41 §6). Include at least one in the spot check — this is the one that would fail silently.
9. **Sequences.** `SELECT setval(...)` on every `BIGSERIAL` after a bulk insert, or the first new row collides.

---

## 7. The three risks worth naming

### 7.1 Losing history in the migration
**Mitigated by:** a dated spreadsheet copy before anything starts, two rehearsals, row-count reconciliation, hand spot-checks, and Sheets staying live and untouched until a clean week has passed.

### 7.2 Cutting over into an assessment
**Mitigated by:** D6, and by keeping the previous front-end build tagged so rollback is a redeploy rather than a repair.

### 7.3 The PRNG — the one that would fail quietly
The review page does not store questions; it **rebuilds the paper** from `seed` / `questionSetKey` / `questionCount` / `orderMode` / `orderSeed` (v35, v41). If the server's random number generator does not produce the *identical* sequence to the current client's, every historical attempt renders the wrong question beside the recorded answer — and nothing throws. A trainee sees "you answered (c)" against a question they never saw.

**Mitigations, all of them:**

- Port the generator character by character. Do not substitute a library, do not "improve" it, do not change integer handling. If it is a `mulberry32`/`xorshift` variant, watch for `>>> 0`, `Math.imul` and 32-bit overflow semantics — a subtly different implementation is the failure mode.
- Golden-file test: for a fixed seed, dump the first 1,000 outputs from the current client implementation and assert the server reproduces them exactly.
- Replay test: take 50 real historical attempts spanning both the pre-`orderSeed` and post-`orderSeed` eras, rebuild each through the server, and require the question list to match the client's rebuild question for question.
- Keep v35's guard: if `questions.length !== items.length`, say so and fall back to the recorded letters. Never show a rebuilt question you cannot prove lines up.
- Mutation: perturb one constant in the server PRNG and require the replay test to fail.

If Phase 4 slips, **this is the reason it slipped**, and that is the right thing to spend time on.

---

## 8. Security items to close while you are in here

| Item | Today | After |
|---|---|---|
| Password in a URL query string | JSONP, appears in Apps Script execution logs | `POST` with a JSON body |
| Password hashing | salted SHA-256 | bcrypt (cost ≥ 10), verify-and-upgrade on login (D5) |
| Login rate limiting | none | per-IP and per-username with backoff |
| Answer keys | shipped to every device in `question_bank*.js`, on a public repo | server-side only (Phase 4) |
| Bootstrap admin | `adnen` / `12341234`, auto-created on first backend run | **Do not port it.** Seed one admin from an environment variable with a password you set, or create the first admin through a one-shot CLI command. An auto-created known credential on a public URL is a different risk from the same credential on a classroom tool. |
| Token storage | `localStorage`, one live token per account | same, or `httpOnly` cookie (D4). Keep the one-live-token rule — it is a deliberate feature. |
| Answer-key documents | already excluded from the public repo (v29) | keep excluding; add a test that asserts they are absent from the build |

---

## 9. Timeline

| Phase | Hours |
|---|---|
| 0 · Decisions and contract | 4–6 |
| 1 · Railway, schema, migrations | 6–8 |
| 2 · Question bank seeded | 4–6 |
| 3 · The API (six groups) | 20–28 |
| 4 · Server-side scoring | 8–12 |
| 5 · Front-end rewiring | 8–12 |
| 6 · Test suite migration | 10–14 |
| 7 · Operations | 5–7 |
| 8 · Load test and capacity | 6–8 |
| 9 · Pilot, cutover, watch | 8–12 |
| **Total** | **79–113 h** |

| Your pace | Calendar |
|---|---|
| 8 h/day | 2–2.5 weeks |
| 4 h/day | 4–5.5 weeks |
| 2 h/day | 8–11 weeks |

Plus a **1–2 week pilot** inside Phase 9 that is calendar time, not your hours — it needs real classes to happen.

Note how this relates to the earlier "1–2 weeks" figure: that was Phase 3 alone, and it holds — six endpoint groups in 20–28 hours. The rest of the total is data migration, test-suite migration, operations and the pilot. Those are not optional, and on this project they are where the value is: the suite is the reason a port of this size is even safe to attempt, and the backup drill is the reason the next v46 is survivable.

**Drop Phase 4 (server-side scoring) and the total falls to 65–90 h** — but the answer keys stay on the client, which is the open item that has been offered and deferred since v29.

---

## 10. What "done" means

Before inviting 50 colleagues, all of these are true:

- [ ] Every retained test suite green against Railway, and the mutation suite green
- [ ] `test_answer_leak.js` and `test_concurrency.js` both exist and both bite when mutated
- [ ] Data migration reconciled: row counts match, five trainee profiles and two reports verified by hand, at least one pre-`orderSeed` attempt rebuilt correctly
- [ ] PRNG golden-file and 50-attempt replay tests green
- [ ] Load-tested to 2× the timetable's real peak, p95 under 500 ms, zero errors
- [ ] A `pg_dump` has been restored into a scratch database and a report opened off it
- [ ] Sentry receiving errors; uptime alerts reaching your phone; spend cap set
- [ ] Bootstrap admin credential gone; rate limiting live
- [ ] One full assessment run end to end by a colleague who is not you: create → sit → submit → release → report → print
- [ ] Apps Script deployment and the Sheet still intact as rollback, and the previous front-end build tagged in Git
- [ ] A clean pilot fortnight with the defect log empty at the end
- [ ] The first Railway invoice within range of the Phase 8 projection

---

## 11. What not to do

- **Do not redesign the UI in the same stretch.** Two simultaneous changes means no clean bisect when something breaks.
- **Do not rebuild the question banks.** Chapter 04's `.tex` sources in `tools/ch04/worksheets/` carry fixes the original uploads do not; a rebuild from the wrong source reintroduces both typos.
- **Do not delete the retired suites early.** They are the written record of the old behaviour, and you will want to consult them during the port.
- **Do not skip the restore drill.** v46 is the reason.
- **Do not test against a stub.** The whole `gas_stub.js` fidelity arc (v31, v33, v34) existed because Apps Script could not be run in Node. Postgres in Docker can. A stub that is more forgiving than production is the recurring bug-hiding pattern in this project's notes — it appears in v30, v41, v42 and v44.
