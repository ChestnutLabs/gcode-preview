---
'@chestnutlabs/gcode-model-renderer': minor
'@chestnutlabs/gcode-renderer-three': minor
---

Model viewer framing and STL lighting fixes (AnyBridge Customizer):

- **Aspect-aware fit.** The first frame and `frame()` (Reset view) now fit the model's bounding box to the canvas aspect and field of view, centred with a small margin. Previously the camera used a fixed bounding-sphere offset, so a wide or flat model could overflow a narrow canvas and sit off-centre.
- **Re-frame on resize.** `resize(w, h)` re-fits the model until the user orbits, zooms, or pans (or calls `setCameraState`); after that the user's view is kept, and `frame()` resumes auto-framing. New option `autoFrameOnResize` (default `true`) on `createModelViewer` / `createModelPreviewController` turns this off.
- **Zero STL normals.** STL facets whose normals are zero or non-finite (common from third-party exporters) rendered solid black; they are now recomputed from the facet winding. Valid file normals are kept.
- `InteractiveStage` gains `fitBox(min, max, { direction?, margin? })`, `viewDirection()`, and an `onInteractionStart` option. The toolpath renderer's framing is unchanged.
