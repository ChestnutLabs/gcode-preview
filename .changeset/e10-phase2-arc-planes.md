---
'@chestnutlabs/gcode-parser': minor
---

Motion-model correctness — E10 phase 2: arc-plane selection (#157, DD-010 D3).

Arc flattening (`G2`/`G3`) now runs in the **active plane** selected by `G17` (XY, default), `G18`
(XZ), or `G19` (YZ), instead of always assuming XY:

- The arc math is plane-parameterized: the in-plane pair uses the two relevant center offsets
  (`I`/`J` for XY, `I`/`K` for XZ, `J`/`K` for YZ) and the through axis ramps linearly. `G17`
  reproduces the previous XY math **exactly** — the whole XY-arc corpus is byte-identical.
- `G18`/`G19` arcs (mainly CNC) previously mis-flattened onto XY (I/J interpretation, `K` ignored);
  they now render in the correct plane.
- The deferred **G91-arc geometry** lands here too: arc endpoints honor the positioning mode
  (`G90` absolute / `G91` relative); `I`/`J`/`K` remain current-relative center offsets in both.
- New capability `arcPlanes` (`'known'` once a plane word is seen, else `'inferred'` = XY assumed).

**Output change (documented):** all corpus segment positions/kinds/extrusion stay **byte-identical**
(the only golden change is the additive `arcPlanes` capability key); non-XY arcs are new output only
for files that use `G18`/`G19`. No renderer/adapter API change.
