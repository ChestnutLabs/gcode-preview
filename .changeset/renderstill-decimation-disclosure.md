---
'@chestnutlabs/gcode-preview-core': minor
---

feat(core): expose `decimationApplied` on `RenderStillResult` (honest disclosure for large tube cards)

`renderStill` now returns `decimationApplied` (1 = none, > 1 = every-Nth extrusion kept, layer boundaries
always preserved). The headless still path is where a farm renders thumbnail/cards, and the tube-segment
budget (RR-006, `gcode-renderer-three`) can now decimate a large card to bound memory — but the still
result carried no signal of it, so a card could be silently simplified. This closes that gap: a consumer
can disclose "simplified for size" on a decimated card, matching the interactive controller's existing
`state.disclosure`. Additive; small/normal renders report `decimationApplied: 1`.
