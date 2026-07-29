---
"@chestnutlabs/toolpath-core": minor
"@chestnutlabs/gcode-parser": minor
---

feat: non-extrusion `Cut` move classification + tool-state modal (DD-012 phase 1, #189)

Non-extrusion toolpaths (CNC / laser / plotter) no longer collapse their productive moves into
`Travel`. The parser now tracks a tool-engaged modal state — `M3`/`M4` (spindle/laser on, incl. the
`M03`/`M04` leading-zero form) engage it, `M5` disengages — and classifies a move with **no extrusion
`E`** while the tool is engaged as the new **`MoveKind.Cut`** bit (a CNC/laser/plotter counterpart to
`Extrude`, composing with `ArcSegment` like the other kinds).

- New IR move kind `MoveKind.Cut = 1 << 7` (`@chestnutlabs/toolpath-core`).
- New capability **`cutMoves`**: `known` once a tool-state modal is seen (a CNC/laser/plotter file),
  `unavailable` for FDM.
- **FDM is byte-identical**: FDM slices never issue `M3`/`M4`, so `Cut` is never set and every move
  stays `Extrude`/`Travel` exactly as before (verified against the native-golden corpus; the CNC
  fixtures `demo-easel`/`demo-mach3` are documented intentional adapter-divergences).

Modal tool-state *value* channels (laser power / spindle RPM via `S`), canned-cycle expansion, and
dialect families follow in later DD-012 phases.
