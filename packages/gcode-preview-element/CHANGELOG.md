# @chestnutlabs/gcode-preview-element

## 0.3.0

### Minor Changes

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

- [#223](https://github.com/ChestnutLabs/gcode-preview/pull/223) [`82bd7ae`](https://github.com/ChestnutLabs/gcode-preview/commit/82bd7ae7f76e742767719d8efa11173a6548fc03) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Time-based scrub + a print-time estimate ([#181](https://github.com/ChestnutLabs/gcode-preview/issues/181)). Additive; no IR/geometry change.
  - `toolpath-core`: `computeToolpathTime(ir)` builds a cumulative **kinematic** time axis (per-segment
    length ÷ feedrate; constant-velocity, not accel-aware — a slight *under*estimate) plus
    `segmentsCompletedAtTime(cumulativeMs, ms)`. Unknown feedrates contribute 0 and flag the estimate
    approximate (`hasUnknownFeedrate`) — never a fabricated duration.
  - `gcode-preview-core`: state gains `totalTimeMs` + `timeEstimateSource` — **prefers the slicer's own
    estimate** (`DialectMetadata.printEstimate`, [#183](https://github.com/ChestnutLabs/gcode-preview/issues/183)) when present (`'slicer'`), else the kinematic
    total (`'kinematic'`). New `controls.setScrubTime(ms)` cuts the toolpath at a print time (resolves to
    a segment-index scrub).
  - Adapters (Vue/React/Svelte/Element): a `scrubTime` prop → `setScrubTime`.

- [#229](https://github.com/ChestnutLabs/gcode-preview/pull/229) [`be72283`](https://github.com/ChestnutLabs/gcode-preview/commit/be72283b20215450e8bf91b9a4eee730e98b423e) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Render slicer wipe moves as an independently toggleable layer (DD-016 phase 2, [#182](https://github.com/ChestnutLabs/gcode-preview/issues/182)).

  Phase 1 populated `MoveKind.Wipe` from `;WIPE_START`/`;WIPE_END`; this makes those moves visible
  and toggleable:
  - **renderer-three**: wipe segments build into their own `'wipe'` geometry chunk (separate from
    travel), and `setKindVisible('wipe', …)` shows/hides them. Default visible — nothing disappears
    until a consumer opts out. Wipe geometry is exempt from travel decimation (it is sparse and the
    point is to see it).
  - **core**: `setKindVisible` widens to `'extrude' | 'travel' | 'wipe'` (new `MoveKindToggle` type).
    The 2D renderer treats `'wipe'` as a documented no-op (the flat view has no distinct wipe form).
  - **adapters** (Vue/React/Svelte/Element): a `showWipe` prop / `show-wipe` attribute (default true)
    mirrors `showTravel`.

  Additive and backward-compatible; existing callers passing `'extrude'`/`'travel'` are unaffected.
  Completes [#182](https://github.com/ChestnutLabs/gcode-preview/issues/182).

### Patch Changes

- Updated dependencies [[`75f9f2b`](https://github.com/ChestnutLabs/gcode-preview/commit/75f9f2b2c758ef15b26a4b0f8dd955c89c9c5fb1), [`83f7db4`](https://github.com/ChestnutLabs/gcode-preview/commit/83f7db46be38477c4ff4127e250c6d6147c302ed), [`e8f889b`](https://github.com/ChestnutLabs/gcode-preview/commit/e8f889b576ee06da4181a048724c880ae38fedee), [`39348de`](https://github.com/ChestnutLabs/gcode-preview/commit/39348de9ce68717e71516f9acaccd475139983ba), [`5f3b16a`](https://github.com/ChestnutLabs/gcode-preview/commit/5f3b16a7aa8dfcce451d74f0cebece5f0eaaecef), [`dc1c535`](https://github.com/ChestnutLabs/gcode-preview/commit/dc1c5350ce545ae01e13c0782fed30d5d318f010), [`dc1c535`](https://github.com/ChestnutLabs/gcode-preview/commit/dc1c5350ce545ae01e13c0782fed30d5d318f010), [`17e9951`](https://github.com/ChestnutLabs/gcode-preview/commit/17e995123fa68274d508527261161741955b0647), [`bb23c90`](https://github.com/ChestnutLabs/gcode-preview/commit/bb23c901cc405ea22aad9003ccb20c7cab525490), [`ca4d9c0`](https://github.com/ChestnutLabs/gcode-preview/commit/ca4d9c0cbbec7d4edc98403f615332c2b3c34453), [`4cd453f`](https://github.com/ChestnutLabs/gcode-preview/commit/4cd453f88f3dcb012af67ee8ff30159e371fd91a), [`d161e80`](https://github.com/ChestnutLabs/gcode-preview/commit/d161e802e36cc87fa27848ceef9d68cd45628760), [`82bd7ae`](https://github.com/ChestnutLabs/gcode-preview/commit/82bd7ae7f76e742767719d8efa11173a6548fc03), [`2d2b32b`](https://github.com/ChestnutLabs/gcode-preview/commit/2d2b32b836b296f2fac460073df10a7796596e9f), [`be72283`](https://github.com/ChestnutLabs/gcode-preview/commit/be72283b20215450e8bf91b9a4eee730e98b423e)]:
  - @chestnutlabs/gcode-parser@0.3.0
  - @chestnutlabs/gcode-renderer-three@0.3.0
  - @chestnutlabs/toolpath-core@0.3.0
  - @chestnutlabs/gcode-preview-core@0.3.0

## 0.2.0

### Minor Changes

- [#175](https://github.com/ChestnutLabs/gcode-preview/pull/175) [`0dd05ca`](https://github.com/ChestnutLabs/gcode-preview/commit/0dd05caa5597d7f8f396996f033e530e7f742aeb) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add `@chestnutlabs/gcode-preview-element` — a framework-free `<gcode-preview>` Web Component over
  `gcode-preview-core` (E9 phase 5, [#149](https://github.com/ChestnutLabs/gcode-preview/issues/149), DD-009 D5).

  Attributes/properties map to the same neutral controller options and DOM `CustomEvent`s to the same
  events as the Vue/React/Svelte adapters; it passes the **shared behavioral suite** (DD-007 §4.6 parity)
  and joins the lockstep version line + pack-check/publint/attw gates + support matrix. Registration is a
  function (`defineGcodePreview()`) so the `.` entry stays side-effect-free; import
  `@chestnutlabs/gcode-preview-element/define` to auto-register. No framework peer dependency — the
  plain-HTML / Angular / vanilla path.

### Patch Changes

- Updated dependencies [[`1c2e5b0`](https://github.com/ChestnutLabs/gcode-preview/commit/1c2e5b031845630a6f82501de51e1ae902d52559), [`d4c51a3`](https://github.com/ChestnutLabs/gcode-preview/commit/d4c51a394c1078efe959646b68f42de74e7cf4de), [`11c75bd`](https://github.com/ChestnutLabs/gcode-preview/commit/11c75bd540c1490f888ec9ecee64814cafb25156), [`aceb9f2`](https://github.com/ChestnutLabs/gcode-preview/commit/aceb9f29091bec94f0de91791dd093ab0d92b834)]:
  - @chestnutlabs/toolpath-core@0.2.0
  - @chestnutlabs/gcode-parser@0.2.0
  - @chestnutlabs/gcode-renderer-three@0.2.0
  - @chestnutlabs/gcode-preview-core@0.2.0
