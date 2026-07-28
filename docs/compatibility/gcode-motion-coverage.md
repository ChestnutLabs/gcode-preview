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
| **`G92`** | **set-position / datum** | **honored** (E10 phase 1 E-datum; **phase 3** X/Y/Z, #158) — datum shift when the position is known; a logical **resync** after a probe (see below), `coordinateSystem` capability | `motion-model.test.ts` |
| **`G53` / `G54`–`G59`** | **machine / work coordinate systems** | **honored** (E10 phase 3, #158) — active WCS + offsets (`G10 L2/L20`), `G53` one-shot machine-coord bypass, `coordinateSystem` capability | `motion-model.test.ts` |
| **`G31`** | **probe toward a target** | **honored** (E10 phase 3, #158) — endpoint is runtime-dependent; the probed axis is marked uncertain and disclosed (`probe-position-runtime-dependent`), never advanced to the un-reached commanded value | `motion-model.test.ts` |
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

## Probe-aware datum (DD-010 D4 amendment, #158)

`G92` X/Y/Z resolves against **per-axis position certainty**, not blindly:

- When the current machine position is **known**, `G92 X<v>` is a **datum shift** — the work offset is
  set so the current logical position reads `<v>`, preserving continuity (audit repro line 31: `G92 X0`
  at X50, then `G1 X10` → X60).
- After an un-modeled probe (`G31` reaches its endpoint at runtime), the probed axis is **uncertain**.
  A following `G92 Z0` is then a logical **resync**: the current logical Z is declared 0 and the path is
  finalized so the next move starts a **new frame at the datum** — no fabricated move is drawn across the
  unknown probe result. In the `mach3` fixture, `G31 Z-11.8` then `G92 Z0` then `G00 Z0.039` renders at
  logical **0.039** (not the +0.2″ shift a stale-position datum would produce). Disclosed via
  `probe-position-runtime-dependent`; the native golden pins this, and the fixture is a documented,
  intentional divergence from the inherited engine (which ignored both `G31` and `G92 Z`).

## Remaining gaps

The E10 motion-model gaps from the #154 audit are now all closed. Tracking issues: **#155** (G90/G91 +
G92 E), **#156** (M82/M83), **#157** (arc planes), **#158** (coordinate systems + G92 XYZ + probe
awareness) — **all shipped**. Future motion work (e.g. full 5-axis, additional probe cycles) would open
new issues under DD-010's discipline (explicit golden-regen + capability honesty).
