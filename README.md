# EnergyTech Mathematics Quiz App — Instructor / Trainee Modes

This version separates the app into two clear interfaces:

- **Trainee Mode**
- **Instructor Mode**

It also adds instructor-created session codes, Practice Mode / Assessment Mode, compulsory answers before submission, and a Google Sheets dashboard.

## Embedded Google Apps Script URL

This version already contains the Google Apps Script Web App URL:

```text
https://script.google.com/macros/s/AKfycbzqpiZRw1mofWof5PLSpzbXXbI4xutnrBhayyVvtoUcYs5O3REAZjP97Vi1nFqiRJQ6/exec
```

Trainees do not need to paste the URL. They only need the quiz app link and the session code.

The URL can still be changed from the connection setup area if needed.

## Chapters

The app covers four chapters, each with four parallel papers — 1,360 questions in total:

| Chapter | Questions per paper | Papers |
|---|---|---|
| Chapters 01 & 02 | 114 | Original PDF worksheet, Version B, C, D |
| Chapter 03 | 94 | Original PDF worksheet, Version B, C, D |
| Chapter 04 | 50 | Original PDF worksheet, Version B, C, D |
| Chapter 12A | 82 | Original PDF worksheet, Version B, C, D |

The chapters are listed **by their number on the syllabus, not by when they were
added to the app** — 01 & 02, then 03, then 04, then 12A. Nothing sorts them:
the question tree, the paper list and the counts all walk `CHAPTERS` in `app.js`
in the order it is written, so a new chapter belongs in its numbered place in
that object rather than appended to the end. Within a chapter, the four papers
are ordered by `SET_ORDER` (`original_pdf` first, then B, C, D). Both orders are
checked by `test_ch04.js`.

Chapter 12A is geometry: angles, polygons, area and perimeter, right triangles
and similar figures (lesson codes 12-1.1 to 12-4.1). Its internal key is
`ch12a`, **not** `ch12` — `ch12` has meant "Chapters 01 & 02" since before any
other chapter existed and is written into session codes already stored in the
Sheet, so it could not be reused for the chapter that happens to be called 12A.

Chapter 04 is measurement: significant figures, precision, greatest possible
error, reading a vernier caliper and a micrometer, comparing accuracy, and
significant-figure arithmetic (lesson codes 4-1.1 to 4-6.1). Its internal key
is `ch04`, with no naming conflict to work around this time.

## Choosing what a quiz covers

**Instructor Mode → Create quiz session** opens with a tick-box tree:

```text
Chapters 01 & 02            40 / 456
  Original PDF worksheet    40 / 114
  Version B                  0 / 114
Chapter 03                   5 / 376
  Original PDF worksheet     5 / 94
    Lesson 3-1.0             0 / 6
    Lesson 3-2.1             4 / 4
      Q15  Q16  Q17  Q18
```

Tick at any level — a whole chapter, one version, a single lesson, or individual
questions. Ticking a parent takes everything under it; a half-filled parent shows a dash
rather than a tick, and every row carries a live "selected / available" count.

**A quiz may mix chapters and versions.** Selecting Lesson 3-2.2 from Chapter 03 alongside
Lesson 1-9.1 from Chapters 01 & 02 is a valid quiz. When a quiz spans more than one paper,
each question is labelled with the paper it came from, so "Original Q7" is never
ambiguous.

**Session name** is filled in from whatever is ticked — "Chapter 03 — Lesson 3-2.1",
"Chapters 01 & 02 + Chapter 03", and so on. Type your own at any time and it is left
alone; clear the field to get the suggestion back.

**Number of questions** is a free value, not a fixed list: type it, drag the slider, use
−/+, or press **All**. The maximum is however many questions are currently ticked, and the
value is clamped down automatically if you then narrow the selection. The quiz draws that
many at random (by seed) from the ticked pool — so ticking 94 and asking for 20 gives a
different random 20 for each seed.

The session code carries the whole selection, so a trainee entering the code gets exactly
the questions the instructor chose. Session codes created before any of this still work
and still resolve to Chapters 01 & 02.

### Chapter 03 contents

Chapter 03 covers SI units and prefixes, metric conversions (length, mass, area, volume,
capacity), choosing a sensible unit, temperature conversion, and imperial/metric
conversion — lesson codes `3-1.0` through `3-7.1`.

Practice Mode shows an explanation video for 74 of the 94 Chapter 03 questions on the
Original paper, decoded from the QR codes on the worksheet. Versions B, C and D show 52:
where a version only changed the numbers the video still teaches the right method and is
kept, but on the 22 recall questions the version asks about a different fact, so the video
is withheld rather than explaining the wrong thing.

Pictures: the four tape-measure questions appear on all four papers (the ruler is drawn by
the app on B/C/D so each shows a different reading). The twelve decorative photographs
appear only on the Original, because B/C/D ask about different items; those questions are
text-only there and remain fully answerable from their wording.

The Chapter 03 worksheet arrived without an answer key, so the answers were derived here
and independently re-checked. See **`Chapter03_Answer_Key_Review.md`** for the full key
with reasoning, the three judgement calls worth a decision, and the one printed-worksheet
defect that was corrected (Q81 offered the same value as two different options).

Versions B, C and D keep each question's lesson code and type but change the numbers, or
swap in a different item for the "which unit would you use" questions. No generated
question repeats the original, and no paper repeats a question within itself. Answer
letters are spread evenly across a/b/c/d so the papers can't be gamed by always picking
one letter.

## Corrections to the printed worksheets

### Chapters 01 & 02 — Q57 (lesson 1-10.1)

In this topic **"and" marks the decimal point and nothing else**: 105 is "one hundred
five", while 105.3 is "one hundred five and three tenths".

Q57 reads *"Five hundred and sixty-three thousandths"*, which under that rule is
**500.063**. The printed sheet offers 500.063 as option (a) — and 500.630 as a
misplacement trap — so the question was written to test the rule, but its answer key
pointed at 0.0563, which is not correct under either reading. **The key is now (a)
500.063.**

Versions B, C and D asked the same thing but offered no whole-number-plus-fraction
option at all, so they could only be answered by ignoring the "and". Their options have
been rebuilt to mirror the original: the rule-correct value, the ignore-the-"and" trap,
and two place-value traps.

Every other lesson 1-10.1 question was checked in both directions — words to number and
number to words — and all of them already follow the rule.

### Chapter 03 — tape-measure questions in Versions B, C and D

Every option on a tape question is a length, so they have to differ in **value**, not
just in wording. Q18 in each generated version offered the reading in centimetres as a
distractor while the key was the same reading in metres — 13.2 cm and 0.132 m being the
same measurement, the question had two correct answers. The distractors are now picked
by their value in centimetres and checked against the reading and against each other.

A related tidy-up: Q84 in the generated versions paired `kL` with `m³` (and elsewhere
`mL` with `cm³`), which are identical volumes, so two options were the same. Those
distractor sets have been changed.

The printed worksheet's own Q15 lists "1.53 cm" and "15.3 mm", which are the same length —
both wrong, so the answer is unaffected, and it is left exactly as printed.

### Chapters 01 & 02 — five duplicated options

Q23, Q24 and Q49 in Version C and Q23, Q24 in Version D each listed the same option
twice, leaving only three real choices. The duplicate has been replaced with a plausible
wrong answer in each case; the correct answers are unchanged.

## The instructor page

Eight cards, in the order the work actually happens:

1. **Create quiz session** — the reason to open the app, so it is first
2. **Instructor preview** — appears once a paper is generated
3. **Instructor dashboard** — results and analysis
4. **My sessions** — what you have run; releasing exam marks
5. **Intakes, groups and trainees** — roster
6. **Instructor accounts (admin)** — admin accounts only
7. **Change my password**
8. **Instructor connection setup** — the backend URL

Each card's heading carries a **▾ triangle on the right that folds it away**;
the heading row itself works as a click target too, which is easier to hit on a
tablet. What you fold is remembered on that device and comes back folded next
time, so an instructor who only ever creates sessions can collapse everything
else once and be done.

**Connection setup starts folded.** The Apps Script URL is embedded in the
build, so that card is only needed on the day the backend is redeployed to a
new URL — it is kept, at the bottom, rather than removed, so that day does not
require a new build from scratch.

`test_panels.js` covers the order, the folding, that the folded state survives
to the next visit, and one structural invariant worth knowing about if you edit
this: the fold control is built **around each existing `<h2>`, in place**, not
lifted to the top of its card. "My sessions" keeps its heading inside
`#sessionsWorkspace`, which the app hides wholesale when a session report is
opened; hoisting the heading out would leave it stranded above an open report.

## Main workflow

1. Instructor opens **Instructor Mode** and logs in (or requests an account — see **Instructor accounts** below).
2. Instructor ticks what the quiz covers in the question tree, then sets:
   - session name (suggested from the selection)
   - group
   - number of questions
   - seed
   - question order
   - Practice Mode or Assessment Mode
3. App generates a **session code**.
4. Trainees open **Trainee Mode**.
5. Trainees enter:
   - name
   - group
   - EnergyTech ID
   - session code
6. Trainees answer all questions.
7. Trainees submit.
8. Instructor loads the dashboard to see:
   - lowest-performing trainees
   - most problematic questions
   - most problematic lessons

## Practice Mode vs Assessment Mode

### Practice Mode

Trainees see after submission:

- score
- percentage
- wrong questions
- correct answers highlighted
- feedback/details

**The explanation video sits on the question itself.** Every question they got wrong grows a
**▶ Watch the explanation** button inside its own box, opening the same video the wrong-questions
list at the foot of the page points to. On a long paper that saves scrolling to the bottom and
matching Q-numbers by eye. A question with no QR code on the printed worksheet has no video, so
its box stays plain — the list still names it. Clearing the answers takes the buttons away with
the marking.

### Assessment Mode

Trainees see only a submission confirmation. Detailed feedback is hidden from trainees but still saved for the instructor dashboard.

**Once the instructor releases the results**, the trainee can open the exam under **My results**
and the paper comes back question by question — their answer, the correct one, and on each
question they got wrong the same **▶ Watch the explanation** button. Before release there is
nothing to open, and no video anywhere.

An exam still carries no video while it is being sat or straight after it is handed in, and none
in the instructor's own preview of an exam either: the video names the method for a question
being scored, so it waits until the marking is out.

## Required answers

Trainees cannot submit until every question is answered.

If a trainee tries to submit too early, the app lists the unanswered questions and highlights them.

## Who may do what: admins, instructors, and cover

The roster — intakes, groups and trainees — belongs to **admins**. Only an admin
can create, rename, move or delete any of it.

An admin can also **assign groups to an instructor**, which is how cover works
when one teacher takes another's class. Do it from **Instructor accounts
(admin)**: each instructor row has a *Covers* column and a **Change** button,
and the editor lists every group in the centre to tick. Admins are not assigned
groups — they already see all of them.

An instructor who has been assigned groups sees the same
**Intakes, groups and trainees** card an admin sees, holding only their groups.
In it they may:

| | |
|---|---|
| ✓ | see their intakes, groups and trainees |
| ✓ | reset a trainee's password (the one write they have — a trainee who forgot theirs is standing in front of whoever is teaching that morning) |
| ✓ | click a name to open that trainee's record |
| ✗ | add, edit, move or delete anything |
| ✗ | see any group not assigned to them |

Two things are deliberately **not** widened by an assignment:

- **Results.** The dashboard and *My sessions* still show only sessions that
  instructor created. Cover does not hand over another teacher's results.
- **A trainee's history.** Opening a trainee's record shows their attempts on
  **that instructor's own sessions**, not on papers set by anyone else. A
  covering instructor stepping in fresh will therefore see an empty record
  until they set their own paper — which is the intended reading of "their
  history", not an error.

### It is enforced in the backend, not the page

`roster_list` and `trainee_list` filter to the caller's assigned groups inside
`Code.gs`, and the trainee password reset checks the trainee's group before it
does anything. This matters: an instructor is a signed-in caller who can ask
the backend directly, so a rule enforced only by hiding rows in the browser
would not be a rule. `test_backend.js` §14 exercises all of it against the real
`Code.gs`; `test_instructor_roster.js` covers what the page draws.

### The Assigned Groups column

Assignments live in a new **Assigned Groups** column on the `Instructors`
sheet, as `JAN26/G1;JAN26/G3`. It is appended to an existing spreadsheet
automatically, without touching any row — the same migration every other added
column in this project has used. **This build changes `Code.gs`, so the Apps
Script has to be redeployed** for any of the above to work; until then the app
behaves as it did before.

## Instructor accounts

Instructor Mode is now protected by real accounts instead of a single shared password, so colleagues can use the same app with their own login.

### How it works

- Every instructor has their own **username and password**, checked by the Google Apps Script backend (not just in the browser).
- Passwords are stored **hashed** (salted SHA-256) in the `Instructors` sheet tab, never in plain text.
- A colleague who does not have an account yet clicks **Need an account? Request one** on the instructor login screen, fills in their name, a username, and a password, and submits a request.
- New requests start as **pending**. They cannot log in until an admin approves them.
- Logging in gives the browser a login token (stored on that device) that is valid for 30 days or until an admin revokes the account, whichever comes first — revoking/rejecting an account takes effect immediately even if the person is already logged in elsewhere.

### The admin account

The first time the backend runs, it automatically creates one bootstrap admin account:

```text
Username: adnen
Password: 12341234
```

**Log in with this account first and change the password immediately** from **Instructor Mode → Change my password**. This is now a real, server-checked login credential, not just a UI gate, so leaving it at the default matters more than the old version did.

Only admins can see a **Instructor accounts (admin)** panel at the bottom of Instructor Mode, where they can:

- approve or reject pending requests
- revoke an approved colleague's access
- promote a trusted colleague to admin, or remove admin from someone else (you can't remove the last admin)

To make someone else an admin later, approve their account first, then use **Make admin** in that panel — there's no need to edit the Sheet by hand.

### Who sees what data

- Regular instructors only see **their own** sessions and their own trainees' results on the dashboard.
- Admins see **everyone's** data, with an extra "Instructor" column showing who owns each row.
- Sessions, attempts, and item responses created before this update have no owner on file, so only admins will see that older data; it won't appear on any individual instructor's filtered dashboard.

### Security notes (read this before relying on it for anything sensitive)

This is a real improvement over the old client-side-only password check, but it is still a static web app talking to a Google Sheet, not a hardened backend. A few honest caveats:

- Login and signup requests are sent as URL parameters (over HTTPS) because of how Google Apps Script handles cross-origin responses — the same technique this app already used for loading sessions and the dashboard. The password itself is never stored in plain text, but it does briefly appear in the request URL, which could show up in the Apps Script execution log (visible only to you, the script owner) or in browser dev tools if someone is watching a shared screen. Ask colleagues to use a password that isn't reused from anything sensitive.
- Anyone with the app link can see the Apps Script Web App URL in the page source, but they still need an approved account to create sessions or read the dashboard — the sensitive actions are now gated server-side.
- There's no rate limiting on login attempts, so treat this as "good enough to keep a classroom tool organized and to stop casual access," not as protection for genuinely sensitive data.


## Google Sheets setup

Online session codes and result collection require Google Apps Script.

### 1. Create a Google Sheet

Create a new Google Sheet, for example:

```text
EnergyTech Quiz Results
```

### 2. Add Apps Script

1. Open the Google Sheet.
2. Go to **Extensions > Apps Script**.
3. Delete any existing code.
4. Copy the code from:

```text
google_apps_script/Code.gs
```

5. Paste it into Apps Script.
6. Save.

### 3. Run setup

In Apps Script:

1. Select the function `setup`.
2. Click **Run**.
3. Authorize the script.

This creates three sheets:

- `Sessions`
- `Attempts`
- `ItemResponses`

It also creates an `Instructors` sheet (if it doesn't already exist) and adds the bootstrap admin account described above.

**`setup()` is safe to run at any time.** It only ever adds what is missing: a sheet that already holds rows is left exactly as it is, and no recorded attempt is removed. Run it as often as you like — after pasting a new `Code.gs`, to check the script is alive, or for no reason at all.

> **This was not always true.** Before v46, every run of `setup()` cleared `Sessions`, `Attempts` and `ItemResponses` back to their header rows — and an earlier version of this README described that as the way to "reset quiz results". Pressing **Run** in the Apps Script editor, which is the ordinary way to check a deployment, therefore erased every paper anybody had sat. If you are upgrading from an older `Code.gs`, take a copy of the spreadsheet before you paste the new one.

To deliberately erase every recorded attempt there is now a separate function, `eraseAllRecords_`, and it refuses to run until you arm it: set `CONFIRM_ERASE` at the top of `Code.gs` to `ERASE EVERYTHING`, run it once, then set it back to `''`. It is not reachable over the web, and nothing in the app calls it.

### 4. Deploy as Web App

1. Click **Deploy > New deployment**.
2. Type: **Web app**
3. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone with the link
4. Deploy.
5. Copy the Web App URL.

### 5. Connect the quiz app

In Instructor Mode:

1. Paste the Web App URL.
2. Click **Save URL**.
3. Create a session code.

Trainees also need the same Web App URL saved on their tablets. Once saved, they only need to enter the session code.

## Trainee interface change

The trainee interface no longer shows connection settings. The Google Apps Script URL is
embedded in the app. Trainees now log in with their own account (see **Intakes, groups and
trainees** below) and then enter the session code; a guest who is not on a roster can still
sit a session if the instructor allowed it when creating that session.

## Intakes, groups and trainees

An **intake** (for example `JAN26`) holds **groups** (`G1` to `G20`), and each group holds
**trainees**. A group must belong to an intake, and a trainee must belong to a group.

### For admins — the roster workspace

Three panes, left to right: **Intakes → Groups → Trainees**. Click an intake to see its
groups, click a group to see its trainees beside it. The list you are working on is always
next to what you clicked, never below the fold. Everything loads by itself when you open
Instructor Mode; **Refresh** re-reads it if someone else has been editing.

Each intake and group shows its counts, and how many trainees still have **no login** — the
number you chase at the start of a term.

- Trainees have **one Name field**, not a family/given split — Saudi names run
  given-father-grandfather-family and do not divide cleanly in two. Sheets created before
  this change are migrated automatically the first time the new backend runs: the two
  columns are joined, given name first, and the spare column is removed.
- **+ New** in a pane adds an intake, a group, or a trainee. Adding an intake selects it and
  moves you to the Groups pane; adding a group opens its (empty) trainee list. The
  add-a-trainee form stays open and clears itself, so a run of them can be typed one after
  another.
- **Rename / Delete** appear on whichever intake or group is selected, so they are not
  sitting next to every row waiting to be mis-clicked. A rename cascades to everything
  underneath it. A delete is refused while anything still hangs off it, and says how many
  are in the way.
- **Search** at the top finds any trainee, in any intake, by name or EnergyTech ID, and
  tells you which group they are in.
- **Filter chips** above the list — All, No login yet, Has a login, Revoked — each with a
  live count.
- **Tick trainees** to get a bar offering **Move to <group>**, **Revoke login**, or Clear.
  Moving is how people change group mid-term; it keeps their names, their account and their
  results.
- **Edit** turns a row into an editor in place, including a Group dropdown, so nothing is
  done through browser pop-up boxes.

Deleting a trainee is refused once they have submitted an attempt, because their results
would lose their owner. Revoke their login instead — the row and the results stay, and they
can no longer sign in.

### Trainee profiles

**Click a trainee's name** anywhere in the roster — including in search results — to open
their record. It replaces the three panes so there is room for it, with a breadcrumb back.

- **The figures**: quizzes taken, average, best, and how many questions they have answered.
- **Weakest lessons**: every lesson they have been asked about, ranked worst first, with the
  percentage and the counts behind it. Lessons with only one question, and lessons they get
  right every time, are left out — this is a list of what to go back over, not a full table.
- **History**: every attempt, newest first, with when, which session, what it covered, the
  mode and the score.

**Press "See answers"** on any attempt to see that paper question by question — the question
itself, the four choices, the one they picked and the right one, marked. It is the same view
the trainee gets on submitting, after the fact.

The questions are not stored with the attempt; only the answers are. They are rebuilt from
the seed, question set, count and order saved with the attempt — the same inputs that
generated the paper in the first place, so question 3 here is the question 3 they sat. If
the question bank has changed since, the rebuild will not line up, and the page says so and
falls back to showing the recorded letters rather than putting the wrong question next to an
answer.

Instructors see only attempts from their own sessions; admins see all of them.

### CSV import — one file for the whole intake

Select the intake, press **Import CSV**, and give it one file for everyone. Three columns:

```
EnergyTech ID, Full name, Group
ET1002,Fahad Abdulrahman Nasser Al Qahtani,G1
ET1003,"Turki Saad Al-Ghamdi, junior",G2
ET1004,Omar Khalid Al-Harbi,G3
```

- **Any group named in the file that does not exist yet is created**, so a new intake can be
  built from a single import rather than twenty.
- A header row is detected and skipped; you can also leave it out.
- Commas, semicolons and tabs all work as separators.
- The Group column is optional. Leave it off and open a group first, and everyone goes into
  that group — the old per-group behaviour.
- **Everything between the ID and the group is the name**, so a name split across cells by a
  stray comma still comes through whole — as do the long multi-part names that include the
  father's and grandfather's names. A name that really does contain a comma just needs
  quotes around it.
- Nothing is written until you confirm. The preview shows the count per group, which groups
  will be created, which IDs are already on record anywhere in the system, which are
  repeated inside the file, and which lines could not be read and why.
- A group name outside G1–G20 stops the whole import rather than half-applying it.

**↓ CSV** downloads the open group, including each trainee's group and account state.

### For trainees — accounts

A trainee presses **Trainee**, then **First time? Create my account**, enters the
EnergyTech ID that is on their intake list and chooses a password of at least six
characters. Being on a roster is what authorises the account, so there is no approval
queue — but an admin can revoke one at any time.

Once signed in they see their own record (ID, family name, given name, intake, group) and a
box for the session code. They can change their own password from the same screen. The
login lasts 30 days on that device; logging in somewhere else ends the earlier one.

**What this changes about results.** When a signed-in trainee submits, the name, ID, group
and intake written to the sheet are read from the roster row on the server — not from
anything the browser sent. The Attempts sheet gained two columns: **Intake**, and
**Registered** (`yes` for an account holder, `walk-in` for a guest).

### Walk-ins

Tick **Allow trainees without an account to sit this one** when creating a session, and a
guest can press **No account? Sitting as a guest**, enter the code plus their name, group
and ID, and take the quiz. Their attempt is marked `walk-in`. Sessions created before this
feature existed, and any session without the box ticked, keep guests out.

### Session Intake and Group

The session form's **Intake** and **Group** fields are now pickers filled from the roster,
and the group's trainee count is shown beside its name. Every signed-in instructor gets the
pickers; only admins can edit what is in them. The session code is still derived from the
group, e.g. `G1-4826`.

## Downloading trainee activity

The **Instructor dashboard** panel has two downloads, both available once the dashboard is
loaded:

- **Download trainee activity (CSV)** — one row per trainee submission: time, name, group,
  EnergyTech ID, session code and name, mode, question set, score, total, percentage,
  wrong and unanswered counts, seed, question order and attempt ID. Admins also get an
  Instructor column.
- **Download full analysis (CSV)** — the three dashboard tables (attempts, question
  analysis, lesson analysis) in one file.

**Both files contain every row.** The tables on screen are capped at the weakest 20
trainees and 30 questions to stay readable, but the downloads are built from the loaded
data rather than from the page, so nobody is left out of the file.

Files are written with a UTF-8 byte-order mark so Excel opens accented names correctly,
and are named with the date and time, e.g. `energytech_trainee_activity_2026-08-25_1944.csv`.

Instructors see only their own trainees; admins see everyone. The loaded results are
cleared on logout, so they cannot be downloaded by whoever signs in next on that device.

## Dashboard diagnostic button

Instructor Mode now includes **Test backend connection** next to the dashboard button. Use it first if the dashboard does not load.

If the backend test fails, update the Apps Script deployment as a **new version**:

1. Apps Script → paste the latest `Code.gs`.
2. Save.
3. Deploy → Manage deployments.
4. Edit deployment.
5. Version → New version.
6. Deploy.
7. Refresh the quiz app with Ctrl + F5.


## Troubleshooting dashboard and submissions

If the dashboard button does not respond:

1. Open Google Apps Script.
2. Replace `Code.gs` with the latest file from this folder.
3. Click **Deploy > Manage deployments**.
4. Click the pencil/edit icon.
5. Under **Version**, choose **New version**.
6. Click **Deploy**.
7. Refresh the quiz app with **Ctrl + F5**.

Do not run `setup()` again unless you want to clear the existing session/attempt results. Running `setup()` resets `Sessions`, `Attempts`, and `ItemResponses`, but — as noted above — it leaves the `Instructors` sheet alone, so instructor accounts survive a reset.

About the Google Sheet tabs:

- `Attempts` has one row per trainee submission.
- `ItemResponses` has one row per question answered. So one 10-question quiz creates 10 rows with the same Attempt ID. This is normal.
- `Sessions`, `Attempts`, and `ItemResponses` each now carry an **Owner Username / Owner Display Name** pair at the end of the row, identifying which instructor's session it belongs to. This is what powers per-instructor dashboards.
- `Instructors` holds one row per instructor account: username, display name, hashed password + salt, role (`admin`/`instructor`), status (`pending`/`approved`/`rejected`), and login token info. Don't share this sheet with trainees.


## Important notes

- For trainees on different tablets, the session must be saved online using the Google Apps Script URL.
- If no URL is saved, a session code works only on the same device where it was created.
- Online submission needs internet access.
- The instructor dashboard is based on the submitted Google Sheets data.
- The dashboard can be exported as CSV.

## Files

- `index.html`: app interface
- `app.js`: app logic
- `question_bank.js`: Chapters 01 & 02 question banks
- `question_bank_ch03.js`: Chapter 03 question banks
- `explanation_links.js`: explanation video links, keyed by chapter
- `style.css`: styling
- `google_apps_script/Code.gs`: Google Sheets backend
- `service-worker.js`: offline cache (bump `CACHE_NAME` when you redeploy)
- `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`,
  `favicon-32.png`, `favicon-16.png`: the app icon — see below
- `start_app_windows.bat`: optional local server launcher for Windows

## The app icon

One source image, six files, because the platforms disagree about what an icon
is. They are all generated by `tools/make_icons.py` from `tools/icon-source.png`
— run that rather than an image editor if the icon ever changes, or the awkward
two will drift out of step with the rest:

| file | used by | why it is not just a resize |
|---|---|---|
| `icon-192.png`, `icon-512.png` | the manifest, `purpose: any` | the plain artwork, transparent corners kept |
| `icon-maskable-512.png` | Android, `purpose: maskable` | Android crops adaptive icons to a circle, which would cut off the pencil and the document's corners. The artwork is scaled into the middle 80% on a full-bleed field of its own blue, so the rounded-square edge disappears into the field rather than showing as a seam. |
| `apple-touch-icon.png` | iOS home screen | iOS ignores the manifest, ignores transparency, and paints unset pixels **black**. This one is deliberately opaque, and iOS rounds the corners itself. |
| `favicon-32.png`, `favicon-16.png` | browser tab | 16px is what a tab actually draws; letting the browser downscale the 32 blurs it |

The same artwork also sits in the page header, next to the title.

`test_appshell.js` covers all of this: that each file exists, that it really is
the size the manifest claims, that the two full-bleed ones are genuinely opaque
(reading the actual pixels), and that the service worker registers and caches
every file it promises to.

### Sheets the backend keeps

`Sessions`, `Attempts`, `ItemResponses`, `Instructors`, and — added with the intake module
— `Intakes`, `Groups` and `Trainees`. Re-deploying over an older backend does not lose
anything: the new columns (`Intake` and `Registered` on Attempts, `Intake` and
`Allow Walk-In` on Sessions) are appended to the existing header row, and the roster sheets
are created only if they are missing.

## Explanation videos and chapters

`explanation_links.js` is keyed by chapter:

```js
window.EXPLANATION_VIDEO_LINKS = {
  "ch12": { "1": "https://...", "2": "https://..." },
  "ch03": {}
};
```

Both chapters' links are decoded from the QR codes printed on their worksheets:

- `ch12` — 107 links (Q58, Q81, Q82, Q83, Q88, Q89, Q90 have no QR code on the sheet)
- `ch03` — 74 links

The 20 Chapter 03 questions without a link are the "which metric unit would you use"
judgement questions plus Q94, which carry no QR code on the printed sheet: Q25–Q30,
Q35–Q40, Q47, Q49, Q67, Q68, Q83, Q84, Q93, Q94. In Practice Mode those show as
"No video" pills, exactly as the Chapter 01 & 02 questions without links already do.

Keying by chapter is what stops a Chapter 03 question from opening the Chapter 01 video
of the same number.


## Footer credit

The app footer displays:

```text
EnergyTech Mathematics Quiz App — Prepared by Mr. Adnane Khalifa, Mathematics Instructor.
```


## Practice Mode explanation videos

The app includes explanation links decoded from the QR-code PDF.

In **Practice Mode**, after a trainee submits the quiz, the list of wrong questions becomes clickable. Clicking a wrong question opens the corresponding explanation video in a new tab.

In **Assessment Mode**, these links are hidden from trainees.

Questions without decoded QR links are shown as normal non-clickable pills.


## Corrected QR video links

The explanation links in `explanation_links.js` were regenerated directly from the QR-code PDF.

Decoded links included: 107  
Questions without decoded QR links: Q58, Q81, Q82, Q83, Q88, Q89, Q90


## Session code copy button

The generated session code now has a **Copy** button beside it, so the instructor can copy the code easily and share it with trainees.


## Session sync fix

Session codes are now saved using the embedded Google Apps Script URL by default, ignoring older stale URLs saved in browser storage. After a session is created, the app immediately checks whether the session can be loaded back from Google Sheets. If the online save is not verified, the instructor sees a warning instead of assuming trainees can use the code.


## Session reports

Every row in **My sessions** — practice and exam alike — has a **Report** button. It opens a full-page report of that one sitting, in place of the sessions list, with a **Back to my sessions** button to leave it.

The report shows:

- **The overall picture.** How many sat it, the average percentage, how many scored full marks, how many passed and how many fell below the pass mark. Underneath, the highest and lowest marks.
- **How each group did**, as a bar per group, when more than one group sat the session.
- **Every trainee's mark**, in a table per group. Groups run weakest-average first, and inside each group the trainees run from the worst mark to the best, so whoever needs the most help is at the top of the page rather than eleven rows down. Each row carries the trainee's name, EnergyTech ID, raw score and percentage.
- **Who did not sit it** — the trainees on the roster for that intake and group with no paper on record.

**The pass mark is 70%.** It is 70% everywhere in the report: the "below 70%" count, the pass count, and the red or green of each row and group average. The 80/50 colour bands used elsewhere in the app answer a different question (how is this trainee getting on) from the one a report asks (did they pass).

### Opening one paper

Clicking a row, or its **See answers** button, opens that trainee's paper question by question — every question as they saw it, the option they chose, and the correct one — with their name and ID at the top. **Back to the report** returns to the list with the figures intact.

### Retakes

A trainee who sat the session twice appears **once**, standing on their most recent sitting, tagged `SITTING 2`. Counting a retake as a second trainee would put the abandoned paper into every average on the page.

### Exams whose results are not released yet

The report shows the marks whether or not you have released them. Releasing is what lets the *trainees* see their marks; you are the one deciding whether to release, and cannot decide without looking. A held-back exam carries a note on the report saying the marks are not visible to the group yet.

### Printing

The **Print** button prints the report and nothing else — no page header, no navigation, no buttons, and without the See answers column. Each group's name sits in its table header, so a group that runs over a page break still says which group it is at the top of the next page. Print to PDF to keep or send a copy.

### Who can open what

An instructor can report on the sessions they ran; an admin can report on anybody's. A paper the viewer would not be allowed to open is not listed at all, so the report never offers a row that then refuses to open.


## Exporting a session as an interactive worksheet

After **Create session code**, an **Interactive worksheet** panel appears under the code. It turns the paper the app just drew into a self-marking PDF worksheet: one radio button per answer, a running total, a **Calculate Score** button that lists the wrong and unanswered questions, and a mastery table coloured by objective. It is the same design as the hand-written Chapter 03 worksheet, generated from whatever the session covers.

### Why LaTeX, and how you get a PDF

The question bank is stored **as LaTeX** — that is what the printed worksheets were set in, and it is why the app can show a proper `\dfrac`, a column-arithmetic stack and a TikZ circuit. The export takes those bodies through untouched, so a fraction in the worksheet is the same fraction the trainee sees on screen. Nothing is re-drawn or approximated.

That means the worksheet is produced as a `.tex` file, and something has to compile it. Two buttons:

- **Open in Overleaf** — posts the worksheet to Overleaf, which compiles it in your browser. Press **Recompile** there, then download the PDF. No LaTeX installation. If the paper uses photographs they are bundled and sent with it automatically.
- **Download .tex** — the file itself, for compiling locally. Run `pdflatex` **twice**:

  ```
  pdflatex worksheet.tex
  pdflatex worksheet.tex
  ```

  It is pdfLaTeX only: the interactive form fields are built with pdfTeX's own `\pdfannot` and `\pdfobj` primitives, so XeLaTeX and LuaLaTeX will not do. If the paper uses photographs the download is a `.zip` instead — unpack it and compile `worksheet.tex` from inside the folder, or upload the zip to Overleaf.

Open the finished PDF in **Adobe Acrobat Reader**. The marking is form JavaScript, which Chrome's and Firefox's built-in PDF viewers do not run — the worksheet still prints and still fills in there, it just will not score itself.

### The answer key is inside the file

It has to be: that is what the PDF marks itself against. Anyone who opens the worksheet in a text editor can read it, and this is true of the PDF as well as the `.tex`. **Do not give the file to trainees before they have sat the paper.** The panel says so next to the buttons, on every export, exam or practice.

If you want trainees to sit the paper without the answers travelling with it, use the session code and the app — the online route is the one where marks are held back until you release them.

### What the worksheet contains

- **A header** with **fillable boxes** for name, EnergyTech ID and group, and the session's own name, code, intake and group on the right. The boxes are real PDF form fields: the trainee types into them on screen, and what they type is kept when they save the file, exactly like their answers. Each box is **one field with a box on every page**, so typing the name on page one fills it in on page four as well — which also means a printed copy carries the name on every sheet. **Clear all** clears the answers and leaves the name, ID and group alone.
- **The questions**, two to a column, in the order the app drew them — the teacher's reference copy. An exam with *shuffle each launch* gives every trainee a different order by design, so no printed paper can match all of them; the worksheet uses the base order.
- **A score panel**: a live total, then **Calculate Score** for the percentage and the lists of wrong and unanswered questions.
- **An objective coverage & mastery table**, built from the lesson codes of the questions actually drawn — each objective, how many items it has, which question numbers, and a cell that colours red through amber to green when you press Calculate Score.

### Limits

- Overleaf's importer takes the worksheet in a single POST. A paper carrying a great many photographs can exceed that; the panel says so and points you at the download.
- A question whose lesson code covers two objectives (there are eight in the bank, e.g. `1-1.1 1-1.2`) forms its own row in the mastery table.

## Forgotten passwords

There is no email in this app, so nobody can be sent a reset link. A reset is
therefore one person doing it for another who is standing in front of them: an
admin presses a button, reads out the temporary password it gives back, and the
account has to choose its own before it can do anything else.

### Resetting a trainee

**Instructor Mode → the roster workspace**, find the trainee, press **Reset
password** on their row. The button is only there for a trainee whose account is
active:

- a trainee who has never made an account has nothing to reset — they are told to
  use **First time? Create my account** instead;
- a revoked account has to be turned back on first, otherwise a reset would hand
  out a working password for an account you had deliberately closed.

**Only admins can reset a trainee.** A plain instructor cannot, the same rule as
every other roster edit.

### Resetting an instructor

**Instructor Mode → Instructor accounts (admin) → Reset password** on the
colleague's row. An admin may reset a fellow admin — that is the whole answer to
"what if the admin forgets" — but not themselves; their own row has no button,
because **Change my password** is the route for a password you still know.

### What the temporary password is

Eight characters in two groups of four, e.g. `K7RM-P2XQ`, drawn from an alphabet
with no `O`, `0`, `I`, `l` or `1` in it, so it survives being read out loud or
copied off a screen. It is shown **once**, on the screen of the admin who pressed
the button, with a **Copy** button. It is not stored anywhere readable: the sheet
holds only its hash, and no listing — roster, roster summary or instructor
accounts — ever returns it. If it is lost before it is used, reset again.

### What a reset does immediately

- The old password stops working.
- **Every device that account was logged in on is signed out**, right then. Somebody
  who has forgotten a password may well have lost the phone it was signed in on,
  and this is the moment to close that.
- The account is flagged **must change password**. At the next login it can do
  exactly one thing: choose a new password. The roster, the dashboard, sessions,
  a trainee's own history — all refuse until it does, and the app puts up the
  change-password panel rather than the normal screen. A trainee in this state
  cannot sit a paper either; the submission is refused rather than being quietly
  recorded as a walk-in under the same name.
- Choosing the new password clears the flag and everything opens up. The temporary
  one is spent at that moment.

### If the only admin is locked out

Nothing inside the app can rescue a lone admin — a reset needs a second admin to
press the button. **Promote a second admin now, before you need one**
(**Instructor accounts (admin) → Make admin**); the panel says so when you are the
only one. Failing that, the account rows live in the `Instructors` tab of the
Google Sheet and the owner of that Sheet can clear the hash and salt of the admin
row by hand, which lets that username sign up again.

### Upgrading an existing deployment

The reset needs one new column, **Must Change Password**, on both the `Trainees`
and `Instructors` tabs. It is added automatically the first time the new
`Code.gs` answers a request — existing rows are untouched and nothing is
rewritten. There is no migration step to run.

## Chapter 12A

Geometry — angles, polygons, area and perimeter, right triangles and similar
figures. Four papers of 82 questions, lesson codes `12-1.1` to `12-4.1`, with
80 explanation videos.

The versions are **A, B, C and D**. All four came from the teacher as parallel
papers, but A is the one the QR codes and the answer-key gap (below) both point
back to, so it is keyed and labeled **`original_pdf` / "Original PDF worksheet"**
— the same convention Chapters 01 & 02 and Chapter 03 use for their base
version, and the one `app.js`'s `SET_ORDER` lists first so the four papers
sort A to D instead of falling through to alphabetical-by-key order.

### The chapter key

Its key is **`ch12a`**. The obvious `ch12` was already taken — it has meant
"Chapters 01 & 02" since before Chapter 03 existed, and session codes written
with it are sitting in the Sheet. Handing `ch12` to the chapter called 12A would
have silently redirected every one of those to the wrong paper. A later Chapter
12B follows the same pattern (`ch12b`).

### The drawings

Nearly every question is set over a figure, and most of them keep their
dimensions in the picture rather than in the sentence — "The area of the next
trapezoid is", with the 10.0 m and 16.0 m written on the drawing.

The figures are the worksheet's own TikZ, compiled with pdfLaTeX, so what a
trainee sees on screen is the same drawing that prints on the paper rather than
a redrawing of it. There are **162 distinct drawings** across the four versions,
in `figures_ch12a/`, named by a hash of their source so that the same drawing
used by two versions is stored once. The palm-tree photograph on Q76 is a real
image, one per version, in `images/`.

Each drawing is stored **twice**, as `<hash>.svg` and `<hash>.pdf`, from the same
compile:

- the **SVG** is what the page shows — it is what a browser wants, and it is the
  version the service worker caches for offline use;
- the **PDF** is what the worksheet export sends to Overleaf, because pdfLaTeX
  cannot read SVG at all. It stops with *"Unknown graphics extension: .svg"* and
  produces a worksheet with no drawings in it.

The PDFs are not precached: 3.5 MB on every trainee's device for a button only
an instructor presses, and only while online. They are fetched when the export
runs.

### The original worksheet's answer key

The worksheet arrived with an answer key covering **versions B, C and D only**.
The original PDF worksheet had none, so every one of its 82 answers was
re-derived from the question and its drawing by `tools/ch12a/verify_ch12a.py`.

What makes that trustworthy is that the same code, unchanged, was first run
against the three versions that *do* have a key: it reproduces **246 of 246** of
the teacher's answers, and `tools/ch12a/mutate_verifier.py` shows that all 48
question families would have complained had one of those answers been wrong.
Thirteen of the original worksheet's answers are confirmed a second way, by a
version that asks the identical question over the identical drawing.

**If you have the original worksheet's official key, it is worth comparing.**
The derivation is careful and checked, but it is a derivation.

### Exporting a Chapter 12A worksheet

Two things about this chapter have to be right or the export comes back broken,
and both are held down by mutations in `mutate_backend.js`:

1. **The pictures go as PDF, not SVG** (above). `worksheetImageSrc` in
   `worksheet_tex.js` does the swap, and both the `\includegraphics` line and
   the list of files to bundle go through it — naming the picture in two places
   is how one ends up asking for a file the other did not pack.
2. **The angle and parallel signs are declared.** The bank stores ∠ and ∥ as
   characters rather than as `\ang` and `\parallel`, and the LaTeX kernel knows
   neither. Without `\DeclareUnicodeCharacter{2220}` and `{2225}` in the
   preamble, every geometry question stops the compile.

### A trap to remember when comparing versions

"The same question" is not "the same sentence". Q17–Q23 are all *Name the
polygon* with the same four options, and Q45 is *what kind of triangle is this*
— identical wording in every version, a different shape drawn in each. Anything
that carries an answer from one version to another has to compare the drawing as
well as the words.

## Chapter 04

Measurement — significant figures, precision, greatest possible error, reading
a vernier caliper and a micrometer, comparing the accuracy of two measurements,
and significant-figure arithmetic. Four papers of 50 questions, lesson codes
`4-1.1` to `4-6.1`, with 50 explanation videos (every question on this sheet
carries a QR code — no exceptions, unlike Chapters 01 & 02, 03 or 12A).

The versions are **A, B, C and D**. A is the teacher-supplied original, keyed
and labeled **`original_pdf` / "Original PDF worksheet"** from the very first
build of this chapter — following the convention Chapters 01 & 02, 03 and 12A
all use for their base version, without the `version_a`-then-rename detour
Chapter 12A needed before that convention was applied to it.

### The chapter key

Its key is **`ch04`**, with no naming conflict to route around — Chapter 04 is
also the fourth chapter added to this app, so (unlike Chapter 12A and `ch12`)
there was never a clash with an older meaning of the obvious key.

### The drawings

Twenty of the fifty questions per version carry a picture:

- **32 vernier caliper / micrometer scale drawings**, one per reading question
  (Q20–Q23, Q26–Q29) per version — the worksheet's own TikZ, compiled with
  pdfLaTeX exactly as Chapter 12A's are, in `figures_ch04/`, named by a hash of
  their source. Each is stored twice from the same compile, `<hash>.svg` for
  the screen and `<hash>.pdf` for the worksheet export, for the same reason
  Chapter 12A's are: pdfLaTeX cannot read SVG at all.
- **2 shared reference photographs** — a labelled vernier caliper and a
  labelled micrometer — used by the "name the part" questions (Q18/19 and
  Q24/25). Unlike Chapter 12A's photograph, which is a different picture in
  every version, these two are the *same* picture in all four versions: they
  are reference diagrams, not randomized artwork, so there is one
  `ch04_caliper.png` and one `ch04_micrometer.png` in `images/`, not four.

### The original worksheet's answer key

The worksheet arrived with an answer key covering **versions B, C and D only**.
The original PDF worksheet had none, so every one of its 50 answers was
re-derived from the question and, where there is one, its figure — reading the
TikZ source's raw tick coordinates directly (`tools/ch04/scalereader.py`), the
same idea as Chapter 12A's `geom.py` but for scale instruments instead of
polygons.

What makes that trustworthy is that the same code, unchanged, was first run
against the three versions that *do* have a key: it reproduces **150 of 150**
of the teacher's answers, and `tools/ch04/mutate_ch04.py` shows that all 13
question families would have complained had one of those answers been wrong.
The four "name the part" questions are confirmed a second way, by elimination
against the same shared reference photo every version uses.

One reading question (a "read the vernier caliper in inches" figure) has no
visual anchor for which whole inch is meant when the window shown doesn't cross
a whole-inch mark — an irreducible ambiguity in that one generated figure, not
a gap in the derivation. It was resolved by noticing that the *same* figure's
mm scale, read the same way, gives a close cross-check once converted to
inches — and that this is exactly the trick behind one of the paper's own
decoy choices (a mm reading, mislabeled in inches) on both this question and
the one version-D question the B/C/D validation could not otherwise settle.

**If you have the original worksheet's official key, it is worth comparing.**
The derivation is careful and checked, but it is a derivation.

### Two typos in the worksheets, corrected at source

Both were in the teacher's own `.tex` files and were carried faithfully at
first. They were corrected in all four `.tex` sources on 2026-09-09 and the
question bank rebuilt from those, so the app, the worksheet export and the
LaTeX worksheets now agree. **No answer changed.**

- **Q4's lesson code** read `1-1.1` — a Chapter 1 code — in all four versions,
  though Q4 is a "how many significant digits" question sitting in the middle
  of a Q1–Q6 run that all carry `4-1.1`. Now `4-1.1` everywhere.
- **Version A's Q45** listed the same decoy twice: options A and C both read
  $206{,}700$ cm$^2$. Option C is now $200{,}000$ cm$^2$ — the
  1-significant-figure value, which is the member of the "1 / 2 / 3 significant
  figures / raw product" set that versions B, C and D all offer and A was
  missing. The answer is unchanged (option B, the 2-significant-figure
  $210{,}000$ cm$^2$), and each wrong option now models a distinct error: not
  rounding at all, over-rounding to one figure, and cutting rather than
  rounding.

`test_ch04.js` §10 now asserts both corrections rather than tolerating the
defects — it fails if either typo ever returns, which is what would happen if a
rebuild picked up an uncorrected copy of the worksheets.

### Exporting a Chapter 04 worksheet

The same two concerns as Chapter 12A's export apply here, and are covered by
the same style of check, extended to this chapter's own files
(`test_worksheet.js` §13, `test_worksheet_ui.js` §9c):

1. **The pictures go as PDF or PNG, not SVG.** The 32 scale drawings go through
   `worksheetImageSrc`'s SVG→PDF swap exactly like Chapter 12A's figures do;
   the two shared reference photos are already PNG and pass through unchanged.
2. **The ellipsis character is declared.** Chapter 04's LaTeX uses `\ldots`,
   converted to the ellipsis character at build time the same way Chapter 12A's
   ∠/∥ are — already covered by the kernel's existing Unicode declarations, so
   no new `\DeclareUnicodeCharacter` was needed for this chapter.
