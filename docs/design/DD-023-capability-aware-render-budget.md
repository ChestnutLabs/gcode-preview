# DD-023 — Capability-aware render budget and a too-heavy-for-this-client signal

**Status:** Accepted <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Nathaniel Chestnut (with Claude)
**Date:** 2026-08-26 · **Last revised:** 2026-08-26
**Owning Epic:** ModelRenderer / ToolpathRenderer (cross-cutting) · **Milestone:** TBD (post-v0.12.0)
**Supersedes / Superseded by:** none
**Related:** [DD-022](DD-022-model-instancing-and-lod.md) §8 (the `capabilityHint` software/hardware detection this generalizes), [RR-006](../research/RR-006-tube-mesh-memory-and-large-file-budget.md) + the v0.12.0 `tubeByteBudget` (the toolpath memory budget this adds a *time* axis to), [DD-020](DD-020-interaction-aware-quality.md) (interaction-aware quality — the responsiveness net), [DD-018](DD-018-model-renderer.md) / [DD-021](DD-021-interactive-model-viewer.md) (`renderModelStill` / `createModelViewer`). Consumer/proof case: AnyBridge farm file-manager — the `Baby_Opossum` full-sheet source `.3mf` and large forced-`tubes` toolpaths.

> **Design principle (maintainer, explicit and load-bearing):** large / full build plates are a **normal**
> workload for the target user (a print-farm operator), not an exceptional one. Optimization must first try
> to make those files render **properly, at full quality, on capable hardware**. Quality reduction / LOD is
> a **last-resort safety mechanism** for genuinely-oversized inputs or weak clients — **not** the normal
> path for farm-scale files. The current budgets invert this: they reduce a normal farm file by default
> even when the client could render it fully. This DD corrects the default posture to *assume capable, opt
> down for weak*.

> **Accepted** 2026-08-26 — the maintainer accepted DD-023 with the **quality-mode policy (D6)** folded in
> (his amendment, this batch): a `qualityMode` input **distinct from `capabilityHint`** — capabilityHint
> describes what the renderer is *actually running on* (CAN); qualityMode expresses what the user/admin
> *wants* (WANT). Three modes with the maintainer's exact semantics: **Full** — render at full available
> fidelity, never auto-decimate/drop/coarsen just to go faster (hard safety/OOM ceilings still apply); if
> the client genuinely cannot, **fail quickly and honestly and offer Adaptive/Fast-preview**, never silently
> lower quality. **Adaptive** — start from full quality and reduce **only** when detected capability
> requires it, every reduction **visibly disclosed**. **Fast preview** — explicitly trades fidelity for
> responsiveness. The deployment/admin default is configurable with a user/session override where
> appropriate; **fast-preview / silent degradation must NOT be the universal default.** Open questions in
> §10 (time-budget expression, signal shape, budget numbers via representative renders, naming, phasing)
> remain open and return to the maintainer before the phases that need them; Phase A (shared classifier, no
> behavior change) may proceed. The AnyBridge consumption boundary (§7) is a **distinct, downstream**
> ratification on the AnyBridge side — peer alignment is not maintainer acceptance.

---

## 1. Problem

Two concrete, non-hypothetical cases (both measured against v0.12.0, both at **default** limits) show the
same gap: **the renderer's budgets bound memory/bytes, but not render *time*, and their defaults assume a
weak client.**

**Instance 1 — a normal toolpath is reduced on hardware that could render it fully.**
A 1.73 M-segment farm plate (`Baby-Gemstone-Dragon-plate`, 47 MB `.gcode`), forced to `tubes`, is coarsened
from an 8-sided to a **3-sided** cross-section to fit the default `tubeByteBudget` (~450 MB CPU). The result
is continuous and honestly disclosed — but it is a *quality reduction applied to a normal file*. Full
radial-8 for 1.73 M segments needs ~955 MB (>2× the default). On a capable GPU client with the RAM to
spare, there is no reason to reduce it; the default budget does so anyway because it is sized for the weakest
target.

**Instance 2 — a structurally-valid model renders correctly but hangs the interactive UI on software.**
The `Baby_Opossum` full-sheet `.3mf` (~195 MB uncompressed, **814 instanced copies** of a few masters)
renders **correctly** via GPU instancing (confirmed: 814 instances, ~1.5 M unique triangles, exact
geometry — [DD-022](DD-022-model-instancing-and-lod.md) Phase 1). But on **software WebGL** (SwiftShader /
Microsoft Basic Render Driver) it takes **~96 s** to rasterize — *measured headless* via `renderModelStill`
on the AnyBridge SwiftShader sidecar (the defensible proxy; a live interactive render on the same software
client is **≥** that and is not separately measured, since one cannot reasonably sit through the hang to
time it). Instancing bounds upload/memory, **not** raster fill-time on a software rasterizer. At default
limits, v0.12.0's corrected estimate now *accepts* this plate where v0.11.0 fast-rejected it — so the
interactive `createModelViewer` flips from a **fast, honest "too large" reject** to **attempting that ~96 s
raster → a silent hang** in a live viewer. On a hardware client the same render is fine; on the software
client it is worse UX than the old rejection.

**The common shape.** Both are the same missing axis: a **render-time budget keyed on client
hardware-vs-software capability**, plus a way for the renderer to say *"this is too heavy for this client —
don't attempt a long raster; here is a lighter path"* instead of either (a) silently reducing quality on a
capable client, or (b) silently hanging on a weak one. Today the renderer has memory/byte budgets
([`tubeByteBudget`](../research/RR-006-tube-mesh-memory-and-large-file-budget.md), `maxTriangles`) and a
software/hardware *detection* seam ([DD-022 §8](DD-022-model-instancing-and-lod.md)), but no **time** budget
and no **too-heavy signal** — and the memory budget's default is sized for the weak client, degrading normal
files everywhere.

## 2. Scope

Deliver capability-aware rendering across **both** the toolpath and model paths, honoring the maintainer
principle (§ design principle above):

0. **A `qualityMode` policy input** (Full / Adaptive / Fast-preview) expressing user/admin *intent*, distinct
   from capability *detection* — the primary control over whether reduction is even permitted (D6).
1. **Client-capability detection** (hardware vs software WebGL), generalized from the model-only
   [DD-022 §8](DD-022-model-instancing-and-lod.md) seam to a shared classifier used by both paths.
2. **A render-time / performance budget** as a distinct axis from the memory/byte budget — a predicted-cost
   model (a triangle·instance / segment·cross-section time proxy), with **separate hardware and software
   budgets**.
3. **A renderer-visible "too-heavy-for-this-client" signal** — a public, disclosed event/result field that
   fires **before** the renderer commits to a long raster, so a consumer can react (preview / reject /
   lighter representation) rather than hang.
4. **Capability-aware defaults** — capable hardware gets **generous / full-quality** behavior (a normal farm
   plate renders fully, no reduction); software is the **conservative fallback/exception**.
5. **The AnyBridge consumer contract** (§7) for reacting to the signal without hanging the UI.
6. **Relationship to the Service Manager GPU-render capability** (§8), while keeping `gcode-preview`
   **independent of AnyBridge and SM** (no imports, no host inference).

**Explicitly out of scope / not committed here:**

- **DD-022 Phase 2 vertex-cluster LOD** and any `lodTriangleBudget` (~2 M) threshold. LOD remains a
  *last-resort* lever for genuinely enormous **unique** geometry; whether/where it triggers is deferred
  until we see what capability-aware rendering solves first. This DD must not presume it.
- **Raising `maxTriangles` / the hard safety ceiling.** The ceiling stays the final guardrail (DD-022 §2.4);
  capability-aware defaults sit *below* it and are about matching quality to the client, not removing the
  cap.
- Any AnyBridge-side or SM-side implementation. This DD defines only the `gcode-preview` public surface and
  the consumer *contract*.

## 3. Non-goals / honesty invariants (unchanged)

- Never fabricate geometry or color to hit a budget; reduction is always **disclosed** (the existing
  `known` / `inferred` / `approximated` / `unavailable` tiers, and the `decimationApplied` / `instancedCount`
  disclosure fields — [DD-022 §4.2](DD-022-model-instancing-and-lod.md)).
- FDM byte-identical output is untouched — this is a *render-budget* concern, not a parse/IR change.
- `gcode-preview` imports nothing from AnyBridge or SM; capability is read from the **actual WebGL context**,
  never inferred from the host, the deployment, or an AB/SM API (§8).

## 4. Design decisions (proposed — for maintainer sign-off)

### D1 — Shared client-capability classifier (hardware vs software)

Generalize the [DD-022 §8](DD-022-model-instancing-and-lod.md) detection into one classifier used by the
toolpath renderer and the model renderer alike. Read `UNMASKED_RENDERER_WEBGL` via the
`WEBGL_debug_renderer_info` extension and classify the **inner** renderer, not the `ANGLE (...)` wrapper:

- **Software → conservative:** `ANGLE (Google, Vulkan … (SwiftShader Device …), SwiftShader driver)`,
  `llvmpipe`, "Basic Render Driver".
- **Hardware → generous:** `ANGLE (NVIDIA, …)`, `ANGLE (Intel, Mesa Intel(R) …)`,
  `ANGLE (AMD, … (radeonsi …))`.

Fail-safe rules (carried from DD-022 §8, made explicit and shared):

1. **Unknown/unrecognized string ⇒ conservative** (never assume hardware on an unknown).
2. **Extension gated/absent** (some privacy-hardened browsers) ⇒ the renderer sees only a masked generic
   string ⇒ detection is **blind** ⇒ fall back to an explicit `capabilityHint`, else conservative.
3. **GPU present but ANGLE fell back to SwiftShader** (driver init failure) ⇒ the string still reads
   SwiftShader ⇒ correctly classified conservative (the safe direction).

`capabilityHint: 'auto' | 'software' | 'hardware'` (default `'auto'` = detect) stays the authoritative
consumer override when detection is blind or the consumer knows its context. This is the **same seam**
DD-022 §8 introduced for the model LOD budget — D1 just makes it a shared, both-path classifier.

### D2 — A render-time budget as a distinct axis

Add a **performance budget** separate from the memory/byte budget. It bounds *predicted render cost*, not
bytes:

- **Toolpath:** a cost proxy over `segments × cross-section resolution` (extending the RR-006 accounting
  from bytes to a time estimate). The lever is still cross-section coarsening / lines fallback, but the
  *trigger* becomes "predicted raster cost > client time budget," not "CPU bytes > memory budget."
- **Model:** a cost proxy over `drawn triangles = Σ(unique master triangles × instance count)` — the
  quantity that actually drives software raster time (the 814×… fill cost), which the memory/instancing
  budget does **not** capture.

Two budget values — **hardware** (generous; a normal farm plate is under it → full quality) and **software**
(conservative). Chosen by D1. The memory/byte budgets (`tubeByteBudget`, `maxTriangles`) still apply
independently — a render must satisfy *both* time and memory budgets; the hard ceiling remains the final
guardrail.

*Open question for sign-off (§10):* whether the time budget is expressed as an abstract "cost unit" ceiling
or a wall-clock-ms target with a calibrated cost→time model. Wall-clock is more honest to the UX goal but
requires a per-client calibration; a cost-unit ceiling is deterministic and testable. Recommend starting
with a **deterministic cost-unit ceiling** (testable, no calibration), tuned so the two proof cases land on
the intended side, and revisiting wall-clock later.

### D3 — Capability-aware defaults (assume capable, opt down for weak)

Invert the current default posture:

- **Hardware client ⇒ generous budgets** — the toolpath tube budget and the model time budget are set so a
  *normal* full-sheet farm plate renders at **full quality with no reduction and no disclosure**. (Instance 1
  renders at radial-8; Instance 2 renders its 814 instances without a too-heavy signal — because a GPU
  rasterizes them fast enough.)
- **Software client ⇒ conservative budgets** — the current safe behavior (cross-section coarsening; the
  too-heavy signal for the model hang), applied *only* to the weak client, not to everyone.

This is the crux of the maintainer principle: reduction stops being the default and becomes the software
exception. **Note the coupling** — a generous default is only *safe* because D1 detection + D4 signal keep
the software client from attempting a render it can't finish. A generous default without detection would
reproduce the OOM/hang on software; detection must land *with* the raised default, not after.

### D4 — A renderer-visible "too-heavy-for-this-client" signal (from a cheap pre-check)

A new **public, disclosed** signal the renderer emits **before** committing to a long raster when the
predicted cost exceeds the client's time budget **and** no acceptable in-renderer reduction preserves the
honesty model. It mirrors the existing `renderer-unsupported` honesty event, not a silent hang.

**The decision must be made from a cheap structural pre-check, not discovered mid-raster.** The target is
*fail/degrade **quickly***, not "hang 96 s then give up." So the too-heavy decision keys off the same
sub-second structural estimate the model path already runs ([DD-022](DD-022-model-instancing-and-lod.md)
Phase 0: unique-triangle × instance-count) and the toolpath segment/cross-section estimate — evaluated
against the client capability **before** any large geometry is decompressed or uploaded. The old fast
"too large" reject is the **good** UX; the 96 s silent hang is the exact anti-pattern DD-023 exists to
eliminate. A cost estimate that lands over the software budget fires the signal *immediately*, so the
consumer's fallback-to-preview is as fast as today's Phase-0 reject — never fired partway through a doomed
render.

Shape (for sign-off — §10): a `renderer-too-heavy` event / ready-result field carrying `{ reason,
predictedCost, budget, capability: 'software'|'hardware', sugg: 'preview'|'reduce'|'reject' }`. The renderer
does **not** unilaterally hang or silently degrade; it surfaces the signal and lets the consumer choose —
symmetric to how `decimationApplied` / `instancedCount` disclose what *did* happen, this discloses what
*would* happen and defers the choice. Default in-library behavior when the consumer ignores the signal is a
sign-off question (options: attempt anyway, or fall to the safe reduction) — recommend **fall to the safe
reduction / lines** so an unaware consumer never hangs.

### D5 — Both render paths, both entry points

The classifier (D1), time budget (D2), defaults (D3), and signal (D4) apply uniformly to:

- **Toolpath:** `ToolpathRenderer` (interactive) and `renderStill` (headless).
- **Model:** `createModelViewer` (interactive) and `renderModelStill` (headless).

Headless is **not** assumed hardware (DD-022 §8): the AnyBridge thumbnail sidecar runs headless Chromium on
SwiftShader, so a headless render classifies as **software** unless its context reports a real GPU. This is
already the DD-022 posture; D5 states it for the toolpath path too.

### D6 — `qualityMode` policy (user/admin intent), distinct from `capabilityHint`

**Accepted (maintainer amendment).** The two inputs answer different questions and both exist:

- **`capabilityHint`** (D1) = what the renderer is **actually running on** — CAN. `'auto'` detects
  software/hardware; `'software'`/`'hardware'` override when detection is blind.
- **`qualityMode`** = what the user/admin **wants** — WANT. It is the primary gate on whether reduction is
  even permitted, and it is *not* derived from capability.

Three modes, with the maintainer's exact semantics:

- **`'full'`** — render at full available fidelity. **Never** auto-decimate / drop segments / coarsen the
  cross-section merely to go faster. The hard safety / OOM ceilings (`maxTriangles`, memory budgets) still
  apply as the final guardrail. If the client **genuinely cannot** render it (the D4 cheap pre-check says the
  cost is over what this client can do), **fail quickly and honestly and offer Adaptive / Fast-preview** —
  never silently lower quality. So on capable hardware `'full'` is exactly full quality with no disclosure;
  on a weak client `'full'` produces the fast, explicit too-heavy signal, not a silent downgrade and not a
  hang.
- **`'adaptive'`** — start from full quality and reduce **only** when the detected/measured capability
  requires it (the D2/D3 capability-aware auto path). **Every** reduction is **visibly disclosed**
  (`decimationApplied` / tiers). This is the "assume capable, opt down for weak" default behavior.
- **`'fast'`** (Fast preview) — explicitly trades fidelity for responsiveness (e.g. lines / low
  cross-section / aggressive budget) as a deliberate user choice, disclosed as such.

**Default policy (maintainer):** the deployment/admin sets the default `qualityMode`, with a user/session
override where appropriate. **Fast-preview and silent degradation must NOT be the universal default** — a
deployment that wants full-quality-first sets `'full'` (or `'adaptive'`) and the renderer honors it. The
in-library default when a consumer passes nothing is a naming/sign-off detail (§10), but it must not be
`'fast'` and must never silently degrade a normal file — recommend `'adaptive'` as the safe, honest,
capability-aware default that still renders normal farm plates fully on capable hardware.

`qualityMode` composes with `capabilityHint`: `'full'` + hardware ⇒ full quality; `'full'` + software over
budget ⇒ too-heavy signal (D4); `'adaptive'` + software ⇒ disclosed reduction; `'fast'` ⇒ low-cost path
regardless. D3's "capability-aware defaults" describe the `'adaptive'` behavior specifically; D6 is what lets
a user demand `'full'` and forbid the silent reduction entirely.

## 5. Public API surface (proposed — the maintainer's sign-off gate)

New/changed public surface (accepted; lands per the §10 phasing, with the still-open shape questions
resolved before the phase that needs them):

- **`qualityMode: 'full' | 'adaptive' | 'fast'`** (D6) — user/admin intent, on both interactive and headless
  entry points of both paths. Deployment/admin-configurable default + user/session override; default must not
  be `'fast'` or silently degrading (recommend `'adaptive'`). Distinct from `capabilityHint`.
- **`capabilityHint: 'auto' | 'software' | 'hardware'`** — generalized from the model options (DD-022 §8) to
  the toolpath renderer options and `renderStill`. Default `'auto'`.
- **Render-time budget options** — e.g. `renderTimeBudget` (or per-path `tubeTimeBudget` / `modelTimeBudget`),
  with hardware/software defaults. Naming for sign-off.
- **`renderer-too-heavy` signal** — event and/or ready-result field (D4). Name/shape for sign-off.
- **Disclosure parity** — the signal and any capability-driven reduction are disclosed consistently with the
  existing `decimationApplied` / `instancedCount` fields and the honesty tiers.

All additive; no breaking change to existing consumers (defaults preserve current behavior *except* the
intended posture change in D3, which improves capable-hardware output and is the point of the DD).

## 6. Honesty & disclosure

- A capability-driven **reduction** is disclosed exactly as today (`decimationApplied`, tiers).
- The **too-heavy signal** is itself a disclosure: the renderer is honest that it *chose not to attempt* a
  render this client can't finish, and names the lighter path — it never silently substitutes lower quality
  for the requested render without saying so.
- Full-quality renders on capable hardware carry **no** disclosure (there is nothing to disclose) — which is
  the corrected normal case.

## 7. AnyBridge consumer contract (coordinated; ratified separately AB-side)

For when this is Accepted and built (the AnyBridge session has reviewed this shape):

- **Quality-mode control** (D6): AnyBridge surfaces the `qualityMode` choice (Full / Adaptive / Fast-preview)
  as a deployment/admin default plus a user/session override, and passes the chosen mode into the renderer.
  Its existing triangle-limit `tooLarge` fallback becomes the consumer half of the `'full'`-on-a-weak-client
  case: renderer says too-heavy → AnyBridge shows the preview and offers Adaptive/Fast-preview.
- **Interactive path** (`createModelViewer` / `ToolpathRenderer`): AnyBridge passes `qualityMode` +
  `capabilityHint` (or `'auto'`) and **honors the `renderer-too-heavy` signal** by showing the embedded
  slicer preview / a lighter representation — a **fast, time-driven analogue of its existing triangle-limit
  `tooLarge` path**. This directly resolves Instance 2's ~96 s hang: the software client gets a fast preview +
  an explicit "too heavy to render interactively on this device," not a silent 96 s Loading.
- **Headless path** (`renderModelStill` / `renderStill`): the SwiftShader sidecar classifies as software and
  gets the conservative budget; a farm sidecar with a real GPU (via SM passthrough, §8) classifies as
  hardware and renders fully.
- AnyBridge implements this only after **both** ratifications: maintainer Accepts this DD (repo public API),
  then the AnyBridge owner ratifies the AB-side consumption. This DD defines the contract; it does not
  authorize AB-side work.

## 8. Relationship to the Service Manager GPU-render capability (independence preserved)

SM is building host-GPU passthrough: when a deployment has a GPU, the AnyBridge sidecar's headless Chromium
runs on the real GPU instead of SwiftShader. The **only** coupling to `gcode-preview` is that the WebGL
context then reports a **hardware** `UNMASKED_RENDERER_WEBGL` string, which D1 classifies as hardware →
generous budget. Critically:

- `gcode-preview` reads only the **standard WebGL renderer string** from its own context. It does **not**
  know about, import, or call anything from AnyBridge or SM, and does **not** infer capability from "the host
  has a GPU" or "SM bound a device" — only from the actual renderer it is running on. (This is why a
  GPU-present-but-fell-to-SwiftShader case correctly classifies software — D1 rule 3.)
- The layering stays clean: **SM** owns the device/passthrough mechanism; **AnyBridge** owns the sidecar
  (Chromium launch, the too-heavy→preview fallback, the verify-gate that only lifts caps when the sidecar's
  actual `GL_RENDERER` reads hardware); **`gcode-preview`** owns only capability *classification from its own
  context* and the budget/signal. No `gcode-preview` reusable package imports AnyBridge or SM (lint-enforced,
  the standing core rule).

## 9. Testing (proposed)

- **Classifier unit tests** over real ANGLE strings (SwiftShader / llvmpipe / Basic Render Driver / NVIDIA /
  Mesa Intel / AMD radeonsi), plus masked/empty/unknown ⇒ conservative, and the extension-absent ⇒
  `capabilityHint` fallback. (Pin to real strings from the AnyBridge Chromium-on-GPU prototype when
  available.)
- **Budget-decision tests** (pure, no GL): the two proof-case fixtures land on the intended side — the
  1.73 M-seg toolpath renders full radial-8 under the *hardware* budget and coarsens only under *software*;
  the 814-instance model emits **no** too-heavy signal under hardware and emits it under software.
- **Disclosure tests**: full-quality hardware render carries no disclosure; software reduction / too-heavy
  signal are present and correctly shaped.
- **Both-path parity**: toolpath and model paths make the same decision for the same capability + cost.

## 10. Open questions (resolved before the phase that needs them)

The DD is Accepted; these implementation-shape questions return to the maintainer before the phase that
depends on them (they do not gate Phase A). The **quality-mode semantics (D6) are decided** — only its
option naming and in-library default remain a detail below.

1. **Time-budget expression** (D2): deterministic cost-unit ceiling (recommended) vs wall-clock-ms target
   with a calibrated model.
2. **`renderer-too-heavy` shape** (D4): event, ready-result field, or both; exact payload; and the default
   in-library behavior when a consumer ignores the signal (recommended: fall to safe reduction / lines, so
   no unaware consumer hangs).
3. **Budget values** (D3): the hardware and software default budgets — chosen so the two proof cases land as
   intended. Proposed to fix these empirically (representative before/after renders) rather than guess; the
   maintainer asked to see representative renders if a threshold becomes subjective.
4. **Option naming** (D5/§5): single `renderTimeBudget` vs per-path `tubeTimeBudget` / `modelTimeBudget`; and
   the `qualityMode` option name + its in-library default (recommended `'adaptive'`; must not be `'fast'` or
   silently degrading — the semantics themselves are decided, D6).
5. **Phasing:** recommend Phase A = shared classifier (D1) + `qualityMode`/`capabilityHint` plumbing +
   detection tests (no behavior change: `'adaptive'` reproduces today's output, `'full'` differs only on
   capable hardware which is the point); Phase B = time budget + capability-aware defaults (D2/D3); Phase C =
   the too-heavy signal (D4) + AnyBridge contract (§7). Phase A is safe and testable in isolation and is
   cleared to proceed.

## 11. What this DD deliberately does not decide

- It does not adopt vertex-cluster LOD or any triangle threshold (DD-022 Phase 2 stays separate and
  uncommitted).
- It does not raise the hard `maxTriangles` ceiling.
- Accepted 2026-08-26: Phase A (classifier + `qualityMode`/`capabilityHint` plumbing, no behavior change) is
  cleared; Phases B/C proceed once their §10 shape questions (budget numbers via representative renders,
  signal shape) return to the maintainer.
