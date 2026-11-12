---
'@chestnutlabs/gcode-renderer-2d': patch
---

The 2D layer view now copes with bad coordinates and bad layer tables in a toolpath you build
yourself.

- **One `Infinity` or `NaN` X/Y coordinate no longer blanks the view.** Before, a single non-finite
  coordinate made the whole-model frame infinite, so every line was drawn at `NaN` pixels and the
  canvas stayed empty. Now a segment with a non-finite X/Y endpoint is skipped: it is not drawn and
  it does not affect the frame. `drawLayer` and `drawLayers` report how many segments were skipped
  in a new `skippedNonFinite` field (also on `LayerView2D.render()`'s result).
- **`computeLayerFit` always returns a finite projection.** Bounds with an `Infinity` or `NaN` edge
  are treated as empty (scale 1, centred). A `NaN` width, height or padding is treated as 0.
- **A layer with a negative `segStart` no longer hangs the draw.** The range is clamped to the
  segment table. Before, a value such as `-1e15` looped for a very long time.
- **`rgbToCss` maps a `NaN` channel to 0.** Before, it produced `rgb(NaN, …)`. That is invalid CSS,
  so the canvas ignored it and drew the line in the previous line's color.

Parsed files are not affected unless they hit these cases. The parser already drops number words
that overflow, with a `number-out-of-range` warning.
