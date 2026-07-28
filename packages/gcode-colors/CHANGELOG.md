# @chestnutlabs/gcode-colors

## 0.3.0

### Minor Changes

- [#230](https://github.com/ChestnutLabs/gcode-preview/pull/230) [`e8f889b`](https://github.com/ChestnutLabs/gcode-preview/commit/e8f889b576ee06da4181a048724c880ae38fedee) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add a **color-by-layer-height** mode ([#179](https://github.com/ChestnutLabs/gcode-preview/issues/179)) — the Orca/Bambu view that reveals variable-layer-height
  prints.
  - `gcode-colors`: new `ColorMode` variant `{ mode: 'layerHeight'; ramp; range?; fallback }`, plus
    `layerHeights(ir)` (per-layer Z-delta; layer 0 is its thickness from the bed; negative deltas clamp
    to 0) and `layerHeightRange(ir)` (the auto-range). Each segment is colored by its layer's height
    mapped onto the ramp. Derived purely from `ir.layers` — no new parsing.
  - `gcode-renderer-three`: re-exports `layerHeightRange`, and `isColorModeAvailable('layerHeight')` is
    **capability-gated on `layers`** — a non-planar/CNC IR (`layers: 'unavailable'`) reports the mode
    unavailable rather than collapsing every segment to one flat color.

  Additive; works through the existing rich `colorMode` prop on every adapter with no adapter change.

- [#217](https://github.com/ChestnutLabs/gcode-preview/pull/217) [`17e9951`](https://github.com/ChestnutLabs/gcode-preview/commit/17e995123fa68274d508527261161741955b0647) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - E8 phase 1 ([#212](https://github.com/ChestnutLabs/gcode-preview/issues/212), DD-014): the low-resource 2D renderer's foundation — two new lockstep packages and
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

### Patch Changes

- Updated dependencies [[`39348de`](https://github.com/ChestnutLabs/gcode-preview/commit/39348de9ce68717e71516f9acaccd475139983ba), [`d161e80`](https://github.com/ChestnutLabs/gcode-preview/commit/d161e802e36cc87fa27848ceef9d68cd45628760), [`82bd7ae`](https://github.com/ChestnutLabs/gcode-preview/commit/82bd7ae7f76e742767719d8efa11173a6548fc03)]:
  - @chestnutlabs/toolpath-core@0.3.0
