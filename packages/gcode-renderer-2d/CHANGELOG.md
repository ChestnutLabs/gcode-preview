# @chestnutlabs/gcode-renderer-2d

## 0.24.0

### Minor Changes

- [#604](https://github.com/ChestnutLabs/gcode-preview/pull/604) [`ffd8ce7`](https://github.com/ChestnutLabs/gcode-preview/commit/ffd8ce785489292791ea031b16d8f591e3461e7b) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - The 2D view now draws CNC and laser Cut moves. A CNC file used to show nothing in 2D with travel hidden.
  - **Drawing:** Cut moves are drawn with the extrusion, in file order, coloured by the same colour mode (`moveKind`
    gives them the cut colour). Ghost layers and the live-progress dimming include them.
  - **New toggle:** `cut` on `drawLayer`, `drawLayers` and `LayerView2D` options (default `true`), and
    `LayerView2D.setCut(visible)`. On `GcodePreview` with `renderer="2d"`, `setKindVisible('cut', visible)` and
    `showCut` / `show-cut` now take effect.
  - **Counts:** the draw results gain `cutDrawn`. A move that is both an extrusion and a cut counts once, as
    extrusion. `summarize2DDrawable` and the 2D `build-complete` segment count include Cut moves.
  - FDM files have no Cut moves and draw exactly as before (pinned by draw-stream digests of four real files).

### Patch Changes

- [#554](https://github.com/ChestnutLabs/gcode-preview/pull/554) [`c0c799a`](https://github.com/ChestnutLabs/gcode-preview/commit/c0c799a6f5f24fd309cf9ac9a1c59da73c6f679f) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - The 2D view no longer goes blank when you clear the layer range. With `renderer: '2d'`, setting
  `layerRange` back to `null` (React, Vue, Svelte) or removing the `<gcode-preview>` layer-range attribute
  after a file had loaded left an empty canvas. It now shows the top layer, as the 3D view does.
  - **Layer requests:** `setLayerRange(start, end)` in 2D shows layer `end`, now floored (a slider value of
    `2.5` shows layer 2). An `end` past the last layer, `Infinity` included, shows the top layer, and it
    stays the top layer when you load a file with more layers. A `NaN` end is ignored. `LayerView2D.setLayer`
    behaves the same way.
  - **Option checks:** `LayerView2D` and the core `LayerView2DRenderer` now throw a `RangeError` for
    `adjacentLayers: NaN`, a `ghostOpacity` outside `[0, 1]` or `NaN`, and a `lineWidth` that isn't a finite
    number above 0. `LayerView2D` also rejects a negative or non-finite `padding`, and `setAdjacentLayers(NaN)`
    throws with the previous count kept. Before, these drew wrongly with no error (a `NaN` opacity drew the
    ghost layers at full strength). Through the core controller, a bad `adjacentLayers` or `ghostOpacity`
    throws from `bindCanvas`. On `<gcode-preview renderer="2d">` a non-numeric `adjacent-layers` attribute is
    bad markup: it is ignored (one ghost layer, the default) and the element still draws.
  - **Travel toggle:** turning travel back on in 2D keeps the travel style you gave the renderer, instead of
    switching to the default grey.
  - **After `dispose()`:** the 2D renderer no longer draws, matching the 3D renderer. A size that is `NaN`,
    infinite or below 1 is clamped to 1 pixel instead of emptying the canvas.
  - **Core `testing.ts`:** `AdapterHarness.create` accepts an optional `renderer: '2d'`. One new behavioral
    case runs the layer-range clip-and-restore check on 2D, and `installSuite2DProbe()` gives a DOM shim such
    as happy-dom a recording Canvas 2D context. A harness that ignores `renderer: '2d'` fails the case with an
    explicit message.

- Updated dependencies [[`1ff1bbf`](https://github.com/ChestnutLabs/gcode-preview/commit/1ff1bbf7cc39b2faf9b21ecd25fac56d1b82b8bf), [`b0b1922`](https://github.com/ChestnutLabs/gcode-preview/commit/b0b1922ce7a4f3c3f3952185d1fdd47fcc115480), [`eb6b74c`](https://github.com/ChestnutLabs/gcode-preview/commit/eb6b74c0f9a8a7b0e28060d672d1021dab2a63d5), [`6b03f42`](https://github.com/ChestnutLabs/gcode-preview/commit/6b03f4221e5f0a552959fbed7f85124203d42f57)]:
  - @chestnutlabs/gcode-colors@0.24.0
  - @chestnutlabs/toolpath-core@0.24.0

## 0.23.0

### Minor Changes

- [#539](https://github.com/ChestnutLabs/gcode-preview/pull/539) [`d0c3fcc`](https://github.com/ChestnutLabs/gcode-preview/commit/d0c3fcc59e7973bcb0d39ba2278f830daa02fedd) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Colour modes now reject options that have no meaning, and a hostile file can no longer distort or break colouring.
  - **Bad colour options throw a `RangeError` when you set them.** In `feedrate`, `layerHeight` and `power`
    mode, an explicit `range` must be two finite numbers `>= 0`, in ascending order. An inverted range such as
    `[2000, 1000]` now throws; for a reversed scale, reverse the `ramp` instead. In `object` mode, `only` must
    be a 1-based integer. Before, `range: [0, NaN]` or `only: 0` silently painted every segment one colour. A
    point range such as `[1500, 1500]` is still valid and paints every segment the ramp's first colour.
  - **Where it throws.** `controls.setColorMode(mode)` (in Vue, React, Svelte and the Web Component too) and
    the `colorMode` option throw synchronously, before anything is stored, so the previous mode stays in
    effect, even if the call comes before the viewer has loaded. The same goes for `LayerView2D`'s constructor
    and `setColorMode`, and for `createSegmentColorer`. To validate a mode built from user input yourself,
    call the new `checkColorMode(mode)`. It's exported from `@chestnutlabs/gcode-colors` and
    `@chestnutlabs/gcode-renderer-2d`.
  - **`segmentColor(ir, mode, i)` throws a `RangeError` for an index outside `[0, segments.count)`.** It used
    to return `undefined`. The per-segment function returned by `createSegmentColorer` is unchanged.
  - **A negative `F` or `S` in the file is drawn in `fallback`.** It is also left out of the auto-range, like
    NaN and Infinity already were, so one hostile `G1 F-99999` can no longer stretch the speed scale and wash
    out every other segment.
  - **`filament` colour mode ignores impossible filament slots.** A slot from file metadata that is not an
    integer from 0 to 63 is dropped. Before, a fractional slot threw while the palette was built. Gaps in the
    palette now use your `fallback`, not always the default grey.
  - **`filament` colour mode no longer borrows colours.** When a file uses a tool or a colour-change slot that
    it declared no filament colour for, those segments are drawn in `fallback`. Before, the palette wrapped,
    so `T3` in a file with two filament colours was drawn in the second filament's colour.

### Patch Changes

- [#523](https://github.com/ChestnutLabs/gcode-preview/pull/523) [`3ae53e9`](https://github.com/ChestnutLabs/gcode-preview/commit/3ae53e9cf687e62f0a4c2bfeee0900fb5a56d76c) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Segments skipped for an `Infinity` or `NaN` coordinate are now disclosed, in 2D and 3D ([#518](https://github.com/ChestnutLabs/gcode-preview/issues/518)).
  - **The `disclosure` text names the count.** When a toolpath you build yourself has segments with a
    non-finite coordinate, the renderer skips them. `GcodePreviewState.disclosure` and the `disclosure`
    callback in Vue, React, Svelte and the Web Component now say so, for example
    `3 segments with a non-finite coordinate were not drawn.` (`1 segment … was not drawn.` for one). When
    decimation also applies, the sentence follows the decimation sentence. The 2D view checks x and y over
    extrusion and travel. The 3D renderer checks x, y and z over every segment it builds. Both count the
    whole toolpath, travel included whether or not it is shown.
  - **2D mode now fires `build-complete`.** With `renderer: '2d'`, the 2D view emits `buildComplete` once
    each time a toolpath loads: the number of drawable segments, `decimationApplied: 1`,
    `travelHidden: false`, `quality: 'lines'`. It fires after parse-complete, as in 3D, so a
    build-complete handler reads the new file's `layerCount` and `segmentCount`. Before, it never fired in 2D, so `onBuildComplete` and
    `onDisclosure` (and their Vue, Svelte and Web Component equivalents) stayed silent. `activeQuality`
    now reads `'lines'` after a 2D load instead of `null`.
  - **`gcode-renderer-three`:** the `buildComplete` event carries an optional `skippedNonFinite` count.
  - **`gcode-renderer-2d`:** new `summarize2DDrawable(ir)` returns `{ drawable, skippedNonFinite }` for
    the whole toolpath.
  - **`gcode-preview-core/testing`:** `SuiteStubWorker` takes an optional IR factory, `makeNonFiniteTestIR()`
    is exported, and `ComponentHarness.mount` takes `{ renderer, ir }` and an `onReady` callback.
    `MountedComponent` gains `parse()`.
    The component conformance suite adds a 2D case and a 3D case.

- [#516](https://github.com/ChestnutLabs/gcode-preview/pull/516) [`b827e7f`](https://github.com/ChestnutLabs/gcode-preview/commit/b827e7fe87c2fcd5d636617090e4c58de09b57e0) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - The 2D layer view now copes with bad coordinates and bad layer tables in a toolpath you build
  yourself.
  - **One `Infinity` or `NaN` X/Y coordinate no longer blanks the view.** Before, a single non-finite
    coordinate made the whole-model frame infinite, so every line was drawn at `NaN` pixels and the
    canvas stayed empty. Now a segment with a non-finite X/Y endpoint is skipped: it is not drawn and
    it does not affect the frame. `drawLayer` and `drawLayers` report how many segments were skipped
    in a new `skippedNonFinite` field (also on `LayerView2D.render()`'s result).
  - **`computeLayerFit` always returns a finite projection.** Bounds with an `Infinity` or `NaN` edge
    are treated as empty (scale 1, centred). A `NaN` width, height or padding is treated as 0.
  - **A layer with a negative `segStart` no longer hangs the draw.** The range is clamped to the
    segment table. Before, a value such as `-1e15` looped for a very long time.
  - **`rgbToCss` maps a `NaN` channel to 0.** Before, it produced `rgb(NaN, …)`. That is invalid CSS,
    so the canvas ignored it and drew the line in the previous line's color.

  Parsed files are not affected unless they hit these cases. The parser already drops number words
  that overflow, with a `number-out-of-range` warning.

- Updated dependencies [[`d0c3fcc`](https://github.com/ChestnutLabs/gcode-preview/commit/d0c3fcc59e7973bcb0d39ba2278f830daa02fedd), [`4d08cbc`](https://github.com/ChestnutLabs/gcode-preview/commit/4d08cbc86aa1672ebea6f9d312b376699db5ecf1)]:
  - @chestnutlabs/gcode-colors@0.23.0
  - @chestnutlabs/toolpath-core@0.23.0

## 0.22.0

### Patch Changes

- Updated dependencies [[`3fe25f4`](https://github.com/ChestnutLabs/gcode-preview/commit/3fe25f4d8d66ab1f37d23892365fb33d2c813ff6)]:
  - @chestnutlabs/gcode-colors@0.22.0
  - @chestnutlabs/toolpath-core@0.22.0

## 0.21.2

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.21.2
  - @chestnutlabs/toolpath-core@0.21.2

## 0.21.1

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.21.1
  - @chestnutlabs/toolpath-core@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.21.0
  - @chestnutlabs/toolpath-core@0.21.0

## 0.20.1

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.20.1
  - @chestnutlabs/toolpath-core@0.20.1

## 0.20.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.20.0
  - @chestnutlabs/toolpath-core@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [[`81690dc`](https://github.com/ChestnutLabs/gcode-preview/commit/81690dcfece21d6fd11074ad7a264bcfc9edf455)]:
  - @chestnutlabs/toolpath-core@0.19.0
  - @chestnutlabs/gcode-colors@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.18.0
  - @chestnutlabs/toolpath-core@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies [[`214b0db`](https://github.com/ChestnutLabs/gcode-preview/commit/214b0db2dd9d8aa177d80969bdb59173d33121a3)]:
  - @chestnutlabs/toolpath-core@0.17.0
  - @chestnutlabs/gcode-colors@0.17.0

## 0.16.0

### Patch Changes

- Updated dependencies [[`bf032d2`](https://github.com/ChestnutLabs/gcode-preview/commit/bf032d2b4e0ce36dcbd8020caead2a512ca3b618)]:
  - @chestnutlabs/toolpath-core@0.16.0
  - @chestnutlabs/gcode-colors@0.16.0

## 0.15.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.15.0
  - @chestnutlabs/toolpath-core@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.14.0
  - @chestnutlabs/toolpath-core@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [[`f14849d`](https://github.com/ChestnutLabs/gcode-preview/commit/f14849d5f88eb9957a75bccf2f14da75ebb44a4e)]:
  - @chestnutlabs/gcode-colors@0.13.0
  - @chestnutlabs/toolpath-core@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.12.0
  - @chestnutlabs/toolpath-core@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.11.0
  - @chestnutlabs/toolpath-core@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.10.0
  - @chestnutlabs/toolpath-core@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.9.0
  - @chestnutlabs/toolpath-core@0.9.0

## 0.8.1

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.8.1
  - @chestnutlabs/toolpath-core@0.8.1

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
