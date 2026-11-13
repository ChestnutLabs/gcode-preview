---
'@chestnutlabs/toolpath-core': patch
'@chestnutlabs/gcode-dialects': patch
---

CNC, laser and plotter files now frame the work instead of the bed.

- **What changes:** for a file whose productive moves are cuts (`MoveKind.Cut`: a feed move while M3/M4 holds, with
  no extrusion), `ir.bounds` is now the cut extent instead of empty (`Infinity`/`-Infinity`). The 3D viewer and
  `renderStill` fit the camera to the cut, and the click radius and progress marker scale with it, the same as for a
  print. A labelled cut also counts toward `ir.objectBounds`, including object labels a dialect adds (Klipper
  `EXCLUDE_OBJECT`, M486, slicer object comments), so `frameContent: 'object'` frames a labelled cut-only file. A printer with a laser head gets the union of its
  extrusion and its cuts.
- **What stays the same:** FDM files never produce `Cut` moves, so their bounds are unchanged (every FDM file in the test
  corpus, 21 of them, is byte-identical). Travel, retract and unretract moves are still excluded. `ir.modelBounds` and the
  `nonModelClassification` capability still look at extrusion only, so a cut-only file still reports
  `nonModelClassification: 'unavailable'` with an empty `modelBounds`.
- **Not covered:** a pen plotter that never sends M3/M4 has no `Cut` moves, so its `bounds` stays empty and the 3D
  viewer still frames the bed.
