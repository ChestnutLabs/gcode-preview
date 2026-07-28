---
'@chestnutlabs/gcode-bgcode': patch
---

Add the `.bgcode` **golden-equivalence killer test** (DD-011 §D6, #188): a PrusaSlicer 2.9.6 primitive
cube, committed in both `.gcode` and `.bgcode`, is decoded and parsed, and its IR is asserted
**byte-identical** to the IR of the plain `.gcode` across every geometry channel (positions, extrusion,
kind, tool, layer). This pins decode correctness against the already-trusted plain-G-code path and
exercises the real Prusa codec stack end-to-end (heatshrink-12 + MeatPack comments/no-spaces, DEFLATE
metadata, thumbnails, per-block CRC32). Test/fixtures only — no code or public-API change.
