# Instant updates and the "random" timeout box (v33)

## Two symptoms, one fault

Adnane: *"do I have to refresh the page each time I create an intake, a group or add a trainee? It should show instantly"* — plus a red box appearing apparently at random.

Both came from the same design mistake.

## Fixes

**1. Apply the change locally, reconcile in the background.** Handlers wire: add/rename/delete for intake, group and trainee.
**2. Reads get one retry.** `roster_list` and `trainee_list` pass `retries: 1`.
**3. The message was double-escaped.** Now plain text.
**4. Backend chatter cut.** `ENSURED_` remembers what has been checked.

## Tests — 340 checks

New `test_instant.js` (18): kills every `roster_list` and `trainee_list` reply and checks instant updates work correctly.

Mutation-tested: removing the `apply` call hangs it.
