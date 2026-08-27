---
"@chestnutlabs/gcode-renderer-three": minor
---

feat(renderer): cost/capability-driven pool activation + `'auto'` single-reveal decision (DD-028 D4 / DD-029 Phase D)

Replaces the placeholder segment-count threshold with a **render-cost estimate** that scales with the
real work (ring vertices) and the detected capability (software rasterizers weighted heavier). One
estimate drives two decisions: whether the geometry worker pool is worth engaging, and whether
`progressivePreview:'auto'` takes the single-reveal `'hold'` path (expensive tube builds) or streams
`'lines'` (cheap builds, and always while parsing). Calibrated from the RR-008 Phase-0 measurements; a
relative classifier, never surfaced as a precise time.

Tuning validated (`results/dd-028-chunk-sweep-2026-08-26.md`): the renderer's existing 2048-segment
chunk target is near-optimal for the pool (**6.46×** at opossum scale on 8 cores) — small chunks keep
the memory cap generous, and large chunks degrade *gracefully* to fewer workers (never an OOM). No
re-chunking needed. `'auto'` now functionally picks `lines`/`hold`; the option default still stays
`'lines'` pending the owner's hardware human-pass.
