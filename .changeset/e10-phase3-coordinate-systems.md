---
'@chestnutlabs/gcode-parser': minor
---

Motion-model correctness — E10 phase 3: coordinate systems + probe-aware datum (#158, DD-010 D4).

The interpreter now honors work-coordinate systems and `G92` X/Y/Z, keeping the IR in the logical
(work) frame so identity-WCS files stay byte-identical:

- **`G54`–`G59`** select an active work offset (settable via `G10 L2`/`L20`); **`G53`** is a one-shot
  machine-coordinate bypass for the next move.
- **`G92` X/Y/Z** is a datum **shift** when the current position is known (continuity preserved — e.g.
  `G92 X0` at X50 then `G1 X10` → X60).
- **Probe awareness (DD-010 D4 amendment):** `G31` reaches its endpoint at runtime, so it marks the
  probed axes uncertain and is disclosed via a new `probe-position-runtime-dependent` warning (never
  advanced to the un-reached commanded value). A `G92` after a probe is a logical **resync** — the
  current logical position is declared to be the given value and a new frame starts at the datum, so no
  fabricated move is drawn across the unknown probe result. The `mach3` fixture's post-probe path now
  renders in its authored logical range instead of a stale-position shift.
- New capability `coordinateSystem` (`'known'` once any G53/G54–G59/G92-XYZ/G10 is seen, else
  `'inferred'` = identity WCS).

**Output change (documented):** the identity-WCS corpus stays **byte-identical** (the only golden
change is the additive `coordinateSystem` key). The `mach3` fixture intentionally diverges from the
inherited engine (which ignored `G31` and `G92 Z`) — a documented semantic correction, pinned by its
native golden and excluded from strict adapter-equivalence. No renderer/adapter API change.
