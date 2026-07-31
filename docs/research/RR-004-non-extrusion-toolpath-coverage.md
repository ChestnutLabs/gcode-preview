# RR-004 — Non-extrusion toolpath coverage (CNC mill / laser / pen plotter)

**Status:** Complete
**Author(s):** Nathaniel Chestnut
**Date:** 2026-07-28
**Owning Epic:** #189 (CNC / laser / plotter, non-extrusion toolpath coverage) · **Informs:** the reserved **DD-012** (non-extrusion move model + modal tool-state channels); **reconciles** RR-002 / #180 (advanced modal color modes) — one modal-channel mechanism, owned here

---

## 1. Question & the decision it informs

Non-extrusion G-code — diode/CO₂ **lasers** (LightBurn/GRBL, Marlin-laser), **CNC milling** (GRBL, LinuxCNC, Mach), and **pen plotters** (servo / Z-lift) — parses *geometry* correctly today but the FDM-shaped IR **mis-classifies the actual work**: with no extrusion `E` to key on, cut/burn/draw moves collapse into `Travel`, and tool state (spindle RPM, laser power, pen up/down) has nowhere to live. Two questions:

1. **Is non-extrusion toolpath in scope** — is this "a cross-vendor toolpath stack" or "FDM-excellent with honest degradation elsewhere"?
2. **If in scope, what *additive* IR / parser / dialect changes make it honestly supported without changing FDM behavior**, and how do we avoid over-claiming across a fragmented controller ecosystem?

**The scope decision is RESOLVED (maintainer, 2026-07-28): non-extrusion toolpath is IN SCOPE.** The deciding factor is validation capability, not appetite: the maintainer operates **real lasers**, and a partner shop operates **CNC tables**, so classification can be **validated against real machine behavior** rather than inferred from spec. That directly retires this epic's headline risk — *"false confidence about non-extrusion semantics."* This RR records that decision, audits current behavior, defines the honesty posture that keeps the claim safe, and recommends the shape of **DD-012**.

## 2. Candidates / versions / commits tested

- Repository: `ChestnutLabs/gcode-preview` @ `dev` (post-`v0.3.0`; this RR authored at `dev` HEAD).
- IR surface: `@chestnutlabs/toolpath-core` — `MoveKind` bitflag (`packages/toolpath-core/src/ir.ts:33`), `Confidence` (`ir.ts:14`), `ToolpathSegments` SoA (`ir.ts:96–120`).
- Dialect/annotation contract: `@chestnutlabs/gcode-dialects` — `AnnotationSink.addMoveKind` (allow-listed additive kinds, `sink.ts:27`), the E10 motion model (`extrusionMode`/`positioningMode`/`arcPlanes`/`coordinateSystem`, DD-010).
- Modal-channel precedent: RR-002 (advanced color modes), which already recommends *"the modal-channels DD and the CNC/laser DD (#189) be the same DD, or #189's DD own the mechanism."*
- No third-party code incorporated. LightBurn / GRBL / LinuxCNC / Mach referenced only as behavioral parity targets (observed machine output), no code or documentation text copied.

## 3. Environment & reproducible procedure

- Windows 11, repo working copy; IR-surface facts (§5.2–5.3) are static reads of committed source, host-independent.
- Current-behavior audit (§5.1) reproduces by parsing non-extrusion samples through the batteries worker and tallying `segments.kind` bitflags + populated channels — the same probe scripts recorded in the #189 research notes (real LightBurn/GRBL laser export + synthetic GRBL/LinuxCNC milling + Z-pen plotter).
- Free bit check: `MoveKind` occupies bits `0..6`; the next flag is `1 << 7` (see §5.2).

## 4. Fixture / corpus manifest

Tracked redistributable corpus today: `test-data/gcodes/` — `3DBenchy`, `calicat`, `easel`, `plant-sign`, `screw`, `vase` (FDM) and **`mach3.gcode`** (the single CNC-style file, an intentional documented divergence in the E10 identity-WCS corpus). **No committed laser / mill / plotter fixtures exist yet** — the audit evidence came from real + synthetic samples held as research notes, not tracked corpus.

**Governance:** user-provided design files (laser projects, CAM output tied to a real job) are **not** committed. The fixture plan (§8) is to derive **small, synthetic, redistributable** fixtures — minimal GRBL-laser / GRBL-mill / LinuxCNC / Z-pen files with *expected* move-kind and tool-state ground truth — validated for classification against the real machines but not themselves containing private design data.

## 5. Measurements & observable results

### 5.1 Current mis-classification (audit, directly observed in prior #189 probes)

| Sample | Productive moves classified as | Tool state | Notable loss |
|---|---|---|---|
| Laser (LightBurn/GRBL) | **100 % `Travel`**, 0 `Extrude` | dropped (`M4`/`S` power) | — |
| Milling (GRBL/LinuxCNC) | 17 `Travel` + 96 `ArcSegment\|Travel`, **0 `Extrude`** | dropped (`M3 S`) | **`G81` drill cycle → 0 geometry** |
| Plotter (Z-pen) | **100 % `Travel`** | dropped (pen up/down) | — |

**The foundation is sound:** arcs are faceted (E2/E10 arc-plane work), bounds are correct, and the capability model is *honest* — it reports `unavailable`, never a fabricated cut/extrude. The gap is semantic (what the move *is*), not geometric (where it goes).

### 5.2 IR headroom (directly observed)

`MoveKind` is a bitflag with the next flag free:

```
None:0  Extrude:1<<0  Travel:1<<1  Retract:1<<2  Unretract:1<<3
Wipe:1<<4  ArcSegment:1<<5  Seam:1<<6            → next free: 1<<7
```

So a `Cut` / `ToolEngaged` classification is **one additive bit** (`1 << 7`) that composes with `ArcSegment` exactly as `Wipe`/`Seam` already do (DD-016 precedent). No breaking change; FDM segments never set it.

### 5.3 The tool-state gap is the *same shape* as RR-002's modal channels (directly observed)

CNC/laser tool state is a **modal register set by a standalone command, stamped per segment, colored by a ramp, capability-gated when absent** — bit-for-bit the pattern RR-002 defined for fan/temp/accel/jerk/pressure-advance:

| Domain | Modal source | Value | Capability when absent |
|---|---|---|---|
| Laser power | `M3`/`M4` + `S` (and `M5` off) | 0–max (`S`) | `unavailable` |
| Spindle RPM | `M3`/`M4` + `S` (and `M5` off) | rev/min (`S`) | `unavailable` |
| Pen state | pen up/down (`M280` servo / `Z` lift) | up / down | `unavailable` |
| Fan / temp / accel … (#180) | `M106`/`M104`/`M204` … | scalar | `unavailable` |

One `ModalChannel` abstraction (id, source opcode(s), value type, capability key) serves **both** #189 tool-state and #180 color channels with no FDM-specific assumptions.

## 6. License / provenance concerns

None incorporated. Controller behaviors are observed parity references, not copied code/text. The `Cut`-bit classifier and canned-cycle geometry are standard G-code semantics, not novel or encumbered. `.rd` (Ruida/Trocen/TopWisdom DSP) and `.ezd` (EZCad galvo) are proprietary **non-G-code** binary formats — **explicitly out of scope** (they are a different motion model, not a gap in this one). Fixture corpus stays synthetic/redistributable (§4).

## 7. Limitations & unknowns

- **Dialect breadth is real and open-ended.** GRBL alone has many forks; LinuxCNC/Mach add more. The mitigation is the honesty tier (§8), not exhaustive coverage — an untested dialect is `unavailable`, never silently wrong.
- **Ground truth needs the hardware.** Classification correctness for a given controller is only `known` once validated on the real machine; until then it is `inferred`. The maintainer's laser + partner CNC cover the launch dialects; others start `inferred`/experimental.
- **Canned cycles vary by controller** (`G81`–`G89` parameter conventions, `G98`/`G99` retract planes differ). Expansion must be per-dialect and disclosed where a variant is unverified.
- **Pen plotters** split between servo (`M280`) and Z-lift conventions; both need a fixture. Inch-mode (`G20`) laser/CNC files are common and must be in the corpus.
- **Arc/`I`,`J` vs `R` and plane state** already handled by E10, but non-FDM files exercise `G18`/`G19` more — worth an explicit regression.

## 8. Recommendation & rejected alternatives

### Recommendation — scope IN; deliver additively as **DD-012**

1. **Additive move classification.** Add `MoveKind.Cut = 1 << 7` (§5.2). When the interpreter sees motion with **no `E` delta** while a **tool-engaged modal state** holds (spindle/laser on via `M3`/`M4`, pen down), classify the move `Cut` (composing with `ArcSegment`); rapids (`G0`, or motion with tool disengaged) stay `Travel`. FDM output is **byte-identical** — the bit is only ever set when `E` is absent and a tool-state channel is present.
2. **DD-012 owns the `ModalChannel` mechanism** (per RR-002 §8). An **opt-in**, per-channel modal register stamped onto a sparse/dense side array, requested via parse options so the **default FDM parse pays nothing and is unchanged**. Launch channels: **laser power** and **spindle RPM** (`S` under `M3`/`M4`/`M5`) and **pen state**. #180's fan/temp/accel/jerk/PA become **the same mechanism's FDM consumers** — build it once. (DD-015, the candidate #180 DD, collapses into DD-012 or becomes a thin consumer DD.)
3. **Canned-cycle expansion.** `G81`–`G89` (with `G98`/`G99` retract planes) expand to real geometry, per-dialect, disclosed where a variant is unverified.
4. **New dialect families**, each **honesty-tiered** (below): GRBL / Marlin-laser / GRBL-LPC (lasers); GRBL / LinuxCNC / Mach (milling); servo + Z-lift (plotters).
5. **Coloring** by laser power / spindle load / feed-vs-rapid — a `gcode-colors` consumer of the modal channel and the `Cut` bit (2D overlaps E8).

### The honesty posture that keeps the claim safe (validation tiers)

The capability model already carries `known | inferred | approximated | unavailable`. Apply it **per dialect/feature by validation level** — this is how "more fragile than FDM" is *disclosed*, not hidden:

| Validation level | Confidence |
|---|---|
| Verified on real hardware (maintainer laser / partner CNC) | **`known`** |
| Synthetic / spec-derived, not yet machine-verified | **`inferred`** + an **experimental** disclosure |
| Untested dialect | **`unavailable`** — parses geometry, refuses to classify |

Every non-extrusion claim ships with its tier surfaced (the same engine that already says `inferred` for `bed_shape` machine geometry). Non-extrusion is honestly labeled more fragile than FDM; users see exactly what is verified.

### Fixture / validation plan (the real-hardware moat)

Capture from the real machines, then commit **synthetic, redistributable** distillations with expected `kind`/tool-state ground truth: GRBL-laser (LightBurn export), GRBL + LinuxCNC milling (incl. a `G81` drill), Z-pen + servo plotter, an inch-mode (`G20`) variant. Golden-style assertions on classification; **no private design files committed** (§4). Real-machine runs are the acceptance evidence behind each `known` tier.

### Rejected alternatives

- **Stay FDM-only (honest degradation forever)** — rejected by the scope decision; the validation capability (real hardware) makes first-class support defensible where it would otherwise be reckless.
- **A bespoke non-FDM move model / parallel IR** — rejected: an additive `Cut` bit + modal channel composes with the existing IR; a second model would fork the renderer/capability/adapter surface.
- **Separate modal mechanisms for #189 (tool-state) and #180 (color channels)** — rejected: identical machinery (§5.3); two implementations would drift the IR. One mechanism, owned by DD-012.
- **Always-claim broad controller support** — rejected: dishonest across a fragmented ecosystem; the validation tier gates each claim instead.

### Suggested follow-up (on DD-012 acceptance)

- `feat(core): MoveKind.Cut + opt-in ModalChannel registers (laser power, spindle, pen)` — the shared mechanism.
- `feat(parser): canned-cycle (G81–G89) geometry expansion, per-dialect`.
- `feat(dialects): GRBL-laser + GRBL/LinuxCNC mill + pen-plotter families, validation-tiered`.
- `feat(colors): color-by-power / feed-vs-rapid` (consumer).
- Reconcile #180 / RR-002 as consumers of the DD-012 modal mechanism.

## 9. Reference specifications & parity sources

There is **no single specification for "CNC/laser G-code."** It is a forked standard: a small
standardized core that every controller extends incompatibly — which is why *dialect* is the correct
framing and why the honesty tier (§8), not a spec conformance claim, is the safety mechanism. The
authorities are **very unevenly distributed** across the two machine classes, and that distribution
directly determines what is spec-derivable versus hardware-only:

| Domain | Authority | Status | What it anchors |
| --- | --- | --- | --- |
| **CNC milling (core)** | **RS274NGC** — *NIST IR 6556, "The NIST RS274NGC Interpreter — Version 3"* (Kramer, Proctor, Messina, 2000) | Free NIST technical report | Motion modes, `G81`–`G89` canned cycles, coordinate systems (`G54`–`G59`), parameters `#`, expressions `[]`, O-word flow — the interpreter LinuxCNC implements |
| **CNC milling (formal)** | **ISO 6983-1** (NC program format & address words) | Paywalled (ISO); thinner than IR 6556 | The formal address-word grammar |
| **CNC milling (open, executable)** | **LinuxCNC G-code reference** | Free, online; **GPL/GFDL text** | RS274NGC as-implemented — the exact home of our gap list (O-words, `#params`, `[expr]`, `L`-repeat) |
| **Lasers** | **GRBL source + wiki** (`$32` laser mode, `M3` constant vs `M4` dynamic power) | Source/wiki only — **no standard** | The GRBL-laser power model |
| **Lasers (emitter)** | **LightBurn documentation** | No public spec | Observed post-processor output only |
| **Firmware / FDM cross-ref** | **RepRap G-code wiki** (Marlin/RRF/Klipper/Smoothie) | Community-maintained; not a standard | FDM parity (already the E-stack's reference) |

**Spec-derived vs. observed — the split that governs the tier (§8):**

- **CNC is spec-anchored.** The milling motion model, canned cycles, coordinate systems, parameters,
  and expressions are all defined in RS274NGC (IR 6556) and the LinuxCNC reference. Phase-7 gaps
  (O-word execution, `#params`, `[expressions]`, canned-cycle `L`-repeat) are documented features we
  have not yet implemented — **build them against the spec; hardware is the *check*, not the source.**
- **Lasers are not spec-anchored.** GRBL-laser is defined only by its source/wiki and LightBurn only by
  observed output. There is no authority to conform to, so **the machine *is* the source of truth** —
  this is where the hardware-validation moat (§8) does the real work.
- **Vendor extensions escape every spec.** Observed directly: the `mach3` plasma sample uses bare
  `S`-words for torch-height control (DTHC), where `S` is **not** spindle speed — nothing in RS274NGC
  covers this. Such cases are `inferred`/experimental by construction until a real machine confirms them.

**Provenance discipline (ties to §6):** these are cited as **behavioral parity targets** and as
pointers for *where a behavior is defined* — **not** as text to copy. ISO 6983 is copyrighted and the
LinuxCNC reference is GPL/GFDL, whereas this project is MIT; we implement *to the documented behavior*
and express it in our own code and words. No specification prose is incorporated.
