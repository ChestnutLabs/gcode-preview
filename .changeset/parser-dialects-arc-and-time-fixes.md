---
'@chestnutlabs/gcode-parser': patch
'@chestnutlabs/gcode-dialects': patch
---

Toolpath and metadata fixes found by a mutation-testing sweep:

- **Helical arcs** (a `G2`/`G3` that also moves the third axis, e.g. `G2 X10 Y0 Z5 I5 J0`) now ramp from the start height toward the target. They used to ramp the other way and jump back to the target on the last segment. Flat arcs are unchanged.
- **Negative-radius arcs** (`G2 X10 Y0 R-8`) now take the long way round (more than 180°), as the G-code standard specifies. They used to be drawn as a half circle.
- A parse limit passed as `undefined` (for example `limits: { maxProgramIterations: undefined }`) now keeps its default. It used to switch that limit off, so a looping RS274NGC program could run forever.
- A single coordinate, `E`, `F` or `S` word that is a valid number but too large for the toolpath to store (for example 40 nines) is now dropped with a `number-out-of-range` warning. It used to become Infinity in the segments and the bounds, with no warning.
- A line with many malformed `[...]` expressions no longer makes the valid expressions after it on that line fail.
- **Print-time estimates**: Bambu Studio files, and OrcaSlicer files for any printer profile, now report their estimate. Bambu Studio, and OrcaSlicer with Bambu printer profiles, put both times on one header line (`; model printing time: …; total estimated time: …`), and that line was skipped. OrcaSlicer with other printers writes `; estimated printing time (normal mode) = …`, which was not read for Orca files. Estimates of a day or more (`1d 2h 3m 4s`) are now read for PrusaSlicer and OrcaSlicer too; they used to be dropped.
