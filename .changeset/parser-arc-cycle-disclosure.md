---
'@chestnutlabs/gcode-parser': patch
---

Arcs and drilling cycles that cannot be drawn exactly as written are now reported in the parse warnings instead of being quietly reshaped. A `G2`/`G3` with an `R` smaller than half the chord (`arc-radius-too-small`; LinuxCNC rejects it, the parser draws a half circle), an `R` arc whose start and target are the same point (`arc-radius-degenerate`; there is no centre), an I/J/K arc whose target is not on the circle through its start (`arc-end-off-circle`; the arc spirals), and a `P` turn count other than 1 (`arc-turns-ignored`) each raise a warning. `G81`/`G82`/`G83` raise `canned-cycle-missing-word` when Z or R was never given (0 is used) and `canned-cycle-plane` in `G18`/`G19`, where the cycle still drills along Z.

One geometry fix: under `G91` a canned-cycle `Z` is now measured from the `R` plane, as in LinuxCNC, rather than from the current Z. `G90` cycles are unchanged. The bundled `mach3` demo gains the `arc-radius-too-small` warning (its `G02 … R0.255` arcs are shorter than half their chord); its geometry is unchanged.
