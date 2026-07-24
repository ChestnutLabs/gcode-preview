# G-code Motion & Position-Command Coverage

**Status:** **Audit published** (issue #154, credits upstream
[xyz-tools/gcode-preview#179](https://github.com/xyz-tools/gcode-preview/issues/179), 2026-07-23).

This audit records which **position-affecting** G/M-codes the parser/interpreter
(`@chestnutlabs/gcode-parser`) currently honors. The interpreter is a **byte-exact port of the
inherited xyz-tools engine** (E1 golden-gated), so it inherits the upstream engine's coverage —
**and its gaps**. Capability honesty (DD-001) means naming those gaps plainly.

## Coverage

| Code(s) | Effect on position | Status | Evidence |
|---|---|---|---|
| `G0` / `G1` | linear move | **honored** | core motion |
| `G2` / `G3` | arc move (I/J center or R) incl. full circles | **honored (XY plane only)** | E2/E3 |
| `G20` / `G21` | units inch / mm | **honored** | `units` channel |
| `G28` | homing (position reset to origin) | **honored** | interpreter |
| `T0`–`T7` | tool select | **honored** | `tool` channel |
| **`G90` / `G91`** | **absolute / relative positioning** | **NOT honored — always absolute** | repro below |
| **`G92`** | **set-position / coordinate offset** | **NOT honored** | repro below |
| **`M82` / `M83`** | **extruder absolute / relative** | **NOT honored — raw E treated as delta** | repro below |
| **`G17` / `G18` / `G19`** | **arc plane select (XY / XZ / YZ)** | **NOT honored — arcs assume XY** | code (`i`/`j` only) |
| **`G53` / `G54`–`G59`** | **machine / work coordinate systems** | **NOT honored** | interpreter switch |
| `G4` | dwell | n/a (not position-affecting) | — |

## Reproductions (2026-07-23, against `dist`)

```
[G91] relative: `G1 X10` then `G1 X10` after `G91` → ends X=10 (should be 20; second move read as absolute)
[G92] offset:   `G92 X0` at physical X50, then `G1 X10` → ends X=10 (should be physical X=60)
[M82] abs-E:    an E-unchanged move is classified EXTRUDE (should be TRAVEL); extrusion distance inflated
[G18] XZ arc:   flattened with XY (I/J) interpretation; K ignored
```

## Impact & priority

- **`M82` (absolute extrusion)** is the highest-impact gap: it is common (Marlin default, many
  slicer configs), and mis-classifying travel moves as extrusion distorts the preview and the
  extrusion-distance/live-progress signals. **Modern slicers that emit `M83` (relative E) are
  unaffected** — including the fixtures in our corpus, which is why the demo renders correctly.
- **`G91` / `G92`** affect files that use relative positioning or coordinate resets (some CNC
  post-processors, hand-written G-code, certain firmware start sequences).
- **`G17`/`G18`/`G19`** matter mainly for CNC (non-XY arcs); most FDM is XY-plane.
- **`G53`/`G54`–`G59`** are CNC work-offset systems; rare in FDM.

These are **inherited limitations, not regressions**. Fixes change interpreter motion state and
therefore IR positions, so each is **contract-sensitive and DD-gated** (DD-001/DD-003). Tracking
issues: **#155** (G90/G91 + G92 motion state), **#156** (M82/M83 extruder mode), **#157**
(G17/G18/G19 arc planes), **#158** (G53/G54–G59 coordinate systems).

## `v0.1.0` note

Whether any of these blocks the first release is a maintainer call. The recommendation is to
**document them as known limitations for `v0.1.0`** (this page) and prioritize **#156 (M82)** and
**#155 (G91/G92)** early in the post-release motion-model work, given real-world prevalence.
