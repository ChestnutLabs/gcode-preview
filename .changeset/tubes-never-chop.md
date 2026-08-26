---
'@chestnutlabs/gcode-renderer-three': patch
---

fix(renderer): tubes are never segment-decimated — continuous, never chopped (RR-006 / DD-023)

Tube geometry is now built with **decimation 1 regardless of policy**: `autoDecimation` drops every-Nth
extrusion segment, which for tubes leaves the survivors non-contiguous so the path-builder splits them into
disconnected capped stubs — visibly chopped tubes (the RR-006 continuity break, via the `autoDecimation`
lever that the v0.12.0 fix did not cover). Tube memory is bounded **only** by the continuity-preserving
cross-section (radial) budget; when even a 3-sided tube can't fit, the render degrades to **continuous
lines** (also undecimated) — never chopped tubes. This makes the honest degradation order full-radial tubes →
lower-radial tubes → continuous lines. On the current static budget a large forced-`tubes` file (≳ ~1.9 M
extrusion segments) now renders as continuous lines instead of chopped tubes; capability-aware budgets
(later) raise that ceiling so capable hardware renders continuous tubes. `qualityMode: 'full'` stays the
uncompromised reference (full-radial, no fallback).
