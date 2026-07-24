---
'@chestnutlabs/toolpath-core': minor
'@chestnutlabs/gcode-parser': minor
'@chestnutlabs/gcode-renderer-three': minor
'@chestnutlabs/gcode-preview-core': minor
'@chestnutlabs/gcode-preview-vue': minor
'@chestnutlabs/gcode-preview-react': minor
'@chestnutlabs/gcode-preview-svelte': minor
---

Add opt-in retraction/deretraction markers (E9 phase 1, #148, DD-009 D1).

The parser now records a sparse `retractions` events channel on `ToolpathIR`
(`{ x, y, z, kind, srcByte, segIndex }`, capability `retractions`) — E-only retraction moves emit no
segment, so they are captured positionally in a side channel that leaves segment indices, scrub, and
layer ranges untouched. The renderer draws them as opt-in always-on-top markers (warm = retract, cool
= unretract) via `setShowRetractions`, clipped by the current layer/scrub window and shown only when
the IR actually carries events. Exposed as a `showRetractions` prop across the Vue, React, and Svelte
adapters (default off).
