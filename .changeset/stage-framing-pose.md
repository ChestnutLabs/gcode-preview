---
"@chestnutlabs/gcode-renderer-three": minor
---

Add `framingFromCenterRadius` (and the `Framing` type) — the first piece of the shared render "stage"
(DD-018 Phase 0). This is the deterministic 3/4 camera-framing pose (printer→scene coordinates,
`viewHalfHeight = 1.25·radius`, fixed offset), lifted verbatim from `ToolpathRenderer.frame()` and now
single-sourced so the forthcoming `ModelRenderer` frames identically. Internal refactor for the toolpath
side (framing output unchanged); additive public export.
