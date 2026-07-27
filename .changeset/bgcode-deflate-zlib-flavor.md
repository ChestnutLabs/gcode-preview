---
'@chestnutlabs/gcode-bgcode': patch
---

Fix the `.bgcode` DEFLATE flavor: it is **zlib-wrapped**, not raw (DD-011 phase 4 confirmation, #188).
Verified against a real Prusa XL `.bgcode` file — its DEFLATE-compressed Slicer/Print **metadata**
blocks decode only with the zlib header and fail as raw. (GCode blocks use heatshrink, so this was
invisible until a real file's metadata was exercised.) The decoder now uses `DecompressionStream('deflate')`,
and a flavor-lock test asserts a raw-DEFLATE block is rejected so this can't regress.
