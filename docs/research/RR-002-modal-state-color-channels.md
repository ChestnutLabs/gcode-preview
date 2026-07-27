# RR-002 — Advanced color modes via modal-state channels (fan / temp / accel / jerk / pressure-advance / flow)

**Status:** Complete
**Author(s):** Nathaniel Chestnut
**Date:** 2026-07-27
**Owning Epic:** E9 (annotations & renderer options, #162) · **Informs:** a new "modal state channels" DD (candidate **DD-015**, or merged into the reserved CNC/laser DD for #189 — see §8), and issue #180

## 1. Question & the decision it informs

OrcaSlicer's preview offers color-by **fan speed, temperature, acceleration, jerk, pressure advance**, and **flow / line width**. We support `single` / `tool` / `feature` / `colorChange` / `feedrate` / `object` (`gcode-colors`, `ColorMode`). The question this RR answers, so a DD can be scoped:

1. **Which of these channels are derivable from the IR we already build, and which need new parsing?**
2. **What does the not-yet-tracked data cost** (per-segment memory, parse work), and how should it be gated so default FDM parsing is unchanged?
3. **Is this the same problem as the CNC/laser tool-state gap (#189)** — i.e. should one design serve both?

The decision it informs: *do we add N bespoke color modes, or one capability-gated "modal state channels" subsystem?* This RR recommends the latter and scopes it.

## 2. Candidates / versions / commits tested

- Repository: `ChestnutLabs/gcode-preview` @ branch `dev` (this RR authored at `dev` HEAD, post-#184).
- IR shape: `@chestnutlabs/toolpath-core` `ToolpathSegments` (SoA), `packages/toolpath-core/src/ir.ts`.
- Color subsystem: `@chestnutlabs/gcode-colors` `ColorMode` + `createSegmentColorer`, `packages/gcode-colors/src/colors.ts` (the `feedrate` mode, #177, is the working precedent for a ramped scalar channel).
- Capability vocabulary: `Confidence = 'known' | 'inferred' | 'approximated' | 'unavailable'` (`ir.ts:14`), surfaced as `capabilities: Record<string, Confidence>`.
- No third-party code incorporated; OrcaSlicer is referenced only as a feature-parity target (behavioral observation, no code/text copied).

## 3. Environment & reproducible procedure

- Windows 11, repo working copy; measurements are static corpus counts, host-independent.
- Prevalence of each modal M-code across the tracked G-code corpus:

```bash
for code in M106 M107 M104 M109 M140 M190 M204 M205 M900 M221 M572; do
  files=$(grep -rlE "^${code}\b" test-data/gcodes/ | wc -l)
  total=$(grep -rhE "^${code}\b" test-data/gcodes/ | wc -l)
  printf "%-6s files=%-3s totalLines=%s\n" "$code" "$files" "$total"
done
```

- Cost basis (per-segment channel size) is read directly off the SoA column types in `ir.ts`.

## 4. Fixture / corpus manifest

Tracked MIT/redistributable corpus only — `test-data/gcodes/`: `3DBenchy.gcode`, `calicat.gcode`,
`easel.gcode`, `mach3.gcode`, `plant-sign.gcode`, `screw.gcode`, `vase.gcode` (7 files; FDM slicer
output plus two CNC-style files). No private corpus data, paths, or identifiers.

## 5. Measurements & observable results

### 5.1 Modal M-code prevalence (directly observed)

| M-code | Channel | Files (of 7) | Total occurrences | Character |
|--------|---------|:---:|:---:|---|
| M204 | acceleration | 5 | **7831** | **Per-move** — set continuously; rich per-segment variation |
| M104/M109 | hotend temp (set / set+wait) | 5 | 20 / 7 | **Set-once-ish** — a handful of transitions per print |
| M106/M107 | fan (set / off) | 5 | 12 / 15 | **Sparse** — but the transitions are semantically meaningful (bridges/overhangs) |
| M140/M190 | bed temp | 5 | 10 / 5 | Set-once; irrelevant to per-segment color |
| M205 | jerk / max-speed-change | 5 | 10 | Sparse |
| M221 | flow-rate override (%) | 2 | 4 | Sparse override on top of `e` |
| M900 | pressure advance (Marlin) | 1 | 2 | Rare in this corpus |
| M572 | pressure advance (RRF/Klipper-ish) | 2 | 6 | Rare |

**Inference from the above:** acceleration is the only channel with genuinely dense per-segment
variation in real slices; fan/temp/jerk/PA are mostly step functions with a few transitions. That does
**not** make them worthless (a fan-speed step at a bridge is exactly what a user wants to *see*), but it
means their color value is "highlight the transitions," not "smooth gradient," and it argues against
always-on storage for channels a given file barely uses.

### 5.2 Derivable-vs-new-parsing (directly observed from the IR surface)

The IR already carries, per segment: `x0..z1`, `e` (extrusion delta), `feedrate` (mm/min), `kind`,
`tool`, `layer`, `feature`, `object`, `srcByte` (`ir.ts:96–120`). From these:

| OrcaSlicer channel | Derivable today? | How / what's missing | Honest confidence |
|---|---|---|---|
| **Flow (extrusion density)** | **Yes, free** | `e / segLen` where `segLen = hypot(dx,dy,dz)` — mm of filament per mm of travel; a direct proxy for line cross-section | `known` (pure function of present columns) |
| **Volumetric flow (mm³/s)** | **Yes, with one constant** | `filamentArea × e / segLen × (feedrate/60)`; `filamentArea` from filament diameter (slicer comment, else 1.75 mm default) | `known` when diameter parsed; `approximated` on the default |
| **Line width** | Partly | needs flow **and** a layer-height model (`layers[].z` deltas give height); width = area/height with an idealized rectangular+capsule model | `approximated` |
| **Acceleration** | No | needs M204 modal register stamped per segment | new channel |
| **Fan speed** | No | needs M106/M107 modal register | new channel |
| **Temperature** | No | needs M104/M109 modal register | new channel |
| **Jerk** | No | needs M205 modal register | new channel |
| **Pressure advance** | No | needs M900/M572 modal register | new channel |

So **2 of OrcaSlicer's channels (flow, volumetric flow) are already derivable** with zero new parsing
and can ship as `gcode-colors` colorers immediately; **line width is derivable but approximated**; the
remaining **five need a modal register in the parser**.

### 5.3 Cost of the new channels (directly observed from column types)

Each modal channel is one SoA typed array of length `segments.count`. Worst-case for a 1 M-segment print:

| Channel | Natural type | Bytes/segment | 1 M-segment cost |
|---|---|:---:|:---:|
| fan (0–255) | Uint8 | 1 | 1 MB |
| temp (°C, ≤ ~65535) | Uint16 | 2 | 2 MB |
| acceleration (mm/s²) | Float32 | 4 | 4 MB |
| jerk (mm/s) | Float32 | 4 | 4 MB |
| pressure advance | Float32 | 4 | 4 MB |

All five always-on ≈ **15 MB per million segments** on top of today's ~13 columns — material for the
low-resource target E8 just shipped for. This is the decisive argument for **opt-in** channels, not
always-on columns.

## 6. License / provenance concerns

None. OrcaSlicer is a parity reference only (observed feature list); no code or documentation text is
incorporated. Corpus is the existing redistributable set. The derivations (flow, volumetric flow) are
standard G-code arithmetic, not novel or encumbered.

## 7. Limitations & unknowns

- Prevalence is measured on 7 files; it establishes *character* (per-move vs step-function), not
  population statistics. A file that ramps fan per-layer (adaptive cooling) would shift fan toward
  "rich," but the storage design is unaffected because it is opt-in.
- Filament diameter sourcing for volumetric flow is per-slicer; where absent, the 1.75 mm default makes
  the scale `approximated`, not `known`. Colorers must surface that (as `feedrate` mode already
  degrades NaN → fallback rather than fabricating a value).
- Line-width fidelity depends on an extrusion model this project does not yet have; treat as a later,
  clearly-`approximated` mode, not a launch item.
- M221 (flow-rate %) and firmware-specific PA opcodes (M572 vs M900) mean the parser needs a small
  per-firmware alias table; not hard, but it is real dialect surface (DD-005 territory).

## 8. Recommendation & rejected alternatives

### Recommendation

**Do not add seven bespoke color modes.** Introduce **one capability-gated "modal state channels"
subsystem**, and split delivery by cost/evidence:

1. **Phase A — derived flow, free (no DD-blocking parser work):** add `flow` (extrusion density
   `e/segLen`) and `volumetricFlow` colorers to `gcode-colors`, ramped exactly like the `feedrate`
   mode (#177) — auto-ranged, `fallback` on degenerate/zero-length segments, capability `flow: 'known'`
   / `volumetricFlow: 'known' | 'approximated'`. This lands two OrcaSlicer-parity modes with only
   `gcode-colors` + renderer wiring, no IR change.
2. **Phase B — generic modal channels (the DD):** an **opt-in** `ModalChannel` mechanism. The parser
   maintains a modal register per requested channel and stamps it onto a sparse/dense side array;
   requested via parse options so the **default FDM parse is byte-for-byte unchanged and pays nothing**.
   Each channel publishes a capability: `known` when the controlling M-code appears in the file, else
   `unavailable` — never a fabricated 0 (DD-001 rule). Prioritize **acceleration** (proven dense signal)
   and **fan** (the canonical "show me the bridges" use case); ship temp/jerk/PA behind the same
   mechanism, enabled on demand.
3. **Line width:** a later `approximated` mode gated on an explicit extrusion model; not in the first DD.

### Why one subsystem, shared with #189 (CNC/laser)

CNC/laser tool state — **spindle RPM** (`S` under `M3/M4`) and **laser power** (`M3/M4/M5` + `S`) — is
the *identical* pattern: a modal register set by a standalone command and stamped per segment, colored
by a ramp, capability-gated when absent. A `ModalChannel` abstraction (id, register source opcode(s),
value type, capability key) serves fan/temp/accel/jerk/PA **and** spindle/laser with no FDM-specific
assumptions. **This RR recommends the modal-channels DD and the CNC/laser DD (#189) be the same DD**, or
that #189's DD own the mechanism and #180's channels be its first FDM consumers.

### Rejected alternatives

- **Always-on columns for all five channels** — rejected: ~15 MB/1 M segments, directly against the
  E8 low-resource goal, to store data most files barely vary.
- **Seven independent color modes with ad-hoc parsing each** — rejected: duplicates the modal-register
  logic five-plus times and re-solves the same problem again for #189.
- **Derive everything** — rejected: only flow/volumetric-flow/line-width are derivable; fan/temp/accel/
  jerk/PA are not recoverable from positions+extrusion and genuinely require parsing.

### Suggested follow-up issues (on DD acceptance)

- `feat(colors): color-by-flow + volumetric-flow (derived)` — Phase A, no IR change.
- `feat(parser): opt-in ModalChannel registers (accel, fan first)` — Phase B, behind the DD.
- Reconcile with #189 so spindle/laser register on the same mechanism.
