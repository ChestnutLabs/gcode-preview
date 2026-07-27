---
'@chestnutlabs/gcode-renderer-2d': minor
'@chestnutlabs/gcode-preview-core': minor
---

E8 phase 4 (#215, DD-014 §6/§11) — capability honesty for the low-resource 2D view. Closes E8.

- `gcode-renderer-2d`: `describe2DDisclosures(ir)` + `LayerView2D.getDisclosures()` return honest
  notes when the IR can't be faithfully shown as flat layers — `capabilities.layers: 'unavailable'`
  (non-planar / CNC: every move is on layer 0, so the 2D view shows them all in one flat top-down
  frame; Z variation and non-XY motion aren't represented) or `'inferred'`. Planar FDM → no note.
- `gcode-preview-core`: `LayerView2DRenderer` emits those disclosures on `setIR` via the
  `renderer-unsupported` event, so a consumer UI is told what the flat view omits — never fabricated.

The DD-014 §8 low-resource budget is verified on a real device (Linux/Chrome host): layer-change
redraw ~0.2 ms median (≤ 3.6 ms even at 6× CPU throttle) vs the 16 ms budget, and ~0 MB heap growth
over 870 renders (the 2D renderer builds no per-layer geometry). See
`tools/benchmark/results/e8-2d-lowresource-benchmark-2026-07-26.md`.
