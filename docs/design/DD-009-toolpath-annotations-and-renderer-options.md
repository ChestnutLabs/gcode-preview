# DD-009 — Toolpath Annotations & Renderer Options

**Status:** **Proposed** <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Chestnut Labs
**Date:** 2026-07-23 · **Last revised:** 2026-07-23
**Owning Epic:** proposes **E9 — Toolpath Annotations & Renderer Options** (post-`v0.1.0`) · **Milestone:** Future
**Supersedes / Superseded by:** none
**Related:** DD-001 (IR + capability model — the annotation channels these features read/write),
DD-004 (renderer geometry/camera/quality — the surface #148/#150/#151/#153 extend), DD-005 (dialect
adapter contract — #147), DD-006 (progress mapper — already handles M600 position), DD-007 D1
amendment (the framework-neutral engine + parity rule that makes #149 a fourth bridge), issue #160
(this DD); enhancement issues #147/#148/#149/#150/#151/#153 (each credits its upstream source).

---

> Six upstream-credited enhancements were triaged to `status:deferred`; the maintainer elected the
> **DD path** for them rather than ad-hoc implementation. This DD takes the six design decisions
> **once, coherently**, so implementation can proceed phased with the same discipline as E1–E7.
> **None of these block `v0.1.0`** — this is post-release feature work.

---

## 1. Problem

The upstream backlog surfaced (epic #8 triage, 2026-07-23) enhancements that our architecture makes
*cheap* but that still touch public contracts — the IR, the dialect adapter surface, the renderer's
public API, or the package boundary. Under the project's docs-first rule those cannot be built
ad-hoc. Grouping them lets the maintainer decide scope, package placement, and sequencing in one
pass, and keeps the parity/boundary rules (DD-002/DD-007) intact.

## 2. Scope

Six enhancements, one decision point each (§4). Each notes the owning package and its contract
impact.

## 3. Non-goals

- **#152** (STL export from the showcase) — gated on the **#118** chrome/showcase decision, which is
  a product decision, not an architecture one. It follows #118, not this DD.
- **Motion-model correctness** (#155–#158, from the #154 audit) — a *separate* DD: those change the
  interpreter's position semantics (contract-sensitive in a different way — they alter existing IR
  output, not add optional surfaces).
- Anything before `v0.1.0` ships. These are post-release.

## 4. Decisions

Marked **D1–D7**; each lists options with a recommendation. §14's phased plan assumes the
recommendations.

### 4.1 D1 — Retraction / deretraction visualization (#148, upstream #223)

Cheapest of the set: the IR **already records** `Retract`/`Unretract` move kinds (E2); only a
renderer presentation is missing.

- **Option A (recommended):** an opt-in renderer marker layer in `gcode-renderer-three` — small
  always-on-top glyphs at retract/deretract transitions (reuse the DD-006 marker material pattern),
  toggled by a `showRetractions` renderer/adapter option (default off). No IR change; capability is
  `known` wherever the kinds are present.
- **Option B:** a color cue on adjacent segments instead of markers — cheaper still but easily
  confused with feature coloring. Rejected as the default.
- **Contract impact:** additive renderer option + one adapter prop across the four adapters.

### 4.2 D2 — M600 filament-swap color-change annotation (#147, upstream #152)

A manual filament swap (`M600`) is a **color boundary** for a multi-material preview.

- **Option A (recommended):** annotate swap boundaries in the **dialect layer**
  (`gcode-dialects`) into the IR's existing tool/feature channels (a synthetic tool-index increment
  or a dedicated `colorChange` marker in the segment stream), capability-tagged `known` when `M600`
  is seen. The renderer's existing by-tool coloring then shades post-swap segments.
- **Note:** the DD-006 progress mapper already handles `M600` **position** semantics (pause/resume)
  — this is only the color annotation, no new position logic.
- **Contract impact:** IR annotation channel (small, additive) + dialect adapter + reuse existing
  renderer coloring. Sub-decision: reuse the `tool` channel (simple, but conflates with real tool
  changes) vs. a dedicated color-change channel (cleaner, small IR addition) — **recommend the
  dedicated channel.**

### 4.3 D3 — Orthographic camera option (#150, upstream #177)

- **Option A (recommended):** add an orthographic camera mode to `gcode-renderer-three` (switchable
  with the existing perspective camera), surfaced as a `cameraMode: 'perspective' | 'orthographic'`
  renderer/adapter option and honored by `renderStill`'s camera handling. Framing math reused; only
  the projection changes.
- **Contract impact:** additive renderer option + adapter prop ×4 + a `renderStill` option.

### 4.4 D4 — three.js environment / theming API (#153, upstream #235)

The most API-heavy: a **supported** surface for background, lighting, grid/bed styling, materials.

- **Option A (recommended): a bounded, declarative theme object** (`background`, `gridColor`,
  `bedColor`, light intensities, a small set of named material presets) — enough for real theming
  without exposing raw three internals, so it stays stable across three upgrades. Deep customization
  keeps using the existing `createRenderer` / `raw.renderer()` escape hatches.
- **Option B:** expose the three `Scene`/materials directly — maximal power, but couples the public
  API to three's internals (fights the peer-range/versioning posture). Rejected.
- **Option C:** do nothing; leave it to the escape hatches. Viable if demand is low — this decision
  is partly *whether* to commit to a supported surface at all.
- **Contract impact:** a real new public API (declarative theme type) across the renderer + four
  adapters; the largest maintenance commitment here.

### 4.5 D5 — Custom Element (`<gcode-preview>`) adapter (#149, upstream #178)

- **Option A (recommended):** a fourth thin adapter package
  (`@chestnutlabs/gcode-preview-element`) — a Web Component bridging `gcode-preview-core`, attributes
  → the same neutral options, DOM events → the same events. Per the **DD-007 D1 parity rule** it is
  *not* a separate viewer; it **passes the shared behavioral suite** like Vue/React/Svelte, and its
  props/events stay in lockstep with them.
- **Contract impact:** a **new published package** — joins the lockstep version line (D1 of DD-008),
  the pack-check/publint gates, the support matrix, and the parity gate. Framework-free consumers
  (plain HTML, Angular, etc.) gain first-class support.
- **Sub-decision:** ship now as a 5th package vs. wait for demand. Recommend building it (cheap over
  the controller) but **only after the theming/camera options land**, so it inherits the full option
  surface.

### 4.6 D6 — Multi-gcode single-scene preview (#151, upstream #186)

The heaviest change: render **multiple IRs in one scene** (compare/overlay, multi-job plate).

- **Option A (recommended): a multi-model renderer mode** — the renderer accepts an array of
  `{ ir, transform?, colorOverride? }` and manages per-model geometry groups under one camera/bed,
  with layer/scrub applying per-model or globally (a decision the DD must pin). Larger renderer
  refactor (draw-range, framing, and the progress overlay all become per-model).
- **Option B:** document the existing **mount-multiple-components** workaround as the supported
  answer and defer the single-scene path until real demand. Cheapest; the workaround already works
  today.
- **Recommendation:** **Option B for E9's first pass** (document the workaround), promote to Option A
  only on real demand — it is the one item here with a genuinely large blast radius on DD-004.

### 4.7 D7 — Epic scope & sequencing

- **Option A (recommended):** open **E9 — Toolpath Annotations & Renderer Options** owning
  #147/#148/#150/#153/#149, milestone Future, sequenced cheapest-first (§14). #151 stays deferred
  under E9 as Option B (documented workaround) pending demand.
- **Option B:** fold these into E8 (Low-Resource Layer Mode) — rejected: E8 is a specific 2D-renderer
  scope, unrelated.

## 5. Lifecycle

Standard: on acceptance, open E9 + phased implementation issues per §14; each phase is an
independently reviewable PR train with tests, a changeset, and (for #149) the shared behavioral
suite. No release-flow changes.

## 6. Errors & failure behavior

Each feature degrades honestly (DD-001): retraction markers appear only where the kinds exist; M600
coloring is `known` only when `M600` is seen; orthographic/theming are pure presentation; the
Custom Element surfaces the same error events as the other adapters.

## 7. Security & resource limits

No new untrusted-input surface (all read the already-parsed IR). The Custom Element adds no new
network/worker path beyond what the shared worker already does. Multi-model mode (if pursued)
multiplies geometry memory — bounded by the existing per-IR limits, applied per model.

## 8. Performance

Markers/theming/ortho are negligible. The Custom Element wrapper is ≤ the other adapters' bundle
budget (DD-007 §8). Multi-model mode's cost scales with model count — a budget the DD would set if
Option A is ever taken.

## 9. Testing

Per feature: unit tests + the portable behavioral suite for #149; renderer tests for markers/camera;
a dialect fixture for M600; theme-option snapshot. Reuse existing IR fixtures.

## 10. Migration

All additive and opt-in (defaults preserve current behavior). The Custom Element is a new package,
no migration. Any breaking touch carries the DD-002 §8 migration-note rule.

## 11. Observability / diagnostics

Reuse the existing renderer events + capability disclosure; no new diagnostics surface.

## 12. Alternatives considered

Covered per decision (§4). Cross-cutting: *implement ad-hoc without a DD* — rejected (the reason this
DD exists: these touch public contracts and the parity/boundary rules).

## 13. Risks

| Risk | Mitigation |
|---|---|
| Theming API couples us to three internals | Bounded declarative theme (D4 Option A), not raw three |
| Custom Element drifts from the other adapters | The shared behavioral suite is a required gate (D5) |
| Multi-model mode is a large DD-004 refactor | Default to the documented workaround (D6 Option B) until demand |
| Scope creep post-1.0 | Cheapest-first sequencing; each phase independently shippable |

## 14. Phased delivery (proposed, cheapest-first)

1. **Retraction markers** (#148) — renderer option + adapter prop ×4.
2. **Orthographic camera** (#150) — renderer + adapters + `renderStill`.
3. **M600 color-change** (#147) — dialect annotation channel + renderer coloring reuse.
4. **Theming API** (#153) — the bounded declarative theme surface.
5. **Custom Element adapter** (#149) — after 1–4, so it inherits the full option surface; passes the
   shared suite; joins the lockstep line + gates.
6. **Multi-gcode** (#151) — document the workaround (D6 Option B); revisit Option A on demand.

## 15. Acceptance criteria

- [ ] D1–D7 decided by the maintainer and recorded verbatim; DD marked Accepted
- [ ] **E9** opened with phased issues per §14 (adjusted to decisions)
- [ ] Each shipped feature: additive/opt-in, capability-honest, tested; #149 passes the shared
      behavioral suite and joins the lockstep version line + pack/publint gates
- [ ] No regression to the `v0.1.0` public surface

## Decision log

| Date | Decision | By |
|---|---|---|
| 2026-07-23 | DD-009 drafted as Proposed; D1–D7 open. Grouped from the epic-#8 upstream triage after the maintainer chose the DD path for #147–#151/#153 | Chestnut Labs |
