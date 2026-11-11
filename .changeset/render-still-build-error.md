---
'@chestnutlabs/gcode-preview-core': patch
---

`renderStill` now rejects instead of hanging when the toolpath build fails: the rejection is a `RenderStillError` (exported) with `code: 'E_GEOMETRY_BUILD'`, and the renderer is disposed. Callers that awaited without a `catch` now see a rejection (previously the promise never settled).
