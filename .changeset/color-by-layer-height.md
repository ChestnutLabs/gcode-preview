---
'@chestnutlabs/gcode-colors': minor
'@chestnutlabs/gcode-renderer-three': minor
---

Add a **color-by-layer-height** mode (#179) — the Orca/Bambu view that reveals variable-layer-height
prints.

- `gcode-colors`: new `ColorMode` variant `{ mode: 'layerHeight'; ramp; range?; fallback }`, plus
  `layerHeights(ir)` (per-layer Z-delta; layer 0 is its thickness from the bed; negative deltas clamp
  to 0) and `layerHeightRange(ir)` (the auto-range). Each segment is colored by its layer's height
  mapped onto the ramp. Derived purely from `ir.layers` — no new parsing.
- `gcode-renderer-three`: re-exports `layerHeightRange`, and `isColorModeAvailable('layerHeight')` is
  **capability-gated on `layers`** — a non-planar/CNC IR (`layers: 'unavailable'`) reports the mode
  unavailable rather than collapsing every segment to one flat color.

Additive; works through the existing rich `colorMode` prop on every adapter with no adapter change.
