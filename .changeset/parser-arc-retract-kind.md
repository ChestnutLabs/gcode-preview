---
'@chestnutlabs/gcode-parser': patch
---

A G2/G3 arc with a negative `E` is no longer classified or drawn as an extrusion.

A retract during an arc (for example a wipe-with-retract) was drawn as extruded material, while the same move
written as a `G1` was already a retraction. Arcs now follow the same rule as straight moves: only a positive
`E` extrudes. A negative or zero `E` arc is a travel move (a cut move while a spindle or laser is engaged).
Its `E` value is kept on the segments.

You will only see a difference on files that retract mid-arc. In the bundled corpus that is `demo-plant-sign`
(689 arc segments) and `demo-screw` (2022 arc segments); their arc segments change from extrude to travel.
