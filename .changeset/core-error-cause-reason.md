---
'@chestnutlabs/gcode-parser': patch
'@chestnutlabs/gcode-preview-core': patch
'@chestnutlabs/gcode-preview-react': patch
'@chestnutlabs/gcode-preview-vue': patch
'@chestnutlabs/gcode-preview-svelte': patch
'@chestnutlabs/gcode-preview-element': patch
---

Errors now keep the original error, and `E_RENDERER_LOAD` says whether the 3D renderer failed to load or to start.

- **`cause`.** `state.error`, the `error` and `parse-error` events and a failed `parse()` outcome now carry
  `cause` when there is an underlying error, on every adapter's callback and event too. For example, the browser's
  `SecurityError` behind `E_WORKER_CREATE_FAILED`, the error the WebGL renderer threw behind `E_RENDERER_LOAD`, or
  the renderer's `RangeError` behind `E_CONTROL_REJECTED`. Check `error.cause?.name` instead of matching on
  `message`. `cause` is for reading, not persisting: `structuredClone(state)` throws `DataCloneError` when a cause
  can't be copied. Errors with no underlying error have no `cause` key.
- **`reason` on `E_RENDERER_LOAD`.** `'load'` means the renderer's code could not be downloaded (offline, or a
  stale deploy): reloading can help. `'start'` means it downloaded but could not start, usually because there is no
  WebGL: fall back to `renderer: { mode: '2d' }`. The code is still `E_RENDERER_LOAD`, so existing checks keep
  working.
- **`E_POST_FAILED`** from `GcodeParseSession` now carries the browser's error (for example `DataCloneError`) on
  `error.cause`, as `E_WORKER_CREATE_FAILED` already did.
- New exported types: `PreviewError` and `RendererFailureReason`, re-exported by every adapter.
