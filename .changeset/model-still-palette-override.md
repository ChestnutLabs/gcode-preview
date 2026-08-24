---
'@chestnutlabs/gcode-model-renderer': minor
---

feat(model-renderer): optional `filamentPalette` override on `renderModelStill` / `parse3mf`

Consumers that already hold a corrected or richer filament palette (e.g. re-rendering a sliced
`.gcode.3mf`) can pass `filamentPalette` (hex `#RRGGBB` per 0-based slot) to override the palette read
from the file's `project_settings.config` when colouring `paint_color` facets. Additive and optional —
the renderer stays self-sufficient and reads the file's own palette without it. Mirrors the toolpath
renderer's `mode: 'tool'` colour seam.
