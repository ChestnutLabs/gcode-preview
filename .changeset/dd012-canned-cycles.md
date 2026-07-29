---
"@chestnutlabs/gcode-parser": minor
---

feat: canned drilling cycle expansion — G81/G82/G83 (DD-012 phase 2, #189)

CNC canned drilling cycles previously produced **zero geometry** — holes vanished. They now expand to
explicit sub-moves so the drilling is real, classified toolpath:

- **G81/G82** (drill / drill-with-dwell): rapid to the hole XY, rapid down to the R plane, **feed to
  depth (`Cut`)**, rapid retract.
- **G83** (peck): the plunge is a peck loop — feed down by `Q`, rapid-retract to R between pecks, until
  reaching depth; each down-feed is a `Cut`.
- **G98/G99** set the retract plane (initial Z vs R); **G80** cancels; a `G0`–`G3` motion also cancels.
- **Modal repeat**: with a cycle active, a bare `X`/`Y` line drills another hole (retaining Z/R/Q and
  the initial plane) — the common CNC hole-pattern form.
- Rapids are `Travel`, plunges are `Cut`; new capability **`cannedCycles`** (`known` once a cycle is
  seen, else `unavailable`).

FDM output is unchanged (no canned cycles in FDM); the native-golden corpus gains only the additive
`cannedCycles` capability, with no geometry change.
