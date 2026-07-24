# @chestnutlabs/gcode-preview-core

## 0.1.0

### Minor Changes

- [#141](https://github.com/ChestnutLabs/gcode-preview/pull/141) [`c26879f`](https://github.com/ChestnutLabs/gcode-preview/commit/c26879f4148b77e5e9070bc2ee421a265c9571d3) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - First published line of the Chestnut Labs G-code Preview stack (`v0.1.0`, DD-008): worker-based
  `.gcode` / `.gcode.3mf` parsing into a versioned `ToolpathIR`, cross-vendor dialect annotation
  (PrusaSlicer, Orca/Bambu, Cura, Klipper, Marlin, RepRap-flavor), a Three.js renderer with layer
  clipping, scrub, tubes, build plates and the honest live-progress overlay, a framework-neutral
  preview controller, and first-class Vue/React/Svelte adapters with capability parity.

- [#145](https://github.com/ChestnutLabs/gcode-preview/pull/145) [`ab7db35`](https://github.com/ChestnutLabs/gcode-preview/commit/ab7db35b3fcc84da3f26c4b6fe91671470df05c5) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add `renderStill(source, options)` to `@chestnutlabs/gcode-preview-core`: a headless,
  non-interactive still-image entry point (DD-008 §4.8; the reusable capability behind AnyBridge's
  G-code thumbnail worker, [#791](https://github.com/ChestnutLabs/gcode-preview/issues/791)). Accepts G-code bytes or a pre-parsed `ToolpathIR`, builds to
  completion, frames deterministically (or applies an explicit camera pose), and renders one frame
  to an `OffscreenCanvas` or DOM canvas for the caller to read back.

  `gcode-renderer-three` gains the supporting surface: `ToolpathRenderer` accepts an `OffscreenCanvas`
  render target (new `RenderTargetCanvas` type) and a `preserveDrawingBuffer` option for readable
  single-frame renders.

### Patch Changes

- Updated dependencies [[`c26879f`](https://github.com/ChestnutLabs/gcode-preview/commit/c26879f4148b77e5e9070bc2ee421a265c9571d3), [`ab7db35`](https://github.com/ChestnutLabs/gcode-preview/commit/ab7db35b3fcc84da3f26c4b6fe91671470df05c5)]:
  - @chestnutlabs/toolpath-core@0.1.0
  - @chestnutlabs/gcode-parser@0.1.0
  - @chestnutlabs/gcode-renderer-three@0.1.0
