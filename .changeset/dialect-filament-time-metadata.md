---
'@chestnutlabs/toolpath-core': minor
'@chestnutlabs/gcode-dialects': minor
---

Extract **filament used + the slicer's print-time estimate** into `DialectMetadata` (#183). Two new
optional, capability-honest fields (absent when the slicer doesn't emit them):

- `filamentUsage` — total filament `lengthMm` / `volumeCm3` / `weightG`.
- `printEstimate` — the slicer's own print-time `seconds` (+ `mode` label), the trustworthy figure for
  a time readout / time scrub versus a kinematic estimate.

Parsed per-slicer from G-code comments: **PrusaSlicer** (`filament used [mm|cm3]`,
`total filament used [g]`, `estimated printing time (normal mode)`), **Orca/Bambu** (same filament
totals + `total estimated time:` / `model printing time:`), and **Cura** (`;Filament used: <m>m`,
`;TIME:<seconds>`). Additive; no IR/geometry change.
