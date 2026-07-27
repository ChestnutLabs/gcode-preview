---
'@chestnutlabs/gcode-colors': minor
'@chestnutlabs/gcode-renderer-2d': minor
'@chestnutlabs/gcode-renderer-three': minor
---

E8 phase 1 (#212, DD-014): the low-resource 2D renderer's foundation — two new lockstep packages and
a boundary-preserving refactor. Additive; no IR/parser change, no change to the default (`'3d'`)
behavior or any existing public API.

- **`@chestnutlabs/gcode-colors`** (new): the renderer-agnostic home for the whole color subsystem
  (DD-014 D3). Exports the `ColorMode` union (`single`/`tool`/`feature`/`colorChange`/`feedrate`/
  `object`), `createSegmentColorer(ir, mode)` / `segmentColor`, `feedrateRange`, `rampColor`, and
  `RGB`. Depends only on `@chestnutlabs/toolpath-core` — no `three`, no framework. Every mode degrades
  unknown channel values to its fallback, never a fabricated color.
- **`@chestnutlabs/gcode-renderer-2d`** (new): an opt-in Canvas 2D current-layer renderer over the
  existing `ToolpathIR` for low-GPU / low-memory / WebGL-blocked devices (DD-014 D1/D4). `LayerView2D`
  plus the pure `drawLayer` / `computeLayerFit` / `layerBounds2D` / `rgbToCss` core. Depends only on
  `toolpath-core` + `gcode-colors` — no `three`, no framework. Memory is bounded to the active layer.
- **`@chestnutlabs/gcode-renderer-three`**: the per-segment color logic moved to `gcode-colors`;
  `colors.ts` now re-exports `ColorMode`/`RGB`/`feedrateRange` and `buildChunkColors` maps the shared
  colorer onto the Three.js vertex buffer. Public API and behavior unchanged (parity test).
