---
'@chestnutlabs/gcode-model-renderer': minor
'@chestnutlabs/gcode-containers': minor
---

feat(model-renderer): decode Bambu/Orca 3MF `paint_color` for production multicolor

Real designer-authored Bambu Studio / OrcaSlicer 3MF files paint per-region colour with a proprietary
`paint_color` facet attribute and keep the palette in `project_settings.config` — not in standard 3MF
materials. `parse3mf` / `renderModelStill` now decode that facet-paint format (clean-room from the
observed encoding, see RR-005) and read the `filament_colour` palette themselves, so a multicolor
source model renders in its true colours without slicing. Capability-honest: `materials: 'known'`
(or `'approximated'` when a few multi-colour facets are flattened), and still `'unavailable'` — neutral
default, never a fabricated colour — when no palette is present.

`@chestnutlabs/gcode-containers` gains an exported `filamentColoursFromSettings(settings)` helper so the
"which key is the palette" semantics live in one place, shared by the toolpath and model paths.
