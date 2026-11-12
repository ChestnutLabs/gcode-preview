---
'@chestnutlabs/gcode-model-renderer': patch
---

Model files with non-finite geometry now fail the load with `E_MODEL_PARSE` instead of rendering as `NaN`/`Infinity` positions and bounds.

- **3MF.** A vertex coordinate that is `NaN`, `Infinity`, `1e999` or beyond float32 range (`1e300`) rejects, as does
  a `transform` (build item or component) with such an entry. A coordinate that only overflows after the
  `unit` scale (meters to mm), component transforms whose product overflows, and a transformed box that
  overflows also reject. A triangle index that is negative, fractional, not a number, missing, or points past
  the mesh's last vertex rejects (it used to be truncated or read as a `NaN` position). The message names the
  vertex, transform entry or triangle. A `transform` that is not 12 numbers is still read as identity, and an
  absent vertex coordinate is still 0.
- **STL.** A binary or ASCII STL with a `NaN`, infinite or float32-overflowing vertex rejects, naming the vertex.
  Before, an all-`NaN` STL loaded with `NaN` bounds. There is no partial load: dropping triangles silently
  would show a different model, and the model renderer has no warnings channel.
- **Scene bounds.** `bounds` that are not finite float32 numbers reject at the one place every source passes
  through: a pre-built `ModelScene`, a registered custom loader's result, and `renderModelStill`. Fit and
  plate placement therefore never see a `NaN` box.

**Files that used to load and now reject:** 3MFs with an out-of-range or non-integer triangle index and STLs with
`NaN`/`Infinity` coordinates. Both rendered corrupt geometry before.
