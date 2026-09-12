# Question selection tree + free question count

**Date:** 2026-08-22 · build `v22-naming-layout`

## What changed

A quiz is no longer "one paper". The instructor now ticks an arbitrary set of questions from a Chapter → Version → Lesson → Question tree.

## Selection model

State: `selection = { "<chapter>:<set>": Set(originalNumbers) }`.

Encoded into the **existing** `questionSetKey` field — no Google Sheet column, no Apps Script redeploy.

## Tests

All 8 papers: render, 4 choices each, scoring works, diagrams and videos correct.
