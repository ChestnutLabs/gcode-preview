---
'@chestnutlabs/gcode-preview-core': patch
'@chestnutlabs/gcode-renderer-2d': patch
'@chestnutlabs/gcode-preview-element': patch
---

The 2D view no longer goes blank when you clear the layer range. With `renderer: '2d'`, setting
`layerRange` back to `null` (React, Vue, Svelte) or removing the `<gcode-preview>` layer-range attribute
after a file had loaded left an empty canvas. It now shows the top layer, as the 3D view does.

- **Layer requests:** `setLayerRange(start, end)` in 2D shows layer `end`, now floored (a slider value of
  `2.5` shows layer 2). An `end` past the last layer, `Infinity` included, shows the top layer, and it
  stays the top layer when you load a file with more layers. A `NaN` end is ignored. `LayerView2D.setLayer`
  behaves the same way.
- **Option checks:** `LayerView2D` and the core `LayerView2DRenderer` now throw a `RangeError` for
  `adjacentLayers: NaN`, a `ghostOpacity` outside `[0, 1]` or `NaN`, and a `lineWidth` that isn't a finite
  number above 0. `LayerView2D` also rejects a negative or non-finite `padding`, and `setAdjacentLayers(NaN)`
  throws with the previous count kept. Before, these drew wrongly with no error (a `NaN` opacity drew the
  ghost layers at full strength). Through the core controller, a bad `adjacentLayers` or `ghostOpacity`
  throws from `bindCanvas`. On `<gcode-preview renderer="2d">` a non-numeric `adjacent-layers` attribute is
  bad markup: it is ignored (one ghost layer, the default) and the element still draws.
- **Travel toggle:** turning travel back on in 2D keeps the travel style you gave the renderer, instead of
  switching to the default grey.
- **After `dispose()`:** the 2D renderer no longer draws, matching the 3D renderer. A size that is `NaN`,
  infinite or below 1 is clamped to 1 pixel instead of emptying the canvas.
- **Core `testing.ts`:** `AdapterHarness.create` accepts an optional `renderer: '2d'`. One new behavioral
  case runs the layer-range clip-and-restore check on 2D, and `installSuite2DProbe()` gives a DOM shim such
  as happy-dom a recording Canvas 2D context. A harness that ignores `renderer: '2d'` fails the case with an
  explicit message.
