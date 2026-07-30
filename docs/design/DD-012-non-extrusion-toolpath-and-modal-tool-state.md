# DD-012 — Non-extrusion toolpath (CNC / laser / plotter) & modal tool-state channels

**Status:** **Accepted** <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Nathaniel Chestnut
**Date:** 2026-07-28 · **Last revised:** 2026-07-28
**Accepted:** 2026-07-28 — **D1–D8 as recommended.** `MoveKind.Cut` naming (D2); the **single shared `ModalChannel` mechanism** (D3) is owned here and #180/RR-002 consume it, so **DD-015 is retired**. Implementation unblocked per §14.
**Owning Epic:** #189 (non-extrusion toolpath coverage) · **Milestone:** Future
**Supersedes / Superseded by:** none
**Related:** [RR-004](../research/RR-004-non-extrusion-toolpath-coverage.md) (scope decision + audit — the gate this DD answers), [RR-002](../research/RR-002-modal-state-color-channels.md) + #180 (advanced modal color modes — **consumers** of the channel mechanism defined here; candidate DD-015 collapses into this), DD-001 (capability model + `MoveKind`), DD-010 (motion model this extends), DD-005 (dialect/adapter contracts), DD-016 (additive `MoveKind` bits precedent — `Wipe`/`Seam`), DD-014/E8 (2D rendering overlap), DD-003 (parser resource limits). Reserved number: DD-012 (#189).

---

> **Scope decision (RR-004, maintainer 2026-07-28): non-extrusion toolpath is IN SCOPE.** Defensible
> because it is **validated against real hardware** (maintainer laser + partner CNC tables), which
> retires the epic's headline risk. This DD is the *additive* design that makes CNC/laser/plotter
> honestly supported **without changing FDM behavior**.

---

## 1. Problem

Non-extrusion G-code parses *geometry* correctly but the FDM-shaped IR **mis-classifies the work**
(RR-004 §5.1): with no extrusion `E` to key on, cut/burn/draw moves collapse to `Travel`, tool state
(spindle RPM, laser power, pen up/down) has nowhere to live, and canned drilling cycles (`G81`–`G89`)
produce zero geometry. The foundation is sound — arcs faceted, bounds correct, capability model honest
(`unavailable`, never fabricated). The gap is **semantic**, and it is the same modal-register shape
that #180's advanced color modes need (RR-002 §5.3). This DD closes the semantic gap additively and
defines the one shared mechanism.

## 2. Scope

1. **Additive move classification** — a `MoveKind.Cut` bit for tool-engaged productive moves when `E`
   is absent.
2. **A `ModalChannel` mechanism** — opt-in per-segment modal registers, owned here, serving CNC/laser
   tool-state **and** #180's FDM color channels.
3. **Tool-state channels** — laser power, spindle RPM, pen state.
4. **Canned-cycle expansion** — `G81`–`G89` (+ `G98`/`G99`) drilling/boring → real geometry.
5. **Dialect families** — GRBL / LinuxCNC / Mach (mill), GRBL / Marlin-laser / GRBL-LPC (laser),
   servo/Z-lift (plotter), each carrying a **validation tier**.
6. **Rendering & coloring** — productive-vs-rapid rendering; color-by power / spindle / feed.
7. **Validation-tiered honesty** + a **synthetic, redistributable** fixture corpus backed by
   real-machine acceptance evidence.

## 3. Non-goals

- **Non-G-code formats:** `.rd` (Ruida/Trocen/TopWisdom DSP), `.ezd` (EZCad galvo) — proprietary binary,
  a different motion model, **not a gap in this one** (RR-004 §6).
- **G-code editing / CAM** — out (a slicer/editor concern).
- **Machining semantics beyond motion** — tool tables, offsets libraries, feeds-and-speeds advice,
  material models. We classify and visualize motion; we do not simulate machining.
- **Changing any FDM behavior.** FDM IR output must remain byte-identical (regression gate, §9).

## 4. Decisions

Decision points **D1–D8**, each with options and a recommendation for maintainer acceptance.

### 4.1 D1 — Placement: no new package (which existing packages change)

Unlike `.bgcode` (a new package), this is a set of **additive changes to existing packages**:

- **`toolpath-core`** — `MoveKind.Cut` bit; the `ModalChannel` type + optional SoA side-columns; capability keys.
- **`gcode-parser`** — modal registers + the fallback classifier + canned-cycle expansion (extends the DD-010 interpreter).
- **`gcode-dialects`** — GRBL/LinuxCNC/Mach/laser/plotter detection + tier declarations.
- **`gcode-colors`** — power/spindle/feed colorers (consumers).
- Renderers/adapters — capability-gated toggles only.

- **Option A (recommended): extend existing packages.** The move model is shared IR; a parallel package would fork the renderer/capability/adapter surface.
- **Option B: a `gcode-cnc` package.** Rejected — the semantics live in the *core* IR + parser + dialects, not a bolt-on.

### 4.2 D2 — Move classification: the `MoveKind.Cut` bit

`MoveKind` is a bitflag with the next flag free (`1 << 7`, RR-004 §5.2). Add:

```ts
Cut: 1 << 7   // tool-engaged productive move (cut / burn / draw) when no extrusion E is present
```

**Classifier (parser):** a move is `Cut` when it has **no `E` delta** *and* a **tool-engaged modal
state** holds (spindle on `M3`/`M4` with `S` > 0; laser on; pen down). Rapids (`G0`, or any move with
the tool disengaged / `M5` / pen up) stay `Travel`. Composes with `ArcSegment` exactly as `Wipe`/`Seam`
do (DD-016). **FDM is untouched:** `Cut` is only ever evaluated when `E` is absent — an FDM slice never
sets it, so its IR is byte-identical.

- **Option A (recommended): one `Cut` bit.** The *productive* move; the domain (laser/mill/pen) is known from the tool-state channel + dialect, so the bit needn't encode it.
- **Option B: per-domain bits** (`Burn`/`Mill`/`Draw`) — rejected: over-specific, burns three flags for one concept.
- **Naming sub-choice:** `Cut` (parallels `Extrude`, documented as "cut/burn/draw") vs `ToolEngaged` (domain-neutral). **Recommend `Cut`** for user familiarity; capture the neutral meaning in docs.

### 4.3 D3 — The `ModalChannel` mechanism (owned here; shared with #180) — the pivotal decision

Per RR-002 §8 and RR-004 §5.3, CNC/laser tool state and FDM's fan/temp/accel are the **same pattern**:
a modal register set by a standalone command, stamped per segment, colored by a ramp, capability-gated
when absent. Define **one** abstraction:

```ts
interface ModalChannel {
  id: string;            // 'laserPower' | 'spindle' | 'penState' | 'fan' | 'temp' | 'accel' | …
  sources: string[];     // opcodes that set it, e.g. ['M3','M4','M5'] (+ 'S' word), ['M106','M107']
  value: 'u8'|'u16'|'f32'|'enum';
  capabilityKey: string; // e.g. 'laserPower'
}
```

- **Opt-in** via parse options (`modalChannels: ['laserPower','spindle']`). The parser maintains the
  modal register only for requested channels and stamps a SoA side-column of length `segments.count`.
  **Default FDM parse requests none and pays nothing** — the decisive argument from RR-002 §5.3
  (~15 MB / 1 M segments if always-on).
- **Capability per channel:** `known` when the controlling opcode appears in the file; `unavailable`
  otherwise — never a fabricated `0` (DD-001 rule).
- **Ownership:** **DD-012 owns the mechanism.** #189's channels (`laserPower`, `spindle`, `penState`)
  and #180's channels (`fan`, `temp`, `accel`, `jerk`, `pressureAdvance`) are *instances* of it.

- **Option A (recommended): one shared `ModalChannel` subsystem, owned by DD-012, #180 consumes.** Build it once; the IR stays coherent.
- **Option B: separate mechanisms for tool-state (#189) and color (#180)** — rejected: identical machinery, guaranteed to drift.
- **Storage sub-choice:** dense typed side-column per requested channel (simple; opt-in *is* the memory gate) vs sparse run-length (smaller for step-function channels, more complex). **Recommend dense-when-requested** for v1; revisit sparse if a channel proves pathological.

### 4.4 D4 — Tool-state sources & machine-class detection

- **Laser / spindle:** `M3`/`M4` (on, CW/CCW) + `S` (power/RPM), `M5` (off). Same opcodes for both;
  the *interpretation* (Watts-ish power vs RPM) is a **presentation label** from the dialect, not a
  different channel.
- **Pen:** `M280` (servo angle) or a `Z`-lift threshold — a two-state `penState` channel.
- **Machine class** (`fdm` | `laser` | `mill` | `plotter`): a capability, **`inferred`** at best
  (LightBurn/GRBL header comments, `$32` laser-mode, absence of `E` with present `S`). **Do not gate
  behavior on machine class** — drive off the tool-state channel + `Cut` bit so a mis-detected class
  never produces wrong geometry.

- **Option A (recommended): tool-state-driven, machine-class as an `inferred` hint.**
- **Option B: hard machine-class switch** — rejected: brittle; a misread header would mis-render.

### 4.5 D5 — Canned cycles (`G81`–`G89`)

Expand drilling/boring cycles to real motion: rapid to `X`/`Y`, feed to `Z` depth, retract to the
`G98`/`G99` plane, honoring modal repetition. Currently they yield **zero geometry** (RR-004 §5.1).

- **Option A (recommended MVP): the common set** — `G81` (drill), `G82` (dwell), `G83` (peck),
  `G80` (cancel), with `G98`/`G99` retract planes; per-dialect parameter conventions. Others
  (`G84`/`G85`/`G86`/`G89`) disclosed `unavailable` (`canned-cycle-unhandled`) until validated.
- **Option B: full `G81`–`G89` now** — deferred; larger, and tapping/boring cycles vary more by controller.

### 4.6 D6 — Dialect families & **validation tiers**

Extend `gcode-dialects` detection; each dialect **declares its validation tier** (RR-004 §8):

| Tier | Meaning | Confidence |
|---|---|---|
| **Validated** | Verified on real hardware (maintainer laser / partner CNC) | `known` |
| **Experimental** | Synthetic / spec-derived, not machine-verified | `inferred` + experimental disclosure |
| **Detected-only** | Recognized but classification untested | `unavailable` (geometry only) |

- **Launch Validated:** GRBL-laser (LightBurn export), GRBL milling + LinuxCNC (partner CNC).
- **Launch Experimental:** Marlin-laser, Mach, Smoothieware, servo/Z-pen plotters — promote to
  Validated as hardware/fixtures land.
- **Option A (recommended): tiered per-dialect capability**, surfaced on every claim.
- **Option B: flat "CNC supported" flag** — rejected: dishonest across a fragmented ecosystem (the exact failure mode the scope decision guards against).

### 4.7 D7 — Rendering & coloring

- **Renderer:** `Cut` moves render as the productive path (as `Extrude` does today); `Travel` as
  rapids. No renderer geometry change — it already keys on `MoveKind`.
- **Colorers (`gcode-colors`, consumers of D3):** `color-by-laserPower`, `color-by-spindle`,
  `color-by-feed` (and `cut`-vs-`travel`), ramped like the `feedrate` precedent (#177), degrading to
  `fallback` on absent channels rather than fabricating.
- **2D (E8) overlap:** the "layer" concept is weak for CNC (`Z` is depth, not a print layer) — disclose
  via capability (`layers: 'unavailable'` for such files) rather than inventing layers.

### 4.8 D8 — Testing, fixtures & real-hardware validation

- **Synthetic, redistributable fixtures** with expected `kind`/tool-state ground truth: GRBL-laser,
  GRBL + LinuxCNC milling (incl. a `G81` drill), servo + Z-pen plotter, an inch-mode (`G20`) variant.
  **No private design files committed** (RR-004 §4).
- **FDM regression gate:** the existing FDM corpus IR must stay **byte-identical** (the `Cut` bit +
  channels are opt-in/absent for FDM) — a golden-equivalence assertion.
- **Real-machine acceptance:** every **Validated**-tier dialect is backed by a recorded real-hardware
  run (the evidence behind its `known`). Experimental tiers ship without it, clearly labeled.

## 5. Lifecycle

Parse options request move-model + channels → parser stamps `Cut` and the requested modal columns →
IR carries them capability-tagged → renderer/colorers consume them → dialect supplies the tier + labels.
FDM path unchanged when nothing non-extrusion is requested or present.

## 6. Errors & failure behavior

- Unknown/unverified canned cycle → geometry omitted for that cycle + a bounded `canned-cycle-unhandled`
  warning (never a silent wrong hole).
- Tool-state opcode with a malformed/absent `S` → channel stays `unavailable` for that span, not `0`.
- Conflicting modal state (e.g. `M3` then `M5` mid-move) resolves at segment boundaries; disclosed.
- All failures are bounded warnings on the capability surface — never fabricated classification.

## 7. Security & resource limits

No new input surface beyond G-code text (DD-003 limits apply). Modal columns are **opt-in**, bounding
memory. Canned-cycle expansion is bounded by the existing segment cap (a pathological repeat count
cannot exceed it). No new dependency, filesystem, or network.

## 8. Performance

- Default FDM parse: **zero** new cost (nothing requested/stamped).
- Each requested channel: one SoA typed column (`1`/`2`/`4` bytes × `count`, RR-002 §5.3) + O(1)
  per-move register update. Budget: requesting the two launch channels stays within the E8 low-resource
  envelope; measured in the exit benchmark.

## 9. Testing

- FDM **byte-identical** golden-equivalence (regression) — the primary guard.
- Per-fixture classification assertions (`kind` + tool-state) for each launch dialect.
- Canned-cycle geometry assertions (`G81`/`G82`/`G83`, `G98`/`G99`).
- Inch-mode (`G20`) + arc-plane (`G18`/`G19`) regressions on non-extrusion files.
- Real-machine validation runs recorded as acceptance evidence for Validated tiers.

## 10. Migration

Additive; no consumer migration. New `MoveKind.Cut`, new opt-in channels, new colorers, new dialects —
all behind capabilities. #180/RR-002 color modes **re-platform onto this DD's `ModalChannel`** (a code
consolidation, not a public break). Existing FDM consumers see no change.

## 11. Observability / diagnostics

Every non-extrusion claim carries its **validation tier** on the capability surface; machine-class is an
`inferred` hint; unhandled cycles/opcodes emit bounded warnings. The parser exposes which modal channels
were requested vs populated.

## 12. Alternatives considered

- **Stay FDM-only (honest degradation forever)** — rejected by the scope decision; real-hardware
  validation makes first-class support defensible.
- **A parallel non-FDM IR / move model** — rejected: additive `Cut` + `ModalChannel` composes with the
  existing IR; a fork multiplies the renderer/capability/adapter surface.
- **Separate modal mechanisms for #189 and #180** — rejected: identical machinery; drift-prone.
- **Flat "CNC supported" claim** — rejected: dishonest across a fragmented ecosystem.

## 13. Risks

| Risk | Mitigation |
|---|---|
| False confidence about non-extrusion semantics | **Validation tiers** — `known` only when machine-verified; the scope decision's core guard |
| Dialect breadth is open-ended | Tier untested dialects `unavailable`; promote only with hardware/fixtures |
| Canned-cycle variants differ by controller | MVP subset + per-dialect params; unhandled → disclosed, not guessed |
| Accidental FDM regression | Byte-identical golden-equivalence gate on the FDM corpus |
| Channel memory on huge CNC files | Opt-in columns; measured against the E8 envelope |
| Machine-class mis-detection | Behavior driven by tool-state + `Cut`, not by class; class is only an `inferred` hint |

## 14. Phased delivery

1. **Move model + `ModalChannel` mechanism** (`toolpath-core` + `gcode-parser`): `MoveKind.Cut`, the
   fallback classifier, opt-in modal registers with `laserPower`/`spindle`/`penState`. **Re-platform
   #180/RR-002 channels onto it** (the shared-mechanism payoff).
2. **Canned-cycle expansion** (`G81`/`G82`/`G83` + `G80` + `G98`/`G99`), per-dialect.
3. **Dialect families + tiers** (`gcode-dialects`): GRBL-laser + GRBL/LinuxCNC mill **Validated**;
   Marlin-laser/Mach/Smoothieware/plotter **Experimental**.
4. **Rendering & coloring** (`gcode-colors` + renderer gates): power/spindle/feed colorers; cut-vs-rapid.
5. **Compatibility matrix + docs + support-policy** — the tiers, per dialect, dated and evidenced.
6. **Exit** — real-hardware validation evidence for Validated tiers; low-resource benchmark; FDM
   byte-identical confirmed.

## 15. Acceptance criteria

- [x] D1–D8 decided by the maintainer (2026-07-28, as recommended); DD marked Accepted.
- [ ] FDM corpus IR **byte-identical** vs pre-DD (regression gate green).
- [ ] `MoveKind.Cut` + the fallback classifier correctly classify the launch fixtures; validated on real
      hardware for the **Validated** dialects.
- [ ] One `ModalChannel` mechanism serves both tool-state (#189) and #180's color channels; #180
      re-platformed onto it.
- [ ] `G81`/`G82`/`G83` (+ `G98`/`G99`) produce correct geometry; unhandled cycles disclosed.
- [ ] Every non-extrusion claim surfaces its **validation tier**; untested dialects are `unavailable`,
      never silently wrong.
- [ ] Compatibility matrix + support-policy updated with dated, evidenced tiers.
- [ ] Synthetic redistributable fixtures only; real-machine runs recorded as acceptance evidence.

## 16. Reference specifications & parity sources

There is **no single specification for "CNC/laser G-code"** — it is a forked standard whose authorities
are unevenly distributed across the two machine classes. That distribution is not trivia; it decides
**what D5/D6 can derive from a spec versus what only hardware can confirm** (RR-004 §9 records the full
survey). Cited as **behavioral parity targets** and pointers to *where a behavior is defined* — never as
text to copy (ISO 6983 is copyrighted; the LinuxCNC reference is GPL/GFDL; this project is MIT).

| Domain | Authority | Anchors |
| --- | --- | --- |
| CNC milling (core) | **RS274NGC — NIST IR 6556** (Kramer/Proctor/Messina, 2000; free) | Motion modes, `G81`–`G89` (D5), `G54`–`G59`, `#params`, `[expr]`, O-words |
| CNC milling (formal) | **ISO 6983-1** (paywalled) | Address-word grammar |
| CNC milling (executable) | **LinuxCNC G-code reference** (free; GPL/GFDL) | RS274NGC as-implemented — home of the phase-7 gap list |
| Lasers | **GRBL source + wiki** (`$32`, `M3`/`M4`) — no standard | The GRBL-laser power model (D4) |
| Lasers (emitter) | **LightBurn docs** — observed output only | Post-processor fingerprints (D4/D6) |
| FDM cross-ref | **RepRap G-code wiki** — community, not a standard | E-stack parity |

**The split that governs the validation tier (D6):**

- **CNC is spec-anchored.** D5 canned cycles, coordinate systems, and the phase-7 gaps (O-word
  execution, `#params`, `[expressions]`, `L`-repeat) are documented in RS274NGC / LinuxCNC — build them
  **to the spec**, with hardware as the *check*. A spec-derived-but-unverified controller is still
  `Experimental`/`inferred` (D6) until a real run confirms it.
- **Lasers are not spec-anchored.** GRBL-laser and LightBurn are source/observed only, so **the machine
  is the source of truth** — this is where the hardware-validation moat (D8) does the real work.
- **Vendor extensions escape every spec.** E.g. the `mach3` plasma sample overloads bare `S` for
  torch-height control (not spindle speed); nothing in RS274NGC covers it, so it is `inferred` by
  construction. D4's rule — drive behavior off the tool-state channel + `Cut` bit, never off machine
  class — is what keeps such cases from producing wrong geometry.

## Decision log

| Date | Decision | By |
|---|---|---|
| 2026-07-28 | DD-012 drafted as **Proposed**; decision menu D1–D8 open. Follows RR-004 (scope IN, validated by real hardware) and unifies the modal-channel mechanism with RR-002/#180. | Chestnut Labs |
| 2026-07-28 | **Accepted — D1–D8 as recommended.** D1 no new package; D2 `MoveKind.Cut` bit; **D3 one shared opt-in `ModalChannel` mechanism owned here, #180/RR-002 consume it → DD-015 retired**; D4 tool-state-driven with machine-class an `inferred` hint; D5 canned-cycle MVP (`G81`/`G82`/`G83` + `G80` + `G98`/`G99`); D6 validation-tiered dialects; D7 reuse renderer + ramped colorers; D8 synthetic fixtures + FDM byte-identical gate + real-machine acceptance. | Maintainer |
| 2026-07-29 | **Editorial (no decision change):** added §16 reference specifications & parity sources (RS274NGC/NIST IR 6556, ISO 6983, LinuxCNC, GRBL, LightBurn, RepRap) making the **spec-anchored CNC vs. observed-only laser** split explicit — it grounds D5/phase-7 in RS274NGC and reaffirms why lasers stay hardware-gated under D6/D8. Full survey in RR-004 §9. Provenance: parity targets only, no spec text copied. | Chestnut Labs |
