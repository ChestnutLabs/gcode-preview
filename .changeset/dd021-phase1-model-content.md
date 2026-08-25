---
'@chestnutlabs/gcode-model-renderer': patch
---

refactor(model-renderer): extract the shared presentation scene core into `ModelContent` (DD-021 Phase 1)

Pulls the model root, studio-light rig, and capability-honest mesh building (including per-triangle
`paint_color` vertex colours) out of `ModelRenderer` into a new `ModelContent` class that fills a
provided three.js `Scene`. `ModelRenderer` (and therefore `renderModelStill`) keeps its own headless GL
+ camera and now composes `ModelContent` for scene content — output is unchanged (the renderer suite
passes byte-for-byte). This gives the upcoming interactive `createModelViewer` (DD-021 Phase 1) one
shared mesh/lighting/paint path instead of a parallel copy.
