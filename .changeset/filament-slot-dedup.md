---
'@chestnutlabs/gcode-parser': patch
---

fix(parser): dedupe `metadata.filaments` by slot when a `.gcode.3mf` declares filaments twice

A sliced `.gcode.3mf` carries its filament palette in two places — the dialect reads it from the
G-code `; filament_colour` / `; filament_type` comments, and the container reads it from
`project_settings.config`. The worker was **concatenating** the two, emitting each slot twice
(`[0,0,1,1,…]`, e.g. 8 entries for a 4-colour file). That broke consumers building a palette indexed by
tool/slot (colours after the first N appeared to vanish). The two sources are now merged **by slot**
(container config authoritative per field), so `metadata.filaments` has exactly one entry per slot.
