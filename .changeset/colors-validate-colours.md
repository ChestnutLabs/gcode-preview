---
'@chestnutlabs/gcode-colors': patch
---

A colour mode with a colour that has no rendering now throws a `RangeError` naming the mode, the field and
the index, instead of painting garbage (NaN into the vertex buffer or canvas style).

- **Every colour is checked:** `single.color`, each `palette` / `ramp` entry, `moveKind` `cut` / `travel`
  and every `fallback`. A colour is an array-like (plain array, readonly tuple, `Float32Array`) whose first
  three entries are finite numbers; extra entries (an alpha) are ignored and any finite value is accepted,
  so a 4-element or 0-255 colour that rendered before still does. NaN, ±Infinity, fewer than three entries
  or a non-array now throw, e.g. `tool color mode palette[2] must be [r, g, b] of three finite numbers, got
  [0.1, NaN, 0.3]`.
- **`fallback` is required** in `feature`, `colorChange`, `feedrate`, `layerHeight`, `power`, `object` and
  `moveKind` mode (the types already require it) and optional only in `tool` and `filament`. An empty
  palette or ramp is still valid and colours every segment with the fallback.
- **Callers inherit it:** `createSegmentColorer`, `segmentColor`, the `colorMode` option and
  `setColorMode` of the Canvas 2D `LayerView2D` and the preview controller all call `checkColorMode`, so a
  bad mode throws at the call and is never stored.
- A one-stop ramp now returns a fresh colour array instead of the ramp's own entry.
