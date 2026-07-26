# G-code Motion & Position-Command Coverage

**Status:** **Audit published** (issue #154, credits upstream
[xyz-tools/gcode-preview#179](https://github.com/xyz-tools/gcode-preview/issues/179), 2026-07-23).
**Updated 2026-07-25** for **E10 phase 1** (DD-010): `M82`/`M83`, `G90`/`G91`, and the `G92`
E-datum are now modeled.

This page records which **position-affecting** G/M-codes the parser/interpreter
(`@chestnutlabs/gcode-parser`) honors. The interpreter began as a **byte-exact port of the
inherited xyz-tools engine** (E1 golden-gated); E10 (motion-model correctness) layers a
firmware-conditioned modal model on top of it. Capability honesty (DD-001) means naming the
remaining gaps plainly — and disclosing them at runtime via the `extrusionMode` /
`positioningMode` capabilities and the `g92-xyz-unhandled` warning.

## Coverage

| Code(s) | Effect on position | Status | Evidence |
|---|---|---|---|
| `G0` / `G1` | linear move | **honored** | core motion |
| `G2` / `G3` | arc move (I/J/K center or R) incl. full circles, all planes | **honored** | E2/E3, #157 |
| `G20` / `G21` | units inch / mm | **honored** | `units` channel |
| `G28` | homing (position reset to origin) | **honored** | interpreter |
| `T0`–`T7` | tool select | **honored** | `tool` channel |
| **`G90` / `G91`** | **absolute / relative positioning** | **honored** (E10 phase 1, #155) — `positioningMode` capability | `motion-model.test.ts` |
| **`M82` / `M83`** | **extruder absolute / relative** | **honored** (E10 phase 1, #156) — delta-based classification, `extrusionMode` capability | `motion-model.test.ts` |
| **`G92`** | **set-position / coordinate offset** | **partial** — **E-datum honored** (E10 phase 1); **X/Y/Z work-offset NOT honored** (warns `g92-xyz-unhandled`, phase 3 #158) | `motion-model.test.ts` |
| **`G17` / `G18` / `G19`** | **arc plane select (XY / XZ / YZ)** | **honored** (E10 phase 2, #157) — plane-parameterized flattening, `arcPlanes` capability | `motion-model.test.ts` |
| **`G53` / `G54`–`G59`** | **machine / work coordinate systems** | **NOT honored** (phase 3 #158) | interpreter switch |
| `G4` | dwell | n/a (not position-affecting) | — |

## Firmware conditioning (DD-010)

Absolute is the power-on default (Marlin/RepRapFirmware convention). Whether `G90`/`G91` also
switch the **extruder** mode is firmware-specific, so it is gated on
`parseOptions.extruderFollowsPositioning`: Marlin/Klipper set it `true` (E follows `G90`/`G91`
unless `M82`/`M83` override); RepRapFirmware leaves it `false` (XYZ and E independent). Explicit
`M82`/`M83` always win. When neither the mode nor a firmware hint is known, the capability is
disclosed as `inferred`, never `known` — the stack does not fabricate a mode it cannot prove.

## Resolved reproductions (originally captured 2026-07-23)

```
[G91] relative: `G1 X10` then `G1 X10` after `G91` → now ends X=20 ✓ (was 10)
[M82] abs-E:    an E-unchanged move is now classified TRAVEL ✓; extrusion distance no longer inflated
[G92 E] datum:  `G92 E0` now resets the extruder datum so the next per-move delta is correct ✓
```

This is why the 7 absolute-E dialect fixtures' `extrusionDistance` **dropped** at E10 phase 1: the
old engine summed raw (cumulative) E words; the delta-based model sums true per-move deltas. All
other geometry (positions, kinds, layers, source bytes) stayed byte-identical.

## Remaining gaps

- **`G92` X/Y/Z work-offset** — surfaced as the `g92-xyz-unhandled` warning rather than a silent
  datum shift; lands with coordinate systems in phase 3 (#158).
- **`G53` / `G54`–`G59`** — CNC work-coordinate systems; rare in FDM. Phase 3 (#158).

Motion-model changes alter interpreter state and therefore IR positions, so each remains
**contract-sensitive and DD-gated** (DD-010: explicit golden-regen + capability honesty). Tracking
issues: **#155** (G90/G91 + G92 E — **shipped**), **#156** (M82/M83 — **shipped**), **#157** (arc
planes — **shipped**), **#158** (coordinate systems + G92 XYZ).
