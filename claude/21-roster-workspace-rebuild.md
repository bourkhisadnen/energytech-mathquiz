# Roster workspace rebuild (v32)

## Why

Adnane: *"after creating an intake, the user is given the possibility to create groups. but then there seems to be no way to add trainees to the groups…"*

Screenshotting showed why: the panel was **2,101px tall**, the "Trainees" button existed but was clickable ~1,500px further down.

## Decisions taken with Adnane

1. **Three columns, drill down** — intakes → groups → trainees.
2. **One CSV per intake with a group column**.
3. Daily needs named: look up one trainee, see who has no login yet, move people between groups.

## Backend (`Code.gs`)

- `traineeImport_` rewritten: validates every group name before creating any of them.
- `traineeMove_` added (`trainee_move`): bulk, comma-separated `ids`.

## Result

Same data, same viewport: **2,101px → 883px**.
