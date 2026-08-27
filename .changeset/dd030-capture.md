---
"@chestnutlabs/gcode-renderer-three": minor
"@chestnutlabs/gcode-model-renderer": minor
"@chestnutlabs/gcode-preview-core": minor
"@chestnutlabs/gcode-preview-element": minor
---

feat(renderer): interactive view capture() → Blob (DD-030 D1)

The interactive viewer can now hand back **what is on screen right now** as an image `Blob` — for a
user-selected thumbnail, a large-file thumbnail fallback, or a screenshot. New `capture(opts?)` where
`opts` is `{ width?, height?, format?, quality?, background? }` (all optional; defaults match the live
view).

Available on every interactive surface: `GcodePreviewControls.capture()` (so the Vue, React, Svelte, and
Web-Component adapters all inherit it — the Web Component also exposes an imperative `capture()` method),
and `ModelViewer.capture()` on the model-viewer handle. The toolpath `ToolpathRenderer` and the shared
`InteractiveStage` carry the implementation.

**Mechanism (render-to-target).** Capture renders the current scene + active camera into an off-screen
`WebGLRenderTarget` at the requested size and reads it back, rather than flipping the interactive
context's `preserveDrawingBuffer` (which would tax every interactive frame). That gives an arbitrary
output size and an independent/transparent background **without** disturbing the live view, and reuses the
headless still path's "single render, then read pixels" recipe. The thumbnail is framed at its own aspect
so it isn't distorted; the live view is repainted afterward. The library returns the `Blob` and **never**
triggers a download — the caller owns the pixels (same contract as `renderStill`).

**Honest.** When the renderer cannot render-to-target (the 2D renderer, a stub GL / no WebGL) or the stage
is disposed / its context is lost, `capture()` rejects with a typed `CaptureUnsupportedError`
(`code: 'E_CAPTURE_UNSUPPORTED'`) — never fabricated output. Purely additive (a new optional method on the
renderer contract; no existing signature changed). Final increment of the DD-030 renderer/viewer
interoperability batch (bed + per-plate scope + capture).
