---
'@chestnutlabs/gcode-renderer-2d': minor
---

E8 phase 2 (#213, DD-014 D2): current layer **+ adjacent "ghost" layers** in the low-resource 2D
renderer. Additive; no other package changes.

- `LayerView2D` gains `adjacentLayers` (default 1, floor 0) + `setAdjacentLayers(n)`: the N layers
  immediately below the active one are drawn first, dimmed (`ghostOpacity`, default 0.25), as a depth
  cue — the active layer is drawn last at full opacity, on top.
- New pure `drawLayers(ctx, ir, opts)` orchestrates the window over `drawLayer`; `drawLayer` gains an
  `opacity` option (via `globalAlpha`) for the ghost passes.
- The view frame is now the **whole-model XY bounds** (`modelBounds2D`, cached on `setToolpath`), so
  scrubbing layers no longer rescales or jumps and every layer shares one fit — ghosts overlay the
  active layer exactly. Per-render work stays bounded to the drawn layers.
- Honest edges: `adjacentLayers: 0` draws the active layer only; the ghost window clamps at layer 0;
  an out-of-range active layer draws nothing (`drawn: false`).
