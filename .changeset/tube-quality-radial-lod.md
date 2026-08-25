---
'@chestnutlabs/gcode-renderer-three': minor
'@chestnutlabs/gcode-preview-core': patch
---

fix(renderer): bound tube memory by coarsening the cross-section, not by dropping segments (RR-006 correction)

The v0.10.0 tube-memory budget bounded memory by **decimating segments** (drawing every Nth). For *tubes*
that is destructive: a mesh/tube surface loses continuity when segments are dropped — each survivor becomes
a disconnected, capped stub, so a smooth wall renders as a spiky hairball (and a shape as broken blocks) on
large forced-`tubes` files. Screenshots from production confirmed it.

The correct lever, mirroring the DD-022 mesh finding, is to reduce the tube's **cross-section resolution**
(fewer sides per tube) while **keeping every segment** — the path stays continuous, the tube is just a bit
lower-poly — and fall back to flat lines only when even the minimum cross-section (3 sides) blows the
budget. New `ToolpathRendererOptions.tubeByteBudget` (default ~450 MB CPU, safe in a 2 GB cgroup) drives it;
`tubeSegmentBudget` (v0.10.0) is **deprecated** and ignored (it caused the spikes). New exports:
`tubeRadialForBudget`, `tubeSegmentBytes`, `TUBE_CPU_BYTE_BUDGET`, `MIN_RADIAL_SEGMENTS`.

Also fixes the ordinal in the decimation disclosure string ("every 3rd", not "every 3th").
