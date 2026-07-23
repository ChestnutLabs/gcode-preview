---
'@chestnutlabs/gcode-preview-core': minor
'@chestnutlabs/gcode-renderer-three': minor
---

Add `renderStill(source, options)` to `@chestnutlabs/gcode-preview-core`: a headless,
non-interactive still-image entry point (DD-008 §4.8; the reusable capability behind AnyBridge's
G-code thumbnail worker, #791). Accepts G-code bytes or a pre-parsed `ToolpathIR`, builds to
completion, frames deterministically (or applies an explicit camera pose), and renders one frame
to an `OffscreenCanvas` or DOM canvas for the caller to read back.

`gcode-renderer-three` gains the supporting surface: `ToolpathRenderer` accepts an `OffscreenCanvas`
render target (new `RenderTargetCanvas` type) and a `preserveDrawingBuffer` option for readable
single-frame renders.
