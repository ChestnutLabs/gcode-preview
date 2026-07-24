---
'@chestnutlabs/toolpath-core': minor
'@chestnutlabs/gcode-parser': minor
'@chestnutlabs/gcode-renderer-three': minor
'@chestnutlabs/gcode-preview-core': minor
'@chestnutlabs/gcode-preview-vue': minor
'@chestnutlabs/gcode-preview-react': minor
'@chestnutlabs/gcode-preview-svelte': minor
---

Add M600 filament-swap color-change annotation (E9 phase 3, #147, DD-009 D2).

The parser now records a sparse `colorChanges` events channel on `ToolpathIR`
(`{ x, y, z, segIndex, srcByte, tool }`, capability `colorChanges`) — `M600` is a marker with a
position but no motion segment, captured in a side channel that leaves segment indices, scrub, and
layer ranges untouched (mirrors the `retractions` channel from #148). Detection lives in the parser
(where `M600` was previously discarded as `unsupported-command`), so a bare `M600` is honored even
when no dialect is detected. A new `colorChange` renderer color mode shades segments by **swap slot**
(the count of color changes at or before a segment) using the existing palette-index path — not the
`tool` channel — so multi-material prints color by active filament across manual swaps. Capability-
gated: offered only when the IR actually carries an `M600`. Exposed through the existing `colorMode`
option, so all adapters and `renderStill` support it with no new prop.

DD-009 D2 was amended (maintainer-approved) to move detection from the dialect layer to the parser
and realize the "dedicated color-change channel" as this sparse events channel.
