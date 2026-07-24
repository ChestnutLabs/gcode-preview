---
'@chestnutlabs/gcode-parser': minor
---

Motion-model correctness — E10 phase 1 (#156/#155, DD-010 D1/D2 + G92 E-datum).

The interpreter now models the **extruder mode** (`M82`/`M83`) and **positioning mode** (`G90`/`G91`)
and classifies extrude-vs-travel from the true per-move **E delta**, not the raw E word:

- **M82 (absolute E)** — an E-unchanged move is now correctly `Travel` (was mis-classified as extrude),
  and `stats.extrusionDistance` is delta-summed (was inflated by the cumulative E). This is the audit's
  highest-impact gap (#156).
- **M83 (relative E)** and the common slicer shape (`G90` + `M83`) are byte-identical to before.
- **G90/G91** set the XYZ positioning mode; relative moves accumulate. `G92 E<v>` resets the extruder
  datum. `G92 X/Y/Z` is disclosed as unhandled (`g92-xyz-unhandled` warning) — deferred to phase 3.
- The `G90`/`G91`↔E interaction is **firmware-conditioned** (DD-010 D2): Marlin/Klipper let G90/G91
  steer E; RepRapFirmware keeps E independent. Supplied via the new `parseOptions.extruderFollowsPositioning`
  hint (default `false`); the byte-exact engine never sniffs firmware. When unspecified, the E mode
  defaults to **absolute** (the firmware power-on convention), disclosed `inferred`.
- New capabilities `extrusionMode` and `positioningMode` (`'known'` when the governing command was seen,
  else `'inferred'`).

**Output change (documented):** all segment **positions, `kind`, `tool`, `layer`, and `srcByte` are
byte-identical** across the corpus. Seven hand-crafted dialect fixtures use *absolute* E without an
`M82`/`M83`; their per-segment extrusion delta and `extrusionDistance` are now **corrected** (previously
inflated by the raw-E-as-delta assumption). No renderer/adapter API change.
