---
"@chestnutlabs/gcode-parser": patch
---

fix: G0 rapids classify as Travel, not Cut, even while the tool is engaged (#189)

The non-extrusion `Cut`/`Travel` classifier keyed only on tool-state (`M3`/`M4` latched), so on a
router — where the spindle stays on across rapids — every `G0` reposition was counted as a cutting
move. DD-012 D2 §4.2 already specifies that rapids stay `Travel`; this brings the implementation in
line: only a **feed** move (`G1`/`G2`/`G3`) with the tool engaged and no `E` delta is `Cut`; a `G0`
rapid is `Travel` regardless of tool state (a GRBL-laser also gates the beam off during `G0`).

Surfaced by the CNC/laser validation harness on real files — e.g. the `easel` router fixture went
from 742 cut / 0 rapids to a correct 737 cut / 5 rapids (its 5 `G0` moves). Geometry is unchanged
(only the `kind` column shifts); FDM output is byte-identical since `Cut` is never evaluated there.
