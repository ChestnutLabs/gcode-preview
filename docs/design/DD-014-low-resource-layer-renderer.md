# DD-014 — Low-Resource Layer Mode (2D/Adjacent-Layer Renderer over ToolpathIR)

**Status:** **Proposed** <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Chestnut Labs
**Date:** 2026-07-25 · **Last revised:** 2026-07-25
**Owning Epic:** **E8 — Low-Resource Layer Mode** (#9) · **Milestone:** Future
**Supersedes / Superseded by:** none
**Related:** DD-001 (ToolpathIR + capability model — the SoA geometry, `layers` table, and floating origin this renderer consumes **unchanged**), DD-002 (package boundaries & public-API versioning — where a 2D renderer sits and what it may import), DD-004 (Three.js renderer, geometry builders, layer clipping & quality modes — the 3D sibling whose IR-consumption pattern and public option surface this mirrors), DD-006 (progress mapping — a 2D view still honors the live-progress cut/marker), DD-007 (framework adapters — the `<GcodePreview>` surface that selects the renderer), DD-008 §4.8 (roadmap note: pure-Node GPU-less still rendering as the deferred E8-class capability); the E3 renderer benchmark (`tools/benchmark/results/e3-renderer-benchmark-2026-07-22.md`) and the E0 reference comparison (RR-001, Fluidd's 2D resource strategy).

---

> **Why a DD, and why now.** Epic E8 (#9) has always been **gated**: *"separate DD; blocked until a
> stable `ToolpathIR` and real device-need evidence exist."* The first condition is now met — the IR is
> stable and complete through E10 (parser, dialects, containers, live progress, motion model), and the
> 3D renderer (E3/DD-004) has shipped and been benchmarked. This DD proposes the **design** of the
> low-resource mode so it is ready to build the moment the second condition — device-need evidence — is
> satisfied, and it puts the **evidence question itself** to the maintainer as an explicit decision
> (D6) rather than letting it block indefinitely.

> **This is a proposal awaiting acceptance.** No package, renderer, or adapter code is written until
> D1–D6 are decided. In particular, nothing is built before D6 resolves the evidence gate.

---

## 1. Problem

The E3 Three.js renderer (DD-004) is the right default — tubes/lines, layer clip, scrub, WebGL
context-loss recovery — but it assumes a **WebGL-capable GPU and enough memory to hold per-layer
geometry chunks**. Three real contexts fall outside that assumption:

1. **Old / low-end mobile** — phones and tablets with weak or driver-flaky WebGL, where a large model's
   chunked geometry exhausts memory or the GPU stalls.
2. **Embedded printer UIs** — the small SBC-class touchscreens on printers and in Fluidd/Mainsail-class
   web UIs, where a full 3D scene is overkill and a **current-layer 2D view** is what operators actually
   use while printing.
3. **Strict/blocked WebGL** — locked-down browsers or environments where WebGL is unavailable but a
   2D canvas is not.

The inherited/upstream world and adjacent tools (Fluidd) answer this with a **2D layer view**: draw the
current layer (optionally with an adjacent "ghost" layer) on a plain canvas. The outcome E8 wants is
the same capability **over the same `ToolpathIR`** — one parse, one IR, a second lightweight view — so
low-resource devices get an honest preview without a second parser path or a fork of the pipeline.

## 2. Scope

- A **2D current/adjacent-layer renderer** that consumes the existing `ToolpathIR` (SoA geometry +
  `layers` table + capabilities) and draws to a low-cost surface.
- **Low-resource mode selection and UX**: how a consumer opts into it (or is steered into it), and the
  minimal interaction set (layer up/down, current-layer highlight, live-progress marker).
- The **public option surface** on the framework adapters that chooses 2D vs 3D.

## 3. Non-goals

- **A second parser path.** The 2D renderer consumes the IR the worker parser already produces; it never
  re-reads raw G-code (E8 issue non-goal, verbatim).
- **Replacing the 3D renderer.** 3D (DD-004) stays the default; 2D is an *additional*, opt-in view.
- **3D features in 2D** — perspective, tubes, arbitrary orbit. A 2D layer view is intentionally flat
  (top-down per layer); non-XY content is out of scope for this mode.
- **Pure-Node GPU-less *still* rendering** (DD-008 §4.8) — a related but distinct deferred capability
  (server thumbnails without a browser); this DD is about an interactive low-resource *viewer*. If both
  are wanted, the 2D canvas core here is the natural substrate, but the still-render entry point is its
  own follow-up.
- **A device-capability oracle.** Auto-selecting 2D vs 3D from probed device signals is a D5 option, not
  a goal; the safe default is consumer-chosen.

## 4. Decisions

Marked **D1–D6**, each with options and a recommendation. D6 (the evidence gate) governs whether any of
the rest is built now.

### 4.1 D1 — Rendering technology

- **Option A (recommended): Canvas 2D (`CanvasRenderingContext2D`).** No GPU, tiny memory footprint,
  universally available, trivial to draw polylines per layer. The natural fit for "low-resource" and
  for embedded UIs. Redraw-on-change is cheap because only one (or two) layers are drawn at a time.
- **Option B: minimal WebGL (line primitives, no tubes).** Lighter than the full 3D scene but still
  needs WebGL — which is exactly what some target devices lack. Rejected as the primary path (it does
  not serve the WebGL-blocked context) but noted as a possible high-layer-count optimization later.
- **Option C: SVG.** Clean and stylable, but DOM-node-per-segment blows up for large layers. Rejected.

**Recommendation: Option A (Canvas 2D).** It is the only choice that serves *all three* target contexts,
and it keeps the memory ceiling near the size of one layer's segments.

### 4.2 D2 — Layer model

- **Option A (recommended): current layer + optional adjacent "ghost" layer(s).** Draw the active layer
  in full color and the previous layer dimmed (Fluidd's strategy), configurable to N adjacent layers.
  Gives depth cues without a 3D scene and matches operator expectations.
- **Option B: current layer only.** Simplest and lightest; acceptable as the default when even one extra
  layer is too much. Recommended as the *floor*, with the ghost layer as an opt-in.

**Recommendation: Option A with a 0-adjacent floor.** Ship current-layer with an `adjacentLayers`
count (default 1, settable to 0). Uses the IR `layers` table directly — the same layer-range machinery
DD-004's clip uses.

### 4.3 D3 — IR consumption (no IR change)

The 2D renderer reads the **existing** IR: `segments.{x0,y0,x1,y1,layer,kind,...}`, the `layers` table
(`{z, segStart, segEnd}`), the floating origin, and the capability map. Layer selection is a slice of
segment indices by `layer`; extrude/travel styling reuses `moveKind`; feature/tool/feedrate coloring
reuses the same `colors.ts` logic (the color computation is renderer-agnostic — a per-segment RGB from
the IR). **No IR schema change, no parser change.** Confirming this is the crux of the "one IR, two
views" outcome.

- **Option A (recommended): consume the IR read-only, share `colors.ts`.** Factor the per-segment color
  function so both renderers call it (small refactor in `gcode-renderer-three` or a shared module).
- **Option B: duplicate a minimal color mapping in the 2D renderer.** Rejected — drift risk; the color
  contract (capability-gated, honest fallback) must stay single-sourced.

**Recommendation: Option A** — the color/kind semantics are shared, the geometry consumption is a thin
2D projection of the SoA.

### 4.4 D4 — Package placement (DD-002)

- **Option A (recommended): a new package `@chestnutlabs/gcode-renderer-2d`.** A sibling of
  `gcode-renderer-three`, depending only on `toolpath-core` (and a shared color module) — **no `three`,
  no framework**. Keeps the 3D renderer's `three` peer dependency off low-resource consumers entirely (a
  2D-only bundle never ships Three.js). The 11th lockstep package.
- **Option B: a 2D entry inside `gcode-renderer-three`.** Avoids a new package but drags the `three` peer
  into a "low-resource" import — the opposite of the goal. Rejected.
- **Option C: fold the 2D view into `gcode-preview-core`.** Muddies the controller's framework-neutral
  role (DD-007 §4.6) and couples rendering into the controller. Rejected.

**Recommendation: Option A.** A dedicated dependency-light package is what lets a low-resource consumer
install a viewer that never pulls Three.js. The shared color module is extracted to avoid a
2d→three dependency (2D must not depend on the 3D renderer).

### 4.5 D5 — Mode selection & adapter surface (DD-007)

- **Option A (recommended): an explicit `renderer: '3d' | '2d'` (or `mode`) prop on `<GcodePreview>`,
  default `'3d'`.** The controller (`gcode-preview-core`) picks the renderer implementation behind its
  existing renderer-agnostic interface; adapters just pass the prop through. Consumer-chosen, honest,
  no surprise.
- **Option B: auto-detect (probe WebGL support / device memory) and fall back to 2D.** Convenient but a
  device-capability oracle is fragile and can mis-serve; offer it only as an opt-in
  `renderer: 'auto'` value layered on top of A, never the default.
- **Option C: a separate `<GcodePreview2D>` component.** Rejected — duplicates the prop surface and
  breaks the "same component, capability-honest" story.

**Recommendation: Option A**, with `'auto'` (Option B) as an optional additive value. The controller's
public interface already abstracts "a renderer"; 2D slots in behind it, so scrub/layer/progress/color
props keep working. Where the 2D view genuinely cannot honor a prop (e.g. a non-XY/CNC file, or a 3D-only
option), it discloses via the capability/`error` channel — never renders fabricated geometry.

### 4.6 D6 — Evidence gate & phasing (the blocker)

E8's own gate requires **real device-need evidence**. That evidence does not yet exist as telemetry —
E5 progress telemetry proved the *progress* pipeline, not a 2D-renderer demand. This DD must not let the
gate block indefinitely, nor build a package on a hunch. Options:

- **Option A (recommended): accept the *design* now; gate *implementation* on a lightweight evidence
  step.** Mark D1–D5 accepted so the design is settled, but require, before phase 1 ships, one concrete
  evidence artifact — e.g. an AnyBridge/consumer request, a measured 3D-renderer failure on a target
  device class, or a benchmark showing the 3D memory ceiling exceeded on a representative low-end device.
  This is the same "evidence before build" discipline E2–E7 used for their §8 budgets.
- **Option B: build a minimal opt-in 2D view now regardless.** The IR-reuse design is genuinely
  low-risk (no IR/parser change, a dependency-light package), so an opt-in `renderer: '2d'` could ship
  as an experiment and *gather* the evidence. Faster to a usable feature; weaker adherence to the
  stated gate.
- **Option C: keep E8 fully deferred.** Accept this DD as the durable design record and revisit when
  evidence arrives. Lowest effort; leaves low-resource users unserved for now.

**Recommendation: Option A.** Settle the design (so it is not re-litigated later), and pair it with a
named, cheap evidence trigger for the build. This respects the gate the epic set for itself while
removing the "blocked on an unwritten DD" impasse.

## 5. Lifecycle

On acceptance: record D1–D6; if D6-A/B, open E8 phased implementation issues (2D canvas core over IR →
layer/adjacent model → adapter `renderer` prop wiring → benchmarks/UX). If D6-C, this DD stands as the
accepted design and E8 stays deferred with the evidence trigger noted. Any implementation is a new
lockstep package (D4-A) with its own build, tests, and Changeset, following the E-epic rhythm.

## 6. Errors & failure behavior

- **Honest capability degradation (DD-001).** A 2D layer view cannot represent non-XY/CNC toolpaths or
  3D-only options; it discloses this (capability/`error`) and shows what it *can* (the XY projection of
  the active layer), never fabricated geometry.
- **No layer index → graceful base view.** When `capabilities.layers` is `unavailable` (non-planar), the
  2D view falls back to drawing the single base layer / all-segments with a disclosed note, mirroring the
  IR's own honesty.
- **Bounded like the 3D renderer.** Drawing is O(active-layer segments); memory stays near one layer, so
  the low-resource promise holds even for large files.

## 7. Security & resource limits

No new untrusted-input surface — the 2D renderer consumes the already-parsed, already-bounded IR (the
parser's `ParseLimits` did the untrusted-input work). Canvas 2D has no shader/WebGL attack surface. The
memory ceiling is the point of the feature: bounded to the active (± adjacent) layer, not the whole model.

## 8. Performance

The budget is the inverse of DD-004's: **memory and redraw cost on low-end devices.** Targets to derive
from the evidence step (D6): peak memory below a stated ceiling on a representative low-end device class,
and layer-change redraw under an interaction budget (e.g. < 16 ms for a typical layer). Measured on a
real target device, not invented — the same rule as every prior epic's §8.

## 9. Testing

- **IR-consumption unit tests** — layer slicing, adjacent-layer selection, extrude/travel styling, shared
  color mapping parity with the 3D renderer (same IR → same per-segment RGB).
- **Canvas draw tests** (happy-dom / canvas mock) — correct polyline emission per layer, ghost dimming,
  progress marker placement (DD-006).
- **Capability-honesty tests** — non-XY/CNC and `layers: unavailable` inputs disclose rather than
  fabricate.
- **Low-resource benchmark** (D6/§8) — memory ceiling + redraw on a target device class.

## 10. Migration

Purely additive: a new opt-in renderer + one adapter prop (default `'3d'`), no change to the IR, parser,
3D renderer, or existing adapter APIs. Consumers who never set `renderer` are unaffected. The shared
color-module extraction (D3) is an internal refactor with no public-API change.

## 11. Observability / diagnostics

Reuses the renderer `error`/capability channel: the 2D view reports which requested options it cannot
honor (3D-only features, non-XY content) and why, so a consumer UI can disable them rather than showing a
misleading result. No new telemetry.

## 12. Alternatives considered

- **Do nothing / rely on the 3D renderer everywhere** — leaves the three target contexts unserved; the
  reason E8 exists. Acceptable only as the pre-E8 status quo (D6-C).
- **A WebGL-lite 2D renderer** (D1-B) — still requires WebGL, defeating the WebGL-blocked case.
- **Duplicating color logic in 2D** (D3-B) — drift risk; rejected for a shared module.
- **Auto-selecting the renderer by device probing as the default** (D5-B) — fragile oracle; offered only
  as an opt-in value.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Building on unproven demand (the gate's whole point) | D6-A pairs design acceptance with a named, cheap evidence trigger before implementation |
| A 2D package accidentally pulls in `three` | D4-A: `gcode-renderer-2d` depends only on `toolpath-core` + a shared color module; boundary lint (DD-002 §5) enforces no `three`/framework import |
| Color/kind semantics drift from the 3D renderer | D3-A single-sources the per-segment color function; parity test |
| 2D view silently misrepresents non-XY/CNC files | Capability-honest disclosure (§6/§11), never fabricated geometry |
| Scope creep into a second parser or a full 2D feature set | §3 non-goals; the mode is a flat per-layer projection of the existing IR |

## 14. Phased delivery (proposed, on D6-A/B)

1. **2D canvas core over IR** — draw one layer from the SoA to Canvas 2D; shared color module extracted
   (D3). New package `@chestnutlabs/gcode-renderer-2d` (D4).
2. **Layer + adjacent model** — current-layer selection, `adjacentLayers` ghosts, layer up/down (D2).
3. **Adapter wiring** — the `renderer: '2d' | '3d'` prop through `gcode-preview-core` and the adapters
   (D5); progress marker (DD-006) in 2D.
4. **Benchmarks + UX** — the §8 low-resource budget on a target device; capability-honesty for
   non-XY/`layers-unavailable` inputs.

## 15. Acceptance criteria

- [ ] D1–D6 decided by the maintainer and recorded; DD marked **Accepted** (or **Deferred** per D6-C)
- [ ] If building (D6-A/B): **E8** (#9) phased issues opened per §14; a new lockstep package
      `@chestnutlabs/gcode-renderer-2d` that imports **no `three` and no framework** (boundary lint green)
- [ ] The 2D renderer consumes the **existing IR** with **no IR/parser change** and single-sources the
      per-segment color function with the 3D renderer (parity test)
- [ ] Capability-honest: non-XY/CNC and `layers: unavailable` inputs are disclosed, never fabricated
- [ ] §8 low-resource budget met on a stated target device class (evidence-derived, not invented)
- [ ] No change to the default (`'3d'`) behavior or existing adapter APIs; no core package depends on
      AnyBridge

## Decision log

| Date | Decision | By |
|---|---|---|
| 2026-07-25 | DD-014 drafted as **Proposed**; D1–D6 open. E8 (#9) proposes an opt-in 2D/adjacent-layer renderer over the existing `ToolpathIR` for low-resource/low-GPU/WebGL-blocked contexts. First gate condition (stable IR) now met through E10; the second (device-need evidence) is put to the maintainer as D6. Numbered DD-014 because **DD-011** (`.bgcode`, #188) and **DD-012** (CNC/laser, #189) are reserved and **DD-013** is the documentation epic (E11) | Chestnut Labs |
| _pending_ | Awaiting maintainer decision on D1–D6 (esp. the D6 evidence gate) and on whether to open E8 implementation now | Maintainer |
