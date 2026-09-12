# The Attempts sheet wipe — cause, recovery, prevention

## What happened

Running the `setup()` function in Apps Script cleared every trainee attempt from the
spreadsheet.

This was not a misuse. `setup()` in `Code.gs` (up to and including v45) did this:

```js
let attempts = ss.getSheetByName(SHEET_ATTEMPTS);
if (!attempts) attempts = ss.insertSheet(SHEET_ATTEMPTS);
attempts.clear();                       // <- every recorded attempt, gone
attempts.appendRow([ ...headers... ]);
```

The same three lines for `Sessions` and `ItemResponses`. Only `Instructors` was spared.

Pressing **Run** in the Apps Script editor is the normal way to confirm a deployment is
alive after pasting a new `Code.gs`, and the README actively described re-running `setup()`
as the way to "reset quiz results". So the destructive path was both the obvious one and
the documented one.

## Recovery

The data is not recoverable from the script — `clear()` is not undoable from Apps Script,
and the backend keeps no journal. Recovery is from a copy of the spreadsheet. Adnen had
one.

Order of preference:

1. **The copy of the spreadsheet.** Open both, and paste the rows from the copy's
   `Attempts` and `ItemResponses` back beneath the header rows in the live sheet. Paste
   **values only** so nothing is re-coerced. Match the column order — `Attempts` has 24
   columns, `ItemResponses` 19; the header rows in both files should be identical.
2. **Google Sheets version history** — File → Version history → See version history. Sheets
   keeps named and automatic versions for a long time. Find a version timestamped before
   the `setup()` run and either restore it wholesale or copy the rows out of it. This works
   even without a manual copy and is worth checking first, since it restores the exact
   prior state.
3. **Drive trash / "Manage versions"** — only relevant if the file itself was replaced
   rather than edited in place. Not the case here.

Two things to check after pasting rows back:

- **`Attempts` column 22 (Intake) and the ID column** must stay text. If the paste
  re-coerces `JAN26` into a date or strips a leading zero from an EnergyTech ID, the
  history and report lookups stop matching. Format the target columns as **Plain text**
  (Format → Number → Plain text) *before* pasting — reformatting afterwards does not give
  the original text back.
- Re-open a report or a trainee profile afterwards to confirm the rows are being read.

## Prevention (shipped in v46)

- `setup()` no longer clears anything. It creates a sheet if missing, writes the header row
  only into an empty sheet, and leaves existing rows alone. It is safe to run repeatedly
  against a live spreadsheet.
- Erasing moved to `eraseAllRecords_()`, which refuses to run until `CONFIRM_ERASE` at the
  top of `Code.gs` is set to `ERASE EVERYTHING`. It is not reachable over the web and
  nothing in the app calls it.
- `test_report.js` asserts that repeated `setup()` runs leave the records untouched, and a
  mutation that restores the old clearing behaviour is part of the mutation suite — so this
  cannot come back silently.
- README section 3 rewritten, with the old behaviour called out for anyone upgrading.

## Standing advice

Take a copy of the spreadsheet before pasting any new `Code.gs`. Not because the current
version is dangerous, but because a copy is the only thing that would have helped here, and
it costs one menu click.
