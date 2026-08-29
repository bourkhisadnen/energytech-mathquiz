# EnergyTech Mathematics Quiz App — Instructor / Trainee Modes

This version separates the app into two clear interfaces:

- **Trainee Mode**
- **Instructor Mode**

It also adds instructor-created session codes, Practice Mode / Assessment Mode, compulsory answers before submission, and a Google Sheets dashboard.

## Embedded Google Apps Script URL

This version already contains the Google Apps Script Web App URL:

```text
https://script.google.com/macros/s/AKfycbw1sVWwd_TxFFFZGhwKQN9tI-l5ihSYcd2zjIQrivLBrHxVAtNmooUu_lPTAbrsE_OH/exec
```

Trainees do not need to paste the URL. They only need the quiz app link and the session code.

The URL can still be changed from the connection setup area if needed.

## Chapters

The app covers two chapters, each with four parallel papers — 832 questions in total:

| Chapter | Questions per paper | Papers |
|---|---|---|
| Chapters 01 & 02 | 114 | Original PDF worksheet, Version B, C, D |
| Chapter 03 | 94 | Original PDF worksheet, Version B, C, D |

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

### Assessment Mode

Trainees see only a submission confirmation. Detailed feedback is hidden from trainees but still saved for the instructor dashboard.

## Required answers

Trainees cannot submit until every question is answered.

If a trainee tries to submit too early, the app lists the unanswered questions and highlights them.

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

It also creates an `Instructors` sheet (if it doesn't already exist) and adds the bootstrap admin account described above. Unlike the other three sheets, `Instructors` is **never cleared** by `setup()`, so re-running `setup()` later to reset quiz results will not remove any approved colleague accounts.

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
- `start_app_windows.bat`: optional local server launcher for Windows

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
