---
'@chestnutlabs/toolpath-core': minor
'@chestnutlabs/gcode-preview-core': minor
'@chestnutlabs/gcode-preview-vue': minor
'@chestnutlabs/gcode-preview-react': minor
'@chestnutlabs/gcode-preview-svelte': minor
'@chestnutlabs/gcode-preview-element': minor
---

Time-based scrub + a print-time estimate (#181). Additive; no IR/geometry change.

- `toolpath-core`: `computeToolpathTime(ir)` builds a cumulative **kinematic** time axis (per-segment
  length ÷ feedrate; constant-velocity, not accel-aware — a slight *under*estimate) plus
  `segmentsCompletedAtTime(cumulativeMs, ms)`. Unknown feedrates contribute 0 and flag the estimate
  approximate (`hasUnknownFeedrate`) — never a fabricated duration.
- `gcode-preview-core`: state gains `totalTimeMs` + `timeEstimateSource` — **prefers the slicer's own
  estimate** (`DialectMetadata.printEstimate`, #183) when present (`'slicer'`), else the kinematic
  total (`'kinematic'`). New `controls.setScrubTime(ms)` cuts the toolpath at a print time (resolves to
  a segment-index scrub).
- Adapters (Vue/React/Svelte/Element): a `scrubTime` prop → `setScrubTime`.
