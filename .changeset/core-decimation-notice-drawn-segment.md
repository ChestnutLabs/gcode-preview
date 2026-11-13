---
'@chestnutlabs/gcode-preview-core': patch
---

The decimation notice in `state.disclosure` now says `Showing every 3rd drawn segment (layer boundaries kept); …`
instead of `… extrusion segment …`. Auto-decimation also thins CNC and laser cut moves, so "extrusion" named the
wrong move kind. If you match on the old text, match on the new one.
