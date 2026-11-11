---
'@chestnutlabs/gcode-colors': patch
'@chestnutlabs/toolpath-core': patch
---

Files with a number too large for the toolpath's 32-bit channels (for example `G1 X10 F` followed by a 40-digit value) no longer break color-by-speed, color-by-power, color-by-layer-height, or the time axis.

- `@chestnutlabs/gcode-colors`: color-by-speed used to throw a `TypeError` on such a segment and paint every other segment the ramp start colour. The auto-ranges (`feedrateRange`, `toolPowerRange`, `layerHeightRange`) now skip infinite values, so the scale comes from the real values and an infinite value shows as the ramp end. A value that has no place on the ramp (NaN, or an infinite value on an infinite explicit `range`) shows the mode's `fallback`. `rampColor(ramp, NaN)` returns the ramp start instead of throwing.
- `@chestnutlabs/toolpath-core`: `computeToolpathTime` used to return `NaN` for the total and for every later segment. A segment with a non-finite length now adds 0 ms and sets `hasUnknownFeedrate` (the estimate is a lower bound).
- `@chestnutlabs/toolpath-core`: `createProgressMapper().observe(null)`, or any other value that is not an object, now returns `unavailable` with a `version-unsupported` note instead of throwing.
- `@chestnutlabs/toolpath-core`: `ToolpathIRBuilder.addRetraction` / `addColorChange` called before the first `addSegment` now store their position in the same origin-relative frame as the segments. Before, the position was offset by the first segment's start point.
