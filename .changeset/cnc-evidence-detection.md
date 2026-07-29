---
"@chestnutlabs/gcode-dialects": minor
---

feat: evidence-based non-extrusion detection — recognize header-less real CNC/laser files (#189)

The phase-3 CNC/laser detectors were tuned on synthetic fixtures and matched **none** of the real
public samples (LaserGRBL, LinuxCNC, GRBL CAM output) — real controller output usually has **no
generator header** and writes commands **mid-line** and **concatenated** (`s3400 m3`, `g1z-.1`).

Detection is now **evidence-scored**, not banner-only:

- A shared `scoreEvidence` extractor strips comments (so `(M3)` / `; LinuxCNC` in a comment can't
  create a false marker) and matches commands as words anywhere on a line.
- **GRBL laser** — LightBurn / `$32=1`, **or** the header-less form: a tool-on command (`M3`/`M4`) with
  `S` power and **no Z-plunge** (lasers are planar).
- **GRBL / generic mill** — `M3` spindle that **plunges into negative Z** with no extrusion (a milling
  fingerprint that separates it from a planar laser); banner optional.
- **LinuxCNC** — explicit header, **or** RS274NGC **O-word** subroutines/flow (`o100 sub`).
- Extrusion detection tightened to `E` on a **motion line**, so LinuxCNC `M67 E0 Q…` analog laser power
  is no longer mistaken for FDM.

Real-file result: **0/6 → 3/6 detected, each with the correct machine class** (laser→laser, mill→mill,
LinuxCNC→linuxcnc); the misses are honest — files with a commented-out or absent spindle carry no
tool-state to infer. Still **experimental tier** (claims reported `inferred`) — detection working on
real files is one input; semantic ground truth (does our `Cut` = actual cutting, `S` scale) still wants
a real machine or a trusted reference.
