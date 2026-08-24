# @chestnutlabs/gcode-renderer-2d

## 0.8.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.8.0
  - @chestnutlabs/toolpath-core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [[`39ede6e`](https://github.com/ChestnutLabs/gcode-preview/commit/39ede6ebc0a1ba594a391f1b33db2bdf3445d414), [`1c15c5e`](https://github.com/ChestnutLabs/gcode-preview/commit/1c15c5ea38f69aba99478cec60e4a0af28b9cae4)]:
  - @chestnutlabs/toolpath-core@0.7.0
  - @chestnutlabs/gcode-colors@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.6.0
  - @chestnutlabs/toolpath-core@0.6.0

## 0.5.2

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.5.2
  - @chestnutlabs/toolpath-core@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.5.1
  - @chestnutlabs/toolpath-core@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.5.0
  - @chestnutlabs/toolpath-core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`5f59b77`](https://github.com/ChestnutLabs/gcode-preview/commit/5f59b7788bbb14cacfe21aaf3d7134c6ba8dcd86), [`1029580`](https://github.com/ChestnutLabs/gcode-preview/commit/10295803839816adaed224c48eba1f74374c0c2a), [`8fec7c3`](https://github.com/ChestnutLabs/gcode-preview/commit/8fec7c3622cd2a6d6d57b43d7866cfea1cb71e09)]:
  - @chestnutlabs/gcode-colors@0.4.0
  - @chestnutlabs/toolpath-core@0.4.0

## 0.3.0

### Minor Changes

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

- [#218](https://github.com/ChestnutLabs/gcode-preview/pull/218) [`f1afbb2`](https://github.com/ChestnutLabs/gcode-preview/commit/f1afbb2d2b6341805f7908aed501b4892ef7bd04) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - E8 phase 2 ([#213](https://github.com/ChestnutLabs/gcode-preview/issues/213), DD-014 D2): current layer **+ adjacent "ghost" layers** in the low-resource 2D
  renderer. Additive; no other package changes.
  - `LayerView2D` gains `adjacentLayers` (default 1, floor 0) + `setAdjacentLayers(n)`: the N layers
    immediately below the active one are drawn first, dimmed (`ghostOpacity`, default 0.25), as a depth
    cue — the active layer is drawn last at full opacity, on top.
  - New pure `drawLayers(ctx, ir, opts)` orchestrates the window over `drawLayer`; `drawLayer` gains an
    `opacity` option (via `globalAlpha`) for the ghost passes.
  - The view frame is now the **whole-model XY bounds** (`modelBounds2D`, cached on `setToolpath`), so
    scrubbing layers no longer rescales or jumps and every layer shares one fit — ghosts overlay the
    active layer exactly. Per-render work stays bounded to the drawn layers.
  - Honest edges: `adjacentLayers: 0` draws the active layer only; the ghost window clamps at layer 0;
    an out-of-range active layer draws nothing (`drawn: false`).

- [#219](https://github.com/ChestnutLabs/gcode-preview/pull/219) [`bb23c90`](https://github.com/ChestnutLabs/gcode-preview/commit/bb23c901cc405ea22aad9003ccb20c7cab525490) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - E8 phase 3 ([#214](https://github.com/ChestnutLabs/gcode-preview/issues/214), DD-014 D5): select the renderer with a **`renderer: '2d' | '3d'`** prop, plus a
  live-progress marker in the 2D view. Additive; the default (`'3d'`) output is unchanged.
  - **`gcode-preview-core`**: a renderer-agnostic `PreviewRenderer` seam. `renderer.mode` (default
    `'3d'`) picks the implementation; the **3D renderer is now loaded on demand** (dynamic `import()`),
    so a `'2d'` consumer's bundle **never pulls Three.js**. New `LayerView2DRenderer` adapts the Canvas
    2D renderer to the seam. Genuine 3D-only requests on the 2D view (camera projection, quality modes)
    are disclosed via a new `renderer-unsupported` event rather than faked. The controller's renderer
    now resolves asynchronously; controls issued before it is ready are queued and replayed in order.
  - **`gcode-renderer-2d`**: a live-progress "completed cut" (DD-006) — `LayerView2D.setProgress` /
    `drawLayers({ progress })` dims the not-yet-printed extrusion of the layer currently printing.
  - **Adapters** (Vue/React/Svelte/Element): a top-level `renderer` prop (+ `adjacentLayers`) maps to
    `renderer.mode`; `raw.renderer()` now returns the neutral `PreviewRenderer`. `<GcodePreview renderer="2d" />`.

  No IR/parser change; no change to the 3D renderer's public API or output.

- [#220](https://github.com/ChestnutLabs/gcode-preview/pull/220) [`ca4d9c0`](https://github.com/ChestnutLabs/gcode-preview/commit/ca4d9c0cbbec7d4edc98403f615332c2b3c34453) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - E8 phase 4 ([#215](https://github.com/ChestnutLabs/gcode-preview/issues/215), DD-014 §6/§11) — capability honesty for the low-resource 2D view. Closes E8.
  - `gcode-renderer-2d`: `describe2DDisclosures(ir)` + `LayerView2D.getDisclosures()` return honest
    notes when the IR can't be faithfully shown as flat layers — `capabilities.layers: 'unavailable'`
    (non-planar / CNC: every move is on layer 0, so the 2D view shows them all in one flat top-down
    frame; Z variation and non-XY motion aren't represented) or `'inferred'`. Planar FDM → no note.
  - `gcode-preview-core`: `LayerView2DRenderer` emits those disclosures on `setIR` via the
    `renderer-unsupported` event, so a consumer UI is told what the flat view omits — never fabricated.

  The DD-014 §8 low-resource budget is verified on a real device (Linux/Chrome host): layer-change
  redraw ~0.2 ms median (≤ 3.6 ms even at 6× CPU throttle) vs the 16 ms budget, and ~0 MB heap growth
  over 870 renders (the 2D renderer builds no per-layer geometry). See
  `tools/benchmark/results/e8-2d-lowresource-benchmark-2026-07-26.md`.

### Patch Changes

- Updated dependencies [[`e8f889b`](https://github.com/ChestnutLabs/gcode-preview/commit/e8f889b576ee06da4181a048724c880ae38fedee), [`39348de`](https://github.com/ChestnutLabs/gcode-preview/commit/39348de9ce68717e71516f9acaccd475139983ba), [`17e9951`](https://github.com/ChestnutLabs/gcode-preview/commit/17e995123fa68274d508527261161741955b0647), [`d161e80`](https://github.com/ChestnutLabs/gcode-preview/commit/d161e802e36cc87fa27848ceef9d68cd45628760), [`82bd7ae`](https://github.com/ChestnutLabs/gcode-preview/commit/82bd7ae7f76e742767719d8efa11173a6548fc03)]:
  - @chestnutlabs/gcode-colors@0.3.0
  - @chestnutlabs/toolpath-core@0.3.0
