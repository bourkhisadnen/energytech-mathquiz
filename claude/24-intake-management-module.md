# Intake management module — build notes

Build: `v29-intakes`.

## What was built

An intake is a label (e.g. `JAN26`) holding groups `G1`–`G20`, each group holding trainees.

## Decisions

- Trainees request their own account with their EnergyTech ID + a password.
- Activation is automatic (being on a roster is the authorisation).
- CSV import goes into a chosen group, with a preview.
- Deleting is blocked with an explanation.

## Tests (in `/tmp/energytech_app`, not shipped) — 253 checks

- `gas_stub.js`, `test_backend.js` (85), `test_compat.js` (39), `test_roster.js` (57), `test_papers.js` (60), `test_subpath.js` (12).
