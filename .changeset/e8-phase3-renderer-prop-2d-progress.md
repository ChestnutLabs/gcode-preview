---
'@chestnutlabs/gcode-preview-core': minor
'@chestnutlabs/gcode-renderer-2d': minor
'@chestnutlabs/gcode-preview-vue': minor
'@chestnutlabs/gcode-preview-react': minor
'@chestnutlabs/gcode-preview-svelte': minor
'@chestnutlabs/gcode-preview-element': minor
---

E8 phase 3 (#214, DD-014 D5): select the renderer with a **`renderer: '2d' | '3d'`** prop, plus a
live-progress marker in the 2D view. Additive; the default (`'3d'`) output is unchanged.

- **`gcode-preview-core`**: a renderer-agnostic `PreviewRenderer` seam. `renderer.mode` (default
  `'3d'`) picks the implementation; the **3D renderer is now loaded on demand** (dynamic `import()`),
  so a `'2d'` consumer's bundle **never pulls Three.js**. New `LayerView2DRenderer` adapts the Canvas
  2D renderer to the seam. Genuine 3D-only requests on the 2D view (camera projection, quality modes)
  are disclosed via a new `renderer-unsupported` event rather than faked. The controller's renderer
  now resolves asynchronously; controls issued before it is ready are queued and replayed in order.
- **`gcode-renderer-2d`**: a live-progress "completed cut" (DD-006) — `LayerView2D.setProgress` /
  `drawLayers({ progress })` dims the not-yet-printed extrusion of the layer currently printing.
- **Adapters** (Vue/React/Svelte/Element): a top-level `renderer` prop (+ `adjacentLayers`) maps to
  `renderer.mode`; `raw.renderer()` now returns the neutral `PreviewRenderer`. `<GcodePreview renderer="2d" />`.

No IR/parser change; no change to the 3D renderer's public API or output.
