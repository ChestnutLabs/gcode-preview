---
'@chestnutlabs/gcode-model-renderer': minor
---

feat(model): decode Bambu/Orca per-object extruder colours (source-model colour convention)

`parse3mf` now renders the colour a Bambu/Orca source `.3mf` carries via its **project convention**:
per-object / per-part `<metadata key="extruder">` in `Metadata/model_settings.config` (1-based) indexing the
`filament_colour` palette in `Metadata/project_settings.config`. Each object/part with no
basematerials/colorgroup/`paint_color` colour of its own is solid-coloured by its assigned filament, and
`capabilities.materials` becomes `'known'`. A part's own extruder overrides its parent object's default.

Honesty preserved: colour is applied **only** when the source actually declares the extruder mapping AND the
palette resolves the slot — otherwise the object stays neutral (`materials: 'unavailable'`); nothing is
guessed. This fixes the "No colour data / neutral render" result on multi-part Bambu source models (e.g. the
Baby_Opossum sheet) whose colour lives in the project metadata rather than in basematerials or `paint_color`.
Validated against a real production multi-part Bambu `.3mf` (per-part extruder colours resolved correctly,
alongside parts that carry their own basematerials).
