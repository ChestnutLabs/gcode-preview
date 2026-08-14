---
"@chestnutlabs/gcode-renderer-three": patch
---

Camera UX polish: enable OrbitControls affordances already available (#267)

Turns on `zoomToCursor` (wheel zoom moves toward the pointer, not the orbit target) and derives
`minDistance`/`maxDistance` clamps from the framed model size so the view can't dolly through the
model or lose it at the extremes. Clamps are recomputed in `frame()`, so they track each file's
bounds. Internal to `scene.ts` — no dependency, no public-API/adapter change; the headless
still-render path (no OrbitControls) is unaffected.
