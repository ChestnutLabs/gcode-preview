---
'@chestnutlabs/gcode-renderer-three': minor
---

Very large CNC/laser files are now thinned automatically, like large prints; set `decimation: 1` to keep every move.

- Cut moves now count toward the automatic decimation threshold (more than 2M drawn moves keeps every 2nd, 5M every 3rd,
  10M every 5th). `decimationApplied` reports the factor and travel is hidden while it is above 1, as for prints.
- The first and last cut of each layer are always kept.
- FDM files have no Cut moves and render exactly as before.
