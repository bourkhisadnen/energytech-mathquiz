# The instructor page: card order, and folding cards away

**Date:** 2026-09-12. Build `v58-instructor-cards` (was `v57-app-icon`).
Front-end only — `Code.gs` untouched, so no Apps Script redeploy.

Adnen: *"the instructor interface became messy after all these changes. I
suggest adding a small reversed triangle on the top right of each card to allow
minimizing it. Also the order of the cards is to be reviewed. Another thing:
showing the Instructor connection setup card on the top is no longer relevant."*

Fair. Nine cards had accumulated, and the two least-used sat above the one an
instructor opens the app to use.

## What was decided

Both the order and the fate of the connection card were **put to Adnen rather
than guessed**, since they are his workflow. He chose:

**Order** — daily work first, admin last:

| | card | note |
|---|---|---|
| 1 | Create quiz session | the reason to open the app |
| 2 | Instructor preview | appears once a paper is generated |
| 3 | Instructor dashboard | he checks results more often than individual sittings |
| 4 | My sessions | |
| 5 | Intakes, groups and trainees | |
| 6 | Instructor accounts (admin) | |
| 7 | Change my password | |
| 8 | Instructor connection setup | |

The "logged in as" bar stays above all of them and is not a card (no heading,
so it gets no fold control — the rule falls out of the implementation rather
than being special-cased).

**Connection setup: kept, moved to the bottom, folded by default** — not
deleted. Offered as three options; he took this one. The reasoning that went
with the offer: the Apps Script URL is baked into the build, so the card is
dead weight *until* the backend is redeployed to a new URL, at which point
deleting it would mean a fresh build from me just to type a URL. Folded at the
bottom costs nothing and keeps that escape hatch.

## The folding

Every card heading gained a **▾** on the right; the heading row is also a click
target, since a 22px triangle is a poor target on a tablet. State is kept per
card id in `localStorage` under `energytechPanelCollapsed_v1` and survives to
the next visit, so an instructor who only creates sessions can fold the rest
once.

### The one design decision that mattered

The fold control is built **around each existing `<h2>`, in the h2's own
position in the DOM** — not lifted to the top of its card, which is what a
first pass would naturally do and which looks tidier in the markup.

The reason is "My sessions". Its heading lives inside `#sessionsWorkspace`, a
container the app hides wholesale (`sessionsWorkspace.hidden = true`) to show a
session report. Hoisting the heading out of it would leave "My sessions" and
its triangle floating above an open report, attached to nothing.

Checked before writing any of it: the panels' internal structure was surveyed
first, and `sessionsPanel` turned out to be the only one of the six whose h2 is
nested. `test_panels.js` §6 asserts the invariant directly, and
`mutate_backend.js` now carries a mutant that makes exactly this mistake.

Also verified up front, since the change inserts a `.panel-body` wrapper into
every card: no CSS rule and no JS selector in the app depends on a direct-child
relationship inside a panel. The single `:scope >` in the codebase is inside
the question tree, well below the wrapper.

## Testing

- **`test_panels.js` — 23/23**, new: the exact card order, that the account bar
  is excluded, aria wiring, only the connection card folded on arrival, folding
  and unfolding by triangle *and* by heading, persistence across a fresh
  sign-in (including that a deliberately unfolded card is not re-folded by the
  default), the `#sessionsWorkspace` invariant, and that the connection card's
  URL field, Save button and status line all still work after the move.
- **Three new mutants** in `mutate_backend.js`, all verified to bite:
  hoisting the heading to the top of the card, dropping the persistence write,
  and clearing the collapsed-by-default list.
- Full battery: **30 suites, all green** — this change wraps the contents of
  every instructor card in a new element, so the whole battery mattered here
  rather than just the new suite.

## A note for next time

Two of the app's stored keys are read during sign-in restore
(`energytechAuthToken_v1`, `energytechAuthUser_v1`). A test that signs in,
reloads, and expects the login form will hang: the app takes the
restore-session path instead and neither the login panel nor the instructor
interface appears under a mocked backend. Clearing just those two keys between
visits is the way to simulate "same browser, next day" — that is what
`test_panels.js` §5 does.

## Still open

- The trainee interface was left alone; only `#teacherInterface` cards fold. If
  the trainee side ever grows past its current two cards, the same
  `initCollapsiblePanels()` would extend to it by changing one selector.
- `theme_color` still matches neither the icon nor the app's own `#0078b8`
  (carried over from the icon work).
