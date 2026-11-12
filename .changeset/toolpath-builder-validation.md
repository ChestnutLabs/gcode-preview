---
'@chestnutlabs/toolpath-core': patch
---

`ToolpathIRBuilder` and `createProgressMapper` now reject out-of-range input instead of storing a different value.

- **`ToolpathIRBuilder.addSegment` and `setTool` now throw a `RangeError`** that names the field and the value. Each integer channel must be an integer in its typed-array range: `kind` and `feature` 0–255, `tool` 0–65535, `layer`, `object` and `srcByte` 0–4294967295. Before, the value wrapped silently: tool `70000` was stored as `4464`, while `ir.tools` still listed `70000`. An `object` of `-1` became `4294967295`, and a `srcByte` above 4 GiB lost its high bits. Omitted optional fields still default as before.
- **Sparse layer indices are renumbered densely.** If you pass layers such as `0, 5, 9` (for example after skipping empty layers), they become `0, 1, 2`, so `segments.layer` indexes `ir.layers` again. The header gets an `info` warning, `layer-indices-densified`. Before, `layers[5]` was not layer 5, and live progress could report a `layerIndex` past the end of `ir.layers`. Dense input is unchanged and gets no warning.
- **`createProgressMapper` now throws a `RangeError` for a `staleAfterMs` or `fileSizeBytes` that is NaN, ±Infinity or negative.** Before, NaN or Infinity meant a position never went stale, and a negative value meant it was always stale. `undefined` still keeps the default. Observation content from the host is still noted and ignored, never thrown on.
