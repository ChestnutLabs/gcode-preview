---
"@chestnutlabs/gcode-dialects": minor
---

feat(dialects): promote grbl-laser experimental → validated on hardware evidence (#189)

First hardware-validation pass (DD-012 D8): a real GRBL/LightBurn diode-laser run — 6161 moves incl.
fill + offset-fill, full 0–1000 `S` power ramp — confirmed machine-class detection, the Cut-vs-rapid
split, and the `toolPower` channel against the physical cut (all claims ✓). `grbl-laser` is flipped
`experimental → validated`: for laser files its `cutMoves`/`toolPower` claims now report **`known`**
instead of `inferred`, and the `cnc-dialect-experimental` warning is no longer emitted.

Scope is per-controller: `grbl-mill` and `linuxcnc` remain `experimental` (claims stay `inferred`)
until a run on real CNC hardware. Evidence recorded in `docs/design/DD-012-hardware-validation-log.md`.
