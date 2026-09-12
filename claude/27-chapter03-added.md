# Chapter 03 added to the quiz app

**Date:** 2026-08-21, videos 2026-08-22, final build `v20-ch03-final`

Chapter 03 (SI units, metric conversions, temperature, imperial/metric) as a second chapter. Four papers of 94 questions each. Plus 74 explanation-video links.

## Bugs found and fixed

1. **Diagram leak** — Chapter 03 Q7 would render Chapter 01's series circuit.
2. **Video-link leak** — flat link map keyed by question number.
3. **Pool collisions** — `pick()` used modulo, wrapping so questions were identical.
4. **Version B == original** — stride gave v=0 the original's items.
5. **Question types mixed** — Base/derived quantities.
6. **Duplicate within a paper** — `pick_avoiding` could collide.
