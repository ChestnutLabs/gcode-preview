# G-code Motion & Position-Command Coverage

**Status:** **Audit published** (issue #154, credits upstream
[xyz-tools/gcode-preview#179](https://github.com/xyz-tools/gcode-preview/issues/179), 2026-07-23).
**Updated 2026-07-25** for **E10 phase 1** (DD-010): `M82`/`M83`, `G90`/`G91`, and the `G92`
E-datum are now modeled.
**Updated 2026-11-12** (post-v0.23.0, #544 / #553): `( … )` comments on plain lines are ignored;
arcs and canned cycles that cannot be drawn exactly as written now carry a warning; under `G91` a
canned-cycle `Z` is measured from the `R` plane. See
[Moves drawn differently from what was written](#moves-drawn-differently-from-what-was-written).
**Updated 2026-11-12** (#189 corpus): `G20` is recorded but its coordinates are not converted to
millimetres ([#578](https://github.com/ChestnutLabs/gcode-preview/issues/578)).

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
| `G2` / `G3` | arc move (I/J/K center or R) incl. full circles, all planes | **honored** — an arc that cannot be drawn as written is drawn the nearest way and warned (see below); `P` turn counts other than 1 are not applied (`arc-turns-ignored`) | E2/E3, #157, #553 |
| `G81` / `G82` / `G83` | canned drilling cycles (+ `G80`, `G98`/`G99`, modal bare-`X`/`Y` repeat) | **honored** (DD-012 D5) — under `G91`, `Z` is incremental from the `R` plane, as in LinuxCNC (#553); `G84`–`G89` `unavailable` | `arc-cycle-disclosure.test.ts` |
| `G20` / `G21` | units inch / mm | **recorded, not converted** — after `G20` the IR header says `units: 'in'`, but coordinates stay in inches and the viewer does not scale them, so an inch file draws 25.4× too small on a millimetre bed ([#578](https://github.com/ChestnutLabs/gcode-preview/issues/578)) | `units` header; `corpus-cnc-plotter.test.ts` |
| `G28` | homing (position reset to origin) | **honored** | interpreter |
| `T0`–`T7` | tool select | **honored** | `tool` channel |
| **`G90` / `G91`** | **absolute / relative positioning** | **honored** (E10 phase 1, #155) — `positioningMode` capability | `motion-model.test.ts` |
| **`M82` / `M83`** | **extruder absolute / relative** | **honored** (E10 phase 1, #156) — delta-based classification, `extrusionMode` capability | `motion-model.test.ts` |
| **`G92`** | **set-position / datum** | **honored** (E10 phase 1 E-datum; **phase 3** X/Y/Z, #158) — datum shift when the position is known; a logical **resync** after a probe (see below), `coordinateSystem` capability | `motion-model.test.ts` |
| **`G53` / `G54`–`G59`** | **machine / work coordinate systems** | **honored** (E10 phase 3, #158) — active WCS + offsets (`G10 L2/L20`), `G53` one-shot machine-coord bypass, `coordinateSystem` capability | `motion-model.test.ts` |
| **`G31`** | **probe toward a target** | **honored** (E10 phase 3, #158) — endpoint is runtime-dependent; the probed axis is marked uncertain and disclosed (`probe-position-runtime-dependent`), never advanced to the un-reached commanded value | `motion-model.test.ts` |
| `G4` | dwell | n/a (not position-affecting) | — |
| `( … )` comments | text in parentheses on any line | **ignored**, as on `#`/`[ ]` lines (#544): `G1 X1 (then G1 X99)` moves to X1 only; an unclosed `(` comments out the rest of the line; a `;` inside the parentheses does not cut the line | `lexer-paren-comments.test.ts` |

## Moves drawn differently from what was written

Some arcs and cycles cannot be drawn exactly as written: a controller such as LinuxCNC would reject
them, while Marlin-style firmware draws them anyway. The parser draws them the nearest way and records a
warning in `ir.header.warnings` (also delivered with the `ready` event), so a viewer can say the
drawing is approximate. These codes are new after v0.23.0 (#553):

| Warning code | Raised when | What is drawn |
|---|---|---|
| `arc-radius-too-small` | a `G2`/`G3` `R` is smaller than half the chord | a half circle (the radius is raised to half the chord) |
| `arc-radius-degenerate` | an `R` arc's start and target are the same point | no arc (the centre is undefined); use I/J for a full circle |
| `arc-end-off-circle` | an I/J/K arc's target is not on the circle through its start | a spiral; the last segment jumps to the target |
| `arc-turns-ignored` | a `P` turn count other than 1 | a single sweep |
| `canned-cycle-missing-word` | a `G81`/`G82`/`G83` with no `Z` or `R`, and none set earlier | the cycle, with 0 for the missing word in the active distance mode (G90: plane 0; G91: an increment of 0, so the R plane is the current Z) |
| `canned-cycle-plane` | a canned cycle while `G18`/`G19` is active | the cycle, still drilling along Z in the XY plane |
| `unbalanced-paren-comment` | a `( … )` comment is never closed, or one is nested inside another (LinuxCNC rejects both) | the line as before: an unclosed `(` hides the rest of the line; a nested one closes at its matching `)`. Lines that start with a multi-letter command word (`EXCLUDE_OBJECT_START NAME=cube_(1`) or with `M117`/`M118`/`M486` (text arguments) are not checked |

Under `G91`, a canned cycle's `R` and `Z` are kept as the numbers written (as LinuxCNC does): a later
`G81` block, or a bare `X`/`Y` repeat, that leaves one out applies it again from its own current Z, so
with `G99` (or `G98` when the R plane is above the start Z) each hole's plane moves up by `R`. A `G98` cycle retracts to the higher of the start Z and the R plane.

The existing `arc-missing-center` warning (no I/J/K and no R: drawn as a straight move) is unchanged.
The bundled `mach3` demo file raises `arc-radius-too-small` for its `G02 … R0.255` arcs; its geometry
is unchanged.

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

## RS274NGC parametric programs (DD-017)

Beyond the fixed motion codes above, the interpreter executes the **RS274NGC programming layer** — the
way LinuxCNC / CAM output *computes* geometry (parameters, expressions, control flow, subroutines). It
engages only when a line uses `#`, `[`, or a leading O-word; every other file takes the ordinary path
and is **byte-identical**. Shipped in v0.18.0 (DD-017 phases 1–3). See the
[parametric-programs guide](../manual/concept-parametric-programs.md) for a worked example.

| Construct | Support | Disclosure on trouble |
|---|---|---|
| Parameters `#1`–`#5399`, `#<local>`, `#<_global>`; assignment; indirect `##`; computed `#[expr]` | **honored** | read-before-write → `0` + `rs274-uninitialized-param` |
| System parameters | read-only allow-list (current position `#5420`–`#5422`) | others → `0` + `rs274-unsupported-sysparam` |
| Expressions `[ … ]` — full operator/function set, **degree** trig, LinuxCNC `MOD`/`EQ` | **honored** | malformed → word dropped + `rs274-bad-expression`; non-finite result, or a non-finite operand of a comparison/logic operator or a `#[…]` index → `rs274-non-finite-value`; assignment to `#0`, a negative number or `#5400`+ → ignored + `rs274-readonly-param`; `ROUND` is half away from zero |
| `if` / `elseif` / `else` / `endif` | **honored** | — |
| `while` / `endwhile`, `do` / `while`, `repeat` / `endrepeat` | **honored** | total loop work capped → `rs274-iteration-limit` |
| `break` / `continue` | **honored** (innermost loop, frame-local) | outside a loop → `rs274-misplaced-control` |
| `sub` / `endsub`, `call [args]`, `return` — in-file, recursive, forward-referenceable | **honored** | recursion capped → `rs274-call-depth`; unknown sub → `rs274-unknown-sub`; redefined → `rs274-duplicate-sub` |
| External subprogram files (`M98 P…`, external `o<name> call`), persistent `.var` params, `return` values | **out of scope** | — |

**Bounds & honesty.** Two `ParseLimits` fields bound execution: `maxProgramIterations` (default
1,000,000) caps total loop work — charged per loop pass *and*, inside a loop or subroutine, per
statement, condition test, `call` argument, entered loop and 256 characters of text, so a large body,
a long `elseif` chain or an exponential recursive fan-out cannot exceed it — and `maxCallDepth` (default 50)
caps subroutine recursion. There is no `eval` and no I/O. Clean execution reports the
`parametricProgram` capability as `known`; any disclosure above drops it to `approximated`; a
non-parametric file reports `unavailable` — never a fabricated value. FDM / non-parametric input is
byte-identical (both golden suites unchanged). Design and the bounded-execution model:
[DD-017](../design/DD-017-rs274ngc-parametric-programs.md).

## Remaining gaps

The E10 motion-model gaps from the #154 audit are now all closed. Tracking issues: **#155** (G90/G91 +
G92 E), **#156** (M82/M83), **#157** (arc planes), **#158** (coordinate systems + G92 XYZ + probe
awareness) — **all shipped**. Future motion work (e.g. full 5-axis, additional probe cycles) would open
new issues under DD-010's discipline (explicit golden-regen + capability honesty).
