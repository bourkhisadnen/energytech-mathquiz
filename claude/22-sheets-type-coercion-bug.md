# Sheets converted MAY26 into a date (v31)

## Symptom

Adnane added an intake labelled `MAY26`. It saved, but the list showed `Tue May 26 2026 00:00:00`.

## Cause

Google Sheets coerces values on write. A string that looks like a date is converted unless the cell is already formatted as plain text (`@`).

## Fix

Four helpers in `Code.gs` — that set `setNumberFormat('@')` on the text columns **before** writing.

## The harness gap this exposed

`gas_stub.js` stored strings verbatim, so no Node suite could have caught this. It now models the coercion.

## Tests

`test_coercion.js` (23 checks) covers month-like labels, leading-zero IDs, and attempts.
