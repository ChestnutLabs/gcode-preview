---
'@chestnutlabs/gcode-parser': patch
---

Moves whose stored position would overflow no longer put `Infinity` into the toolpath.

The parser already dropped a single number that is beyond float32 range (`number-out-of-range`). A value
that is in range on its own could still overflow once it was stored as a position: adding relative (`G91`)
moves together, or a far `G92` origin plus a far move, produced `Infinity` coordinates and an `Infinity`
bounding box, with no warning.

Now a segment whose start, end or extrusion amount is outside float32 range is dropped and reported with the
same `number-out-of-range` warning (counted once per file, not once per segment). The machine position keeps
advancing, so later moves that come back into range are still drawn. Ordinary files are unaffected.
