# One Name field instead of family + given (v34)

Adnane: *"I decided to give up using a separate family name and given name and instead use just one field for the name."* Right call — Saudi names run given-father-grandfather-family and never split cleanly in two.

## Schema change

`Trainees` went from 12 columns to 11. Everything from Intake onward shifts one column left.

## Migration

`migrateTraineeNames_()` runs from `ensureSheets_`, **before** `traineesSheet_()`. It:

1. finds `Family Name` and `Given Name` in the header; returns immediately if either is absent.
2. writes `given + ' ' + family` into the Family Name column, formatted as text first.
3. deletes the Given Name column.
4. renames the surviving column to `Name`.

## Tests — 373 checks

New `test_name_migration.js` (33): checks the join order, that every later column shifted correctly, that the pre-migration token still authenticates.

Mutation-tested three ways — all caught.
