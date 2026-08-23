# @chestnutlabs/gcode-preview-svelte

## 0.5.1

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-parser@0.5.1
  - @chestnutlabs/gcode-preview-core@0.5.1
  - @chestnutlabs/gcode-renderer-three@0.5.1
  - @chestnutlabs/toolpath-core@0.5.1

## 0.5.0

### Minor Changes

- [#283](https://github.com/ChestnutLabs/gcode-preview/pull/283) [`804cafb`](https://github.com/ChestnutLabs/gcode-preview/commit/804cafb33f8f8be2617585156babf1221a856941) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Adapter surface: capabilities/warnings on `ready` + declarative `view`/`cameraState` ([#275](https://github.com/ChestnutLabs/gcode-preview/issues/275) M3+M6)

  **M3** — the `parse-complete` / `ready` event now carries `capabilities` (the per-field confidence
  map) and `warnings` alongside `{ segments, layers, complete }`, so consumers can gate their own UI on
  capability-honesty without reaching for the raw handle.

  **M6** — the `setView`/`getCameraState`/`setCameraState` methods ([#268](https://github.com/ChestnutLabs/gcode-preview/issues/268)) get first-class declarative
  props on all four adapters: a `view` prop (preset orientation) and a `cameraState` prop (restore),
  paired with a new **`camera-changed`** event (renderer → controller → adapters, emitted when a user
  camera interaction settles) so a `cameraState` binding round-trips. The 2D renderer keeps disclosing
  via `renderer-unsupported` rather than fabricating a pose. Behavioral-suite coverage added for the
  capabilities/warnings payload across all four adapters.

- [#270](https://github.com/ChestnutLabs/gcode-preview/pull/270) [`bb2af7a`](https://github.com/ChestnutLabs/gcode-preview/commit/bb2af7a4b9c433ef8caf59ecb5ece51f39a8eb9e) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Preset camera views + serializable camera state ([#268](https://github.com/ChestnutLabs/gcode-preview/issues/268))

  Adds three imperative camera methods, threaded from the renderer through `PreviewRenderer` and the
  `controls` handle into all four adapters:
  - `setView(view)` — snap to a preset orientation (`top`/`bottom`/`front`/`back`/`left`/`right`/`iso`),
    instant, preserving the active projection.
  - `getCameraState()` — read the current camera as a serializable `CameraState`
    (`{ position, target, zoom, cameraMode }`, scene coordinates); a stable contract a dashboard can
    persist.
  - `setCameraState(state)` — restore a snapshot verbatim (no re-fit to the current model).

  New public types `CameraView` and `CameraState`. No new dependency, no IR/schema change, no animation
  (snapping is instant). The low-resource 2D renderer has no 3D pose, so it honors these as documented
  disclosures (`getCameraState()` → `null`; `setView`/`setCameraState` → `renderer-unsupported`) rather
  than fabricating a pose. Covered across all four adapters by the portable behavioral suite.

### Patch Changes

- [#282](https://github.com/ChestnutLabs/gcode-preview/pull/282) [`54b54fe`](https://github.com/ChestnutLabs/gcode-preview/commit/54b54fe240e5ef7edae0e03e351127de531c5069) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Keyboard-operable camera for embedded viewers (DD-004 a11y) ([#275](https://github.com/ChestnutLabs/gcode-preview/issues/275)/M4)

  The embedded adapter canvases had `aria-label` but no `tabindex`, so they weren't focusable, and the
  renderer never enabled OrbitControls key events — only the standalone demo page was keyboard-usable.
  Now every adapter canvas is focusable (`tabindex="0"`) and the renderer enables OrbitControls keyboard
  events scoped to the canvas (arrow keys pan the view when it's focused, without hijacking the page's
  arrow keys). Keyboard operability is satisfied for embedders, not just the demo.

- [#281](https://github.com/ChestnutLabs/gcode-preview/pull/281) [`775598f`](https://github.com/ChestnutLabs/gcode-preview/commit/775598fcde26d19c72567725b7f78dd16fc14c8e) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Fix: Svelte `buildVolume` is reactive after mount (parity with Vue/React) ([#274](https://github.com/ChestnutLabs/gcode-preview/issues/274))

  The Svelte shell applied `buildVolume` once at init with no reactive statement, so changing it after
  mount was a silent no-op — a cross-adapter parity break (Vue watches it; React re-applies via
  `useEffect`). It was the only writable prop missing a `$:` wiring. Now a post-mount `buildVolume`
  change re-applies through the handle, matching the other twelve props. A source-invariant test guards
  that every writable prop stays reactively wired (the shell has no component-mount harness).

- Updated dependencies [[`804cafb`](https://github.com/ChestnutLabs/gcode-preview/commit/804cafb33f8f8be2617585156babf1221a856941), [`b671d02`](https://github.com/ChestnutLabs/gcode-preview/commit/b671d02179ba6cf30ce9888fa4b851328852e0f1), [`54b54fe`](https://github.com/ChestnutLabs/gcode-preview/commit/54b54fe240e5ef7edae0e03e351127de531c5069), [`bb2af7a`](https://github.com/ChestnutLabs/gcode-preview/commit/bb2af7a4b9c433ef8caf59ecb5ece51f39a8eb9e)]:
  - @chestnutlabs/gcode-renderer-three@0.5.0
  - @chestnutlabs/gcode-preview-core@0.5.0
  - @chestnutlabs/gcode-parser@0.5.0
  - @chestnutlabs/toolpath-core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`b2053be`](https://github.com/ChestnutLabs/gcode-preview/commit/b2053be4b8e71250bc6077f60ef996fe601b6f3e), [`5f59b77`](https://github.com/ChestnutLabs/gcode-preview/commit/5f59b7788bbb14cacfe21aaf3d7134c6ba8dcd86), [`13fd5c6`](https://github.com/ChestnutLabs/gcode-preview/commit/13fd5c61d730428a7f7e73c28cf3cc9c48e68c19), [`1029580`](https://github.com/ChestnutLabs/gcode-preview/commit/10295803839816adaed224c48eba1f74374c0c2a), [`11f317d`](https://github.com/ChestnutLabs/gcode-preview/commit/11f317de2d6cb963d2a7fb0c894c89d3d5adc86d), [`8fec7c3`](https://github.com/ChestnutLabs/gcode-preview/commit/8fec7c3622cd2a6d6d57b43d7866cfea1cb71e09), [`879b60a`](https://github.com/ChestnutLabs/gcode-preview/commit/879b60ae0fca87ca8187791603a1bc7f54e61c4c), [`b84bea9`](https://github.com/ChestnutLabs/gcode-preview/commit/b84bea959b7aae24d148e6bcc488a9ed254a54f0)]:
  - @chestnutlabs/gcode-parser@0.4.0
  - @chestnutlabs/gcode-renderer-three@0.4.0
  - @chestnutlabs/toolpath-core@0.4.0
  - @chestnutlabs/gcode-preview-core@0.4.0

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

- [#171](https://github.com/ChestnutLabs/gcode-preview/pull/171) [`1c2e5b0`](https://github.com/ChestnutLabs/gcode-preview/commit/1c2e5b031845630a6f82501de51e1ae902d52559) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add M600 filament-swap color-change annotation (E9 phase 3, [#147](https://github.com/ChestnutLabs/gcode-preview/issues/147), DD-009 D2).

  The parser now records a sparse `colorChanges` events channel on `ToolpathIR`
  (`{ x, y, z, segIndex, srcByte, tool }`, capability `colorChanges`) — `M600` is a marker with a
  position but no motion segment, captured in a side channel that leaves segment indices, scrub, and
  layer ranges untouched (mirrors the `retractions` channel from [#148](https://github.com/ChestnutLabs/gcode-preview/issues/148)). Detection lives in the parser
  (where `M600` was previously discarded as `unsupported-command`), so a bare `M600` is honored even
  when no dialect is detected. A new `colorChange` renderer color mode shades segments by **swap slot**
  (the count of color changes at or before a segment) using the existing palette-index path — not the
  `tool` channel — so multi-material prints color by active filament across manual swaps. Capability-
  gated: offered only when the IR actually carries an `M600`. Exposed through the existing `colorMode`
  option, so all adapters and `renderStill` support it with no new prop.

  DD-009 D2 was amended (maintainer-approved) to move detection from the dialect layer to the parser
  and realize the "dedicated color-change channel" as this sparse events channel.

- [#170](https://github.com/ChestnutLabs/gcode-preview/pull/170) [`d4c51a3`](https://github.com/ChestnutLabs/gcode-preview/commit/d4c51a394c1078efe959646b68f42de74e7cf4de) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add an orthographic camera option (E9 phase 2, [#150](https://github.com/ChestnutLabs/gcode-preview/issues/150), DD-009 D3).

  The renderer now carries both a perspective and an orthographic camera and switches between them with
  `setCameraMode('perspective' | 'orthographic')`, surfaced as a `cameraMode` renderer/controller option
  (default `'perspective'`), a `cameraMode` prop on the Vue, React, and Svelte adapters, and a
  `renderStill` option. Toggling preserves the view direction, target, and apparent framing — the
  orthographic frustum is sized to the same half-height the perspective view frames — and OrbitControls
  follows the active camera. Orthographic (parallel) projection suits dimensional/technical inspection.

- [#168](https://github.com/ChestnutLabs/gcode-preview/pull/168) [`11c75bd`](https://github.com/ChestnutLabs/gcode-preview/commit/11c75bd540c1490f888ec9ecee64814cafb25156) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add opt-in retraction/deretraction markers (E9 phase 1, [#148](https://github.com/ChestnutLabs/gcode-preview/issues/148), DD-009 D1).

  The parser now records a sparse `retractions` events channel on `ToolpathIR`
  (`{ x, y, z, kind, srcByte, segIndex }`, capability `retractions`) — E-only retraction moves emit no
  segment, so they are captured positionally in a side channel that leaves segment indices, scrub, and
  layer ranges untouched. The renderer draws them as opt-in always-on-top markers (warm = retract, cool
  = unretract) via `setShowRetractions`, clipped by the current layer/scrub window and shown only when
  the IR actually carries events. Exposed as a `showRetractions` prop across the Vue, React, and Svelte
  adapters (default off).

- [#173](https://github.com/ChestnutLabs/gcode-preview/pull/173) [`aceb9f2`](https://github.com/ChestnutLabs/gcode-preview/commit/aceb9f29091bec94f0de91791dd093ab0d92b834) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add a bounded declarative theming API (E9 phase 4, [#153](https://github.com/ChestnutLabs/gcode-preview/issues/153), DD-009 D4).

  A small, stable `Theme` object — `background`, `gridColor`, `bedColor`, `hemisphereIntensity`,
  `directionalIntensity`, and a `materialPreset` (`'matte'` | `'glossy'`) — surfaced as a renderer
  `theme` option + `setTheme()`, a controller `renderer.theme` option + `controls.setTheme()`, a `theme`
  prop on the Vue/React/Svelte adapters, and a `theme` option on `renderStill` (so headless thumbnails
  theme identically). The public type is three-free (`ThemeColor = number | string`) and re-exported
  through `gcode-preview-core`, so it stays valid across `three` upgrades; deep customization keeps using
  the `createRenderer` / `raw.renderer()` escape hatches.

  Additive and opt-in — the defaults reproduce the existing look exactly, and `setTheme` uses replace
  semantics (omitted fields reset to their defaults). Semantic colors (progress/retraction markers,
  overlay ghost/band, and the origin tripod) are intentionally not themeable; the material preset affects
  tube (extrude) geometry only — lines-quality geometry is unlit.

### Patch Changes

- Updated dependencies [[`1c2e5b0`](https://github.com/ChestnutLabs/gcode-preview/commit/1c2e5b031845630a6f82501de51e1ae902d52559), [`d4c51a3`](https://github.com/ChestnutLabs/gcode-preview/commit/d4c51a394c1078efe959646b68f42de74e7cf4de), [`11c75bd`](https://github.com/ChestnutLabs/gcode-preview/commit/11c75bd540c1490f888ec9ecee64814cafb25156), [`aceb9f2`](https://github.com/ChestnutLabs/gcode-preview/commit/aceb9f29091bec94f0de91791dd093ab0d92b834)]:
  - @chestnutlabs/toolpath-core@0.2.0
  - @chestnutlabs/gcode-parser@0.2.0
  - @chestnutlabs/gcode-renderer-three@0.2.0
  - @chestnutlabs/gcode-preview-core@0.2.0

## 0.1.0

### Minor Changes

- [#141](https://github.com/ChestnutLabs/gcode-preview/pull/141) [`c26879f`](https://github.com/ChestnutLabs/gcode-preview/commit/c26879f4148b77e5e9070bc2ee421a265c9571d3) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - First published line of the Chestnut Labs G-code Preview stack (`v0.1.0`, DD-008): worker-based
  `.gcode` / `.gcode.3mf` parsing into a versioned `ToolpathIR`, cross-vendor dialect annotation
  (PrusaSlicer, Orca/Bambu, Cura, Klipper, Marlin, RepRap-flavor), a Three.js renderer with layer
  clipping, scrub, tubes, build plates and the honest live-progress overlay, a framework-neutral
  preview controller, and first-class Vue/React/Svelte adapters with capability parity.

### Patch Changes

- Updated dependencies [[`c26879f`](https://github.com/ChestnutLabs/gcode-preview/commit/c26879f4148b77e5e9070bc2ee421a265c9571d3), [`ab7db35`](https://github.com/ChestnutLabs/gcode-preview/commit/ab7db35b3fcc84da3f26c4b6fe91671470df05c5)]:
  - @chestnutlabs/toolpath-core@0.1.0
  - @chestnutlabs/gcode-parser@0.1.0
  - @chestnutlabs/gcode-renderer-three@0.1.0
  - @chestnutlabs/gcode-preview-core@0.1.0
