---
'@chestnutlabs/gcode-colors': minor
'@chestnutlabs/gcode-preview-core': minor
---

feat(color): `filament` colour mode — render a toolpath in the file's own filament colours (DD-024)

Adds a `{ mode: 'filament' }` colour mode: colour a toolpath by the source's OWN filament colours
(`metadata.filaments[].color`, from the g-code header / slicer metadata), so a consumer needn't extract and
re-supply a palette gcode-preview already knows. Because those colours live in parse **metadata** (not the
IR), the `gcode-preview-core` controller resolves the mode against each file's metadata **before the build** —
multi-extruder files colour by tool, colour-change (M600) files by swap slot — so the **first visible pass is
already coloured**, eliminating the neutral-then-recolour flash on raw `.gcode`. Honesty preserved: with no
usable filament colours the render stays neutral (never a fabricated palette); the mode reaching the IR-only
colorer unresolved is likewise honestly neutral. Fixes the raw-g-code (e.g. Dune Striker) colour flash
renderer-side, no consumer palette extraction required.
