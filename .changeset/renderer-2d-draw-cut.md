---
'@chestnutlabs/gcode-renderer-2d': minor
'@chestnutlabs/gcode-preview-core': minor
---

The 2D view now draws CNC and laser Cut moves. A CNC file used to show nothing in 2D with travel hidden.

- **Drawing:** Cut moves are drawn with the extrusion, in file order, coloured by the same colour mode (`moveKind`
  gives them the cut colour). Ghost layers and the live-progress dimming include them.
- **New toggle:** `cut` on `drawLayer`, `drawLayers` and `LayerView2D` options (default `true`), and
  `LayerView2D.setCut(visible)`. On `GcodePreview` with `renderer="2d"`, `setKindVisible('cut', visible)` and
  `showCut` / `show-cut` now take effect.
- **Counts:** the draw results gain `cutDrawn`. A move that is both an extrusion and a cut counts once, as
  extrusion. `summarize2DDrawable` and the 2D `build-complete` segment count include Cut moves.
- FDM files have no Cut moves and draw exactly as before (pinned by draw-stream digests of four real files).
