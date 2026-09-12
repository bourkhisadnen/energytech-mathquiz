# Migration, step by step

A companion to `MIGRATION_PLAN.md`. The plan says *what* and *why*; this says *what to do on Monday morning*.

Written for someone who understands the app inside out but does not want to hand-write server code. You will describe what you want, Claude writes it, you check it works. The checks are the part that matters, so each step below ends with one.

---

## Before you start

**Have these to hand:**

- Your Railway account (you have this)
- A GitHub account, and the app's repository
- The live Google spreadsheet
- The `claude/` notes folder — Claude should read these; they are the real specification of how the app behaves
- `MIGRATION_PLAN.md`

**Do this first, today, before anything else.**

Open the spreadsheet, `File → Make a copy`, name it `EnergyTech Quiz — snapshot before migration 2026-09-12`. Then `File → Download → Microsoft Excel (.xlsx)` and save that somewhere off Google Drive.

This takes two minutes and it is the single most valuable thing in this tutorial. Everything else can be redone; the records cannot.

---

## How to work with Claude on this

Four habits that make the difference between this taking two weeks and taking two months.

**One thing at a time.** "Write the login endpoint" gets a good answer. "Write the backend" gets a mess you cannot check. Every step below is sized to be one request.

**Give it the context.** Claude does not know your app. At the start of each session, tell it what it is working on and point it at the relevant notes:

> I'm migrating a classroom quiz app from Google Apps Script + Google Sheets to Node.js + PostgreSQL on Railway. The plan is in MIGRATION_PLAN.md. The app's history and behaviour is documented in the claude/ folder — read the notes relevant to what we're working on before you write anything.

**Ask for the test alongside the code.** Always. Not afterwards. "Write the login endpoint and a test that proves a wrong password is refused." The test is how you check work you did not write yourself.

**Make it explain.** After each piece: "explain what this does in plain language, and tell me what could go wrong with it." If the explanation does not make sense to you, the code is probably wrong — or at least wrong for you, because you are the one who will maintain it.

A note on tools: doing this in a chat window means copying files back and forth constantly. Claude Code works directly in your repository — it reads your files, writes changes, runs your tests. For a job this size that is a large difference. There's a card at the end of this reply.

---

## Step 1 — Set up the workspace

**What you're doing:** making a new folder for the server code, separate from the app.

Ask Claude:

> Create a new Node.js project called `energytech-api`. Express, PostgreSQL via the `pg` library, environment variables via `dotenv`. Add one endpoint, `/api/health`, that asks the database for the current time and returns it. Include a `.gitignore` that excludes `.env` and `node_modules`. Explain the folder layout to me.

Then push it to a new GitHub repository.

**Check:** the folder exists, `npm install` runs without errors, and GitHub shows your files. No `.env` file on GitHub — check this specifically, it is where your passwords will live.

**Time:** an hour.

---

## Step 2 — Make the two Railway services

**What you're doing:** one service runs your code, one runs the database. Railway connects them for you.

In Railway:

1. New Project
2. Add a service → **Deploy from GitHub repo** → pick `energytech-api`
3. In the same project, Add a service → **Database → PostgreSQL**

Railway notices the database and gives your code a `DATABASE_URL` automatically. You do not need to copy it anywhere.

**Check:** two boxes in your Railway project. The code service shows a deploy log ending in something like "server running". Railway gives you a public URL — open it with `/api/health` on the end. You should see today's date and time in your browser.

If you see the date, your code is talking to your database. That is the whole foundation, and everything after this is filling it in.

**Time:** half an hour, most of it waiting for the first deploy.

---

## Step 3 — Write down what the app expects

**What you're doing:** the most valuable hour of the whole migration, and it involves no new code.

Your browser tests already pretend to be the backend. `test_roster.js`, `test_exam_ui.js`, `test_profile.js` and the rest each contain a fake backend that answers the app's questions. Those fakes are a complete, exact description of what the new server has to say — written from the app's own point of view.

Ask Claude:

> Read every browser test suite in this project and find the mocked backend handlers. For each action the app calls, write down the parameters it sends and the exact shape of the reply it expects. Put it all in API_CONTRACT.md, one section per action. Do not invent anything — only record what the mocks actually do.

Expect around forty actions.

**Why this matters so much:** if the new server answers exactly the way those fakes do, then you swap the fake for the real server and **all your existing tests still work**. They become the proof that the migration is faithful. Without this, you are checking the port by hand, forty times, and hoping.

**Check:** `API_CONTRACT.md` exists and every action in it is one you recognise from the app.

**Time:** a morning.

---

## Step 4 — Build the database shape

**What you're doing:** creating the tables. This replaces the eight sheets.

First, an important preliminary. Open the spreadsheet and write down the header row of every sheet, exactly as it appears. Do not trust the column numbers in the `claude/` notes — two of them disagree with each other, because columns were added and renumbered at different times. The live spreadsheet is the only authority.

Then ask Claude:

> Section 3 of MIGRATION_PLAN.md has the PostgreSQL schema. Set up database migrations using node-pg-migrate, and write the first migration to create that schema. Here are the actual header rows from the live spreadsheet: [paste them]. Tell me about any place where the schema and the real sheets disagree, before you write anything.

That last sentence is the important one. Let it find the mismatches now rather than during the data import.

**What "migrations" means, briefly:** a numbered list of changes to the database, applied in order, each one recorded as done. It means you never change the database by hand, and you can never apply the same change twice. The reason this matters here is v46: a change you run by hand is a change you can accidentally run again on live data.

**Check:** ask Claude to apply the migration twice in a row to an empty database. The second run should say there is nothing to do. If it errors or duplicates something, stop and fix it — this is exactly the property you are buying.

**Time:** half a day, including the header-row comparison.

---

## Step 5 — Move the questions in

**What you're doing:** copying all 1,360 questions out of the JavaScript files and into the database.

Ask Claude:

> Write a script that reads question_bank.js, question_bank_ch03.js, question_bank_ch04.js and question_bank_ch12a.js and loads every question into the `questions` table. Running it twice must update rather than duplicate. Then write a second script that compares every field in the database against the source files and reports any difference.

**Check:** the count is 1,360 — 456 for Chapters 01 & 02, 376 for Chapter 03, 200 for Chapter 04, 328 for Chapter 12A. The comparison script reports zero differences.

Insist on the comparison script rather than a spot check. Chapter 12A taught this lesson: a rebuild quietly reverted its own figure scaling and the tests did not notice, because they checked behaviour rather than exact content. Found only by diffing against the previous delivery.

The pictures do not move. The figure and photo files stay exactly where they are.

**Time:** half a day.

---

## Step 6 — Build the server, in six batches

This is the bulk of the work, and it goes faster than you expect because every batch reuses the last one's pattern. Do them in this order.

For each batch, the shape of the request is the same:

> Using API_CONTRACT.md, implement the [batch name] actions against the PostgreSQL schema. Match the reply shapes in the contract exactly — field names included. Write integration tests that run against a real PostgreSQL database, covering both the allowed cases and the refused ones. Then explain the access rules you implemented.

### 6a — Logging in

Instructors and trainees logging in, signing up, changing passwords, admins approving and revoking accounts, password resets.

Two things to specify:

> Existing passwords are stored as salted SHA-256. When someone logs in successfully with an old-style password, check it the old way and then quietly re-save it with modern hashing, so nobody has to be told anything. Also add rate limiting to login and signup — a handful of attempts per minute per account and per address.

And one thing to leave behind:

> Do not create the automatic `adnen` / `12341234` admin account. Instead, add a one-off command I run myself to create the first admin with a password I choose.

**Check:** you can log in through the new server. A wrong password is refused. Ten wrong passwords in a row get you blocked for a while. An old-style password still works and is silently upgraded.

### 6b — The roster

Intakes, groups, trainees, search, CSV import, bulk move, bulk revoke.

Largest batch by count, but it is one pattern repeated. One thing gets simpler on its own: the `previousLabel` / `previousName` / `previousId` trap that caused renames to create duplicate rows disappears entirely, because a rename is now "change this specific row" rather than "find the row that used to be called this".

**Check:** add an intake called `MAY26`. It stays `MAY26`. Add a trainee with ID `0012345`. The zeros survive. Both of these were real bugs; neither is possible now.

### 6c — Sessions

Creating a session, listing your own, releasing and hiding results, seeing who sat an exam, granting a retake.

**Check:** create a session, see it in your list, release it, hide it again. Save over an existing code and confirm the old one is closed rather than overwritten — a re-saved session is a different session, and its release does not carry across.

### 6d — Sitting a quiz

The careful one. Loading a session by code, drawing the paper, submitting, confirming it recorded.

Tell Claude explicitly:

> An exam is one sitting per trainee, unless the instructor has granted extra ones. The allowance is one plus the number of grants, and a grant is used up by being used. Enforce this inside a single database transaction so two submissions arriving at the same moment cannot both get through. Add a test that fires two submissions simultaneously and requires exactly one to succeed.

That last test is worth the time. The old version checked first and wrote second, which leaves a gap between the two. A database can close that gap properly.

**Check:** sit an exam, submit. Try to sit it again — refused. Have an instructor grant another sitting, sit it again — allowed. Try a third time — refused. Practice quizzes stay unlimited.

### 6e — Results and history

A trainee's history, one attempt in detail, and the trainee's own view of both.

> An instructor sees attempts from sessions they ran; an admin sees everything; a trainee sees all of their own regardless of who ran the session. Write each pair as one function with the access rule passed in, not as two similar functions — the trainee copy is the one nobody would notice going stale.

**Check:** log in as an instructor and confirm you cannot see a colleague's session results. Log in as a trainee and confirm you can see your own results from any instructor's session.

### 6f — Reports

The session report: who sat, averages, pass and fail counts, absentees, group breakdown.

> Do the grouping and averaging in the database query rather than in JavaScript. Pass mark is 70. Full marks is counted from score equalling total, never from a rounded percentage — 299 out of 300 shows as 100% and is not full marks.

**Check:** run a report and compare every number against the same report in the old app. They must match exactly.

**Time for all six:** three to five days at a decent pace. 6b and 6d take the longest.

---

## Step 7 — Move the marking to the server

**What you're doing:** the one real improvement, not just a move. Today every answer key is in a file sent to every device, on a public repository. After this, the answers never leave the server.

There is a complication, and it is the riskiest thing in this whole migration, so it is worth understanding before you start.

**Your app does not save the questions a trainee answered.** It saves only their answers, plus a few numbers: a seed, a question-set key, a count, an order mode. When you open a past attempt, the app *re-creates* the exact paper from those numbers. That is a clever design and it works.

But it means the server must now do that re-creation, and it must do the arithmetic **identically** to the app. If the new code produces even a slightly different sequence of random numbers, every past attempt will show the wrong question next to the recorded answer — and nothing will look broken. A trainee sees "you answered (c)" beside a question they never saw.

So be explicit:

> Move the question selection and shuffling from app.js to the server. Copy the random number generator character for character — do not substitute a library, do not modernise it, do not change how it handles integers. Then prove it two ways: first, dump the first thousand numbers the app's version produces for a fixed seed and require the server to reproduce them exactly; second, take fifty real past attempts, rebuild each one through the server, and require the question list to match what the app produces. Include attempts from before the order-seed column existed, because those use an older path.

Then the actual change:

> Questions sent to a trainee must not include the answer. Marking happens on the server. The correct answer comes back only where the current rules already allow it — practice after submitting, an exam after the instructor releases it. Add an instructor-only route that does return answers, because the worksheet export needs them to build a self-marking PDF.

**Check, and do this one by hand:** start an exam, open your browser's developer tools, and look at what the page actually received. There should be no answer key anywhere in it. Then ask Claude to write a test that asserts the same thing, so it stays true.

**Time:** a day or two, most of it on the re-creation proof. If this step overruns, that is why, and it is the right place to spend the time.

---

## Step 8 — Point the app at the new server

**What you're doing:** the front-end stops talking to Google and starts talking to Railway.

> Replace the JSONP mechanism in app.js with normal fetch requests to the new API, sending the login token in an Authorization header. Keep every reply-handling path unchanged — the new server matches the old shapes. Delete the four-probe backend diagnostic, the thirty-second timeout, the read-retry and the saved-URL versus on-screen-URL logic, none of which are needed now.

Two things to keep, and say so:

> Keep the optimistic update behaviour, where a new intake or trainee appears immediately rather than waiting for a reply. It was built to hide Google's slowness but it is better interface design regardless. And keep the read-back confirmation after an exam submission — it used to be a guess because the reply was unreadable, and now it actually proves something.

Then serve the app from Railway too:

> Have Express serve the app's static files from the same service, so the app and the API are on the same address. Regenerate the service worker's file list and bump its version.

Same address means no cross-origin configuration to get wrong — one less category of problem.

**Check:** use the app normally with the Apps Script URL deliberately broken. Everything should work. Log in, create a session, sit a quiz, view a report.

**Time:** a day or two.

---

## Step 9 — Sort out the tests

**What you're doing:** deciding what survives. Your suite is the most valuable asset in this project; treat the triage seriously.

> Go through every test suite and sort it into three groups: (1) suites that only tested Google Apps Script or Google Sheets behaviour and should be retired, (2) backend tests to rewrite against the new API, (3) browser tests to keep, with the fake backend swapped for the real one. Section 6 of MIGRATION_PLAN.md has my intended split — tell me where you disagree with it.

Roughly: about six suites retire, the backend halves get rewritten, and the browser suites carry over almost unchanged. The mutation harness gets repointed at the new code.

Two new tests worth having:

> Add a test that no answer key reaches the browser during an exam, checking the network responses rather than the page. And a test that two simultaneous submissions for one trainee result in exactly one recorded attempt.

Do not delete the retired suites yet. They are the written record of how the old system behaved, and you will want to read them during the port.

One warning from your own history: your browser tests must run against the real source files, not a copy. At v44 they were loading a stale copy and every mutation passed while testing nothing. The suite was green throughout. Ask Claude to confirm the served files and the source files are genuinely the same files.

**Check:** the full suite runs green against Railway, and the mutation suite still catches everything it used to.

**Time:** two to three days.

---

## Step 10 — Put the safety net up

**What you're doing:** the step it is easiest to skip and worst to have skipped. You have already lost the Attempts sheet once.

> Set up a nightly database backup that saves to storage outside Railway — Cloudflare R2 or Backblaze B2, both free at this size. Keep thirty days. Then walk me through restoring last night's backup into a scratch database so I can confirm it actually works.

**Do the restore.** An untested backup is not a backup; it is a hope. Put a reminder in your calendar to repeat it every few months.

Then:

> Add error tracking with Sentry's free tier so failures reach me rather than sitting in a log. Add an external check that pings the health endpoint every five minutes and messages my phone if it stops answering. And set a spending cap in Railway so a runaway loop cannot produce a surprise bill.

**Check:** you have restored a backup and opened a report from it. A test error shows up in Sentry. Stopping the service triggers an alert on your phone.

**Time:** a day.

---

## Step 11 — Find out what it actually costs

**What you're doing:** replacing my estimates with measurements.

> Write a load test that simulates trainees logging in, loading a 94-question paper, answering, and submitting. Run it at 25, 100, 250 and 500 at once. Report response times and any failures at each level.

While each run happens, watch Railway's usage page and write down the processor and memory figures. Then:

> Convert those measurements into a monthly cost using Railway's published rates, and tell me when I should move from the free allowance to the Hobby plan.

**One thing to find out that I cannot:** your real peak is not 2,500. It is however many trainees sit a quiz in the same hour, which the timetable decides. Ten groups at once is 250 people; twenty is 500. Ask whoever builds the timetable, then load-test to double whatever they say.

**Check:** a table of measured response times and measured costs. Decide the plan from that, not from anyone's estimate.

**Time:** a day.

---

## Step 12 — Move the real data

**What you're doing:** carrying the history across. Rehearse twice into a throwaway database, then do it once for real.

**The one trap that will catch you.** Before exporting anything, select the EnergyTech ID column and every intake label column and set `Format → Number → Plain text`. Then export. If you skip this, `0012345` comes out as `12345` and `MAY26` comes out as a date — the same coercion that broke the app at v31 also breaks the export, and reformatting afterwards does not give the original text back. You would import damaged data and only find out weeks later when a trainee cannot log in.

Then:

> Write an import script that loads the exported CSVs into PostgreSQL in dependency order, treating IDs and labels as text, and reading dates as Riyadh time. After importing, report the row count for each table so I can compare against the spreadsheet.

**Check, and do these by hand:**

- Row counts match, table by table
- Open five trainee profiles, spread across different intakes. The statistics, the weakest-lesson list and one attempt's question-by-question review must match the old app exactly.
- Open two session reports. Sat, average, passed, failed and the absentee list must all match.
- Include at least one attempt from before the shuffle feature existed. Those rebuild through an older path, and it is the one that would go wrong silently.

Also: there is one bad row in the Intakes sheet from the v31 incident, with a long date as its label. It has no groups attached, so the simplest thing is to leave it behind.

**Time:** a day or two, including both rehearsals.

---

## Step 13 — Pilot with a few colleagues

**What you're doing:** finding the things no test found.

Pick three to five colleagues — include your supervisor — and two groups, about fifty trainees. Run for a fortnight.

Run at least one complete real assessment: create the session, trainees sit it, submit, release the marks, open the report, print it. Have a colleague do it, not you. You know where the app is delicate; they do not, which is the point.

Leave the Apps Script backend deployed and the spreadsheet untouched throughout. That is your way back.

Keep a written list of every problem. Fix, redeploy, re-run the suite.

**Check:** the fortnight ends with the problem list empty.

---

## Step 14 — Switch over

Pick a week with no assessments scheduled. Not during an assessment week — this is not negotiable.

1. Run the data import again — the pilot fortnight added rows
2. Re-do the hand checks from Step 12
3. Tag the current front-end build in GitHub so going back is one command
4. Switch over
5. Unpublish the Apps Script deployment, so nothing can write to the spreadsheet after the cut

**Then watch for a week.** Check Sentry and the Railway usage page every day. Compare the first invoice against Step 11's projection.

Only after a clean week: delete the retired test suites and archive the old `Code.gs`.

---

## When you are ready for fifty colleagues

All of these, no exceptions:

- [ ] Full test suite green against Railway; mutation suite green
- [ ] No answer key reaches the browser during an exam — verified by looking, and asserted by a test
- [ ] Data checks all passed, including one pre-shuffle attempt
- [ ] The paper re-creation proofs pass: a thousand numbers and fifty real attempts
- [ ] Load-tested to double the timetable's real peak, with no failures
- [ ] A backup has been restored and a report opened from it
- [ ] Alerts reach your phone; spending cap set
- [ ] The old default admin password is gone
- [ ] A colleague has run a full assessment end to end
- [ ] Apps Script and the spreadsheet still intact; previous build tagged
- [ ] A clean pilot fortnight
- [ ] First invoice roughly matches the projection

---

## Three things not to do

**Do not redesign the interface at the same time.** Your browser tests are tied to the current page structure — v40 needed changes because a button swapped an id for a class, and v32's roster rebuild meant rewriting a whole suite. Those tests are what makes this migration safe. Redesign afterwards, when a failure can only be cosmetic.

**Do not rebuild the question banks.** Chapter 04's corrected source files live in `tools/ch04/worksheets/`. The original uploads still contain both typos. A rebuild from the wrong folder brings them back.

**Do not let Claude test against a pretend database.** Real PostgreSQL in a container, every time. The whole saga of making the Sheets stub behave like real Sheets — v31, v33, v34 — happened because Apps Script could not be run properly in a test. PostgreSQL can. A stand-in that is more forgiving than the real thing is the single most repeated bug-hiding pattern in your own notes; it shows up at v30, v41, v42 and v44.
