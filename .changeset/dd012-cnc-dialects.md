---
"@chestnutlabs/gcode-dialects": minor
"@chestnutlabs/gcode-parser": minor
---

feat: non-extrusion dialect families + validation tiers (DD-012 phase 3, #189)

Adds controller detection and the **validation-tier honesty mechanism** for CNC/laser toolpaths:

- New dialects (`@chestnutlabs/gcode-dialects`): **GRBL laser** (LightBurn / `$32` laser mode / `M4`+`S`),
  **GRBL mill** and **LinuxCNC** (`M3` spindle, `%`/banner envelopes). Registered in the batteries worker.
- Each dialect adds provenance (`cnc.controller`, `cnc.machineClass`, `cnc.toolPowerLabel`) and a
  **validation tier** (`cnc.validationTier`). Per DD-012 D6: an **experimental** dialect reports its
  non-extrusion claims (`cutMoves` / `toolPower` / `cannedCycles`) as **`inferred`** (never `known`),
  with a `cnc-dialect-experimental` disclosure — and only for claims the file actually made (an unused
  feature is never fabricated).
- **All launch dialects ship `experimental`** (synthetic fixtures only). A single `tier: 'validated'`
  flip per controller promotes its claims to `known` once confirmed on real hardware (DD-012 §8/§15).

Geometry is untouched (dialects only annotate/label). FDM detection is unaffected — CNC dialects do
not match FDM output.
