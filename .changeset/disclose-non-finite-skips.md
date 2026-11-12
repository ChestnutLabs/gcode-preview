---
'@chestnutlabs/gcode-preview-core': minor
'@chestnutlabs/gcode-renderer-three': patch
'@chestnutlabs/gcode-renderer-2d': patch
---

Segments skipped for an `Infinity` or `NaN` coordinate are now disclosed, in 2D and 3D (#518).

- **The `disclosure` text names the count.** When a toolpath you build yourself has segments with a
  non-finite coordinate, the renderer skips them. `GcodePreviewState.disclosure` and the `disclosure`
  callback in Vue, React, Svelte and the Web Component now say so, for example
  `3 segments with a non-finite coordinate were not drawn.` (`1 segment … was not drawn.` for one). When
  decimation also applies, the sentence follows the decimation sentence. The 2D view checks x and y over
  extrusion and travel. The 3D renderer checks x, y and z over every segment it builds. Both count the
  whole toolpath, travel included whether or not it is shown.
- **2D mode now fires `build-complete`.** With `renderer: '2d'`, the 2D view emits `buildComplete` once
  each time a toolpath loads: the number of drawable segments, `decimationApplied: 1`,
  `travelHidden: false`, `quality: 'lines'`. Before, it never fired in 2D, so `onBuildComplete` and
  `onDisclosure` (and their Vue, Svelte and Web Component equivalents) stayed silent. `activeQuality`
  now reads `'lines'` after a 2D load instead of `null`.
- **`gcode-renderer-three`:** the `buildComplete` event carries an optional `skippedNonFinite` count.
- **`gcode-renderer-2d`:** new `summarize2DDrawable(ir)` returns `{ drawable, skippedNonFinite }` for
  the whole toolpath.
- **`gcode-preview-core/testing`:** `SuiteStubWorker` takes an optional IR factory, `makeNonFiniteTestIR()`
  is exported, and `ComponentHarness.mount` takes `{ renderer, ir }`. `MountedComponent` gains `parse()`.
  The component conformance suite adds a 2D case and a 3D case.
