---
'@chestnutlabs/gcode-renderer-three': minor
'@chestnutlabs/gcode-preview-core': minor
'@chestnutlabs/gcode-model-renderer': minor
'@chestnutlabs/gcode-preview-vue': minor
'@chestnutlabs/gcode-preview-react': minor
'@chestnutlabs/gcode-preview-svelte': minor
'@chestnutlabs/gcode-preview-element': minor
---

New opt-in `pixelRatio` for sharper interactive views on HiDPI screens. If you don't set it, rendering
doesn't change: the canvas stays at one drawing-buffer pixel per CSS pixel.

- **What it takes.** A number in (0, 4], or `'device'`. `'device'` uses the screen's `devicePixelRatio`,
  capped at 2, and follows it live when it changes, for example when the window moves to another monitor
  or the browser zoom changes. Anything else throws `RangeError`. Values are never clamped, and
  `'device'` must be that exact lowercase string.
- **Cost.** A higher ratio shades more pixels: ratio 2 fills 4× the fragments of ratio 1. That is fine
  for a single viewer. On pages with many viewers, or on weak GPUs, leave it unset or use a number.
- **Orbiting.** `interactionQuality: 'auto'` still lowers detail while the camera moves and settles back
  on your ratio. A change made mid-gesture applies at once, still reduced, and the gesture settles on
  the new ratio.
- **`capture()`.** The default image size doesn't change. With no `width`/`height`, a capture is the
  canvas's CSS size whatever the ratio. Pass `width`/`height` for a crisper image. This also fixes an
  unsized `capture()` taken during an orbit with `interactionQuality: 'auto'`: it used to return the
  reduced-detail size, and now returns the CSS size.
- **Where to set it.**
  - Toolpath viewer: the `renderer.pixelRatio` controller option and `controls.setPixelRatio(ratio)`. It
    is validated synchronously, even before the 3D renderer loads, and kept across canvas rebinds.
  - Model viewer: the `pixelRatio` option and `controls.setPixelRatio(ratio)` on
    `createModelPreviewController` and `createModelViewer`.
  - Vue, React and Svelte: a declarative `pixelRatio` prop on `GcodePreview` and on the `/model`
    `ModelViewer`. Leaving it unset keeps the current ratio.
  - `<gcode-preview>` and `<gcode-model-viewer>`: a `pixel-ratio` attribute and a `pixelRatio` property.
    Setting the property to an invalid value throws `RangeError`. A bad attribute value is ignored, and
    the element keeps the last valid ratio.
- **2D renderer.** `setPixelRatio` reports `renderer-unsupported` (feature `quality`), and the 2D view
  keeps its own resolution.
- **Stills.** `renderStill` and `renderModelStill` have no pixel-ratio option; size a still with
  `width`/`height`.
- **Lower-level API.** `ToolpathRenderer` and `InteractiveStage` gain a `pixelRatio` option and
  `setPixelRatio`. `InteractionQualityController` gains `rebase(ratio)` and `currentRatio`. `PreviewRenderer`
  gains an optional `setPixelRatio`, so an existing custom renderer still type-checks. New exports:
  the `PixelRatioOption` type (also from `gcode-preview-core`), `DEVICE_PIXEL_RATIO_CAP`, and the
  `DisplayEnv` / `MediaQueryListLike` types (an injectable display for tests).
