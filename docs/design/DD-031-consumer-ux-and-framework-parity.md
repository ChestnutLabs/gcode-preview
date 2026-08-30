# DD-031 — Consumer SDK experience, framework parity, and the Feature Lab

**Status:** Accepted
**Authors/Owners:** Nathaniel Chestnut (owner), Claude Code (lead)
**Date:** 2026-08-28 · **Last revised:** 2026-08-28

> **Owner decisions (2026-08-28):** (1) The flagship Feature Lab is rebuilt on the **published
> framework-neutral `gcode-preview-core` controller**; the raw renderer stays a lower-level/internal
> escape hatch, not the flagship's path. (2) Shared showcase/control logic goes in an **unpublished
> workspace-internal demo-kit**; **no** styled viewer kit or headless-control package is published
> this pass (re-evaluated later from what the new UX teaches us — §12/§22). (3) **All** identified
> dark-capability gaps are closed in the public controller + all four adapters. Every new public
> controller capability **requires equivalent exposure across Vue/React/Svelte/Web Component where
> applicable, plus parity tests and documentation, before the visual redesign begins** (§4.4→§9→§4.5
> ordering is mandatory).
**Owning Epic:** Consumer-UX productization · **Milestone:** post-v0.19.0
**Supersedes / Superseded by:** none
**Related:** DD-007 (adapter boundary), DD-013 (docs/manual), DD-014 (2D renderer), DD-018/021 (model renderer/viewer), DD-027 (render diagnostics), DD-030 (renderer/viewer interop), `docs/VISUAL_FEATURE_COVERAGE.md`

---

## 1. Problem

The engine and its published API have grown enormously (14 lockstep packages, four framework
adapters, a mature Three.js renderer, a model viewer, CNC/laser support, render diagnostics,
parallel geometry, capture, staged progress). The **consumer-facing experience** — the demo, the
examples, the framework adapters' discoverability, and the coherence of the public surface — has not
kept pace. The main demo still structurally resembles the inherited `xyz-tools/gcode-preview`
engineering harness (a 300px fixed sidebar of history-ordered `<fieldset>`s beside a canvas), the
examples are minimal-only, there is **no Web Component example at all**, and several shipped
capabilities are reachable only through escape hatches. This DD records the audit (Phase 1), the
architecture decisions (Phase 2), and the parity/discoverability contract that makes framework
parity part of feature completion going forward.

## 2. Scope

- A factual inventory of the consumer capability surface (this doc, §4.1).
- The **Framework Feature Parity Matrix** (§4.2) and **demo/example exposure** (§4.3).
- Identified **API gaps** where shipped capability is unreachable or awkward through the public
  surface (§4.4), and the additive core changes that close them.
- The main-demo **UX architecture** redesign into a "Feature Lab" (§4.5) and its **design tokens**.
- A **two-tier example strategy** (minimal + full showcase) per framework incl. Web Component, with
  shared, non-bypassing example infrastructure (§4.6).
- **Parity tests** that lock capability equivalence across adapters (§9).
- The durable **parity-completion rule** added to project process (§4.7).

## 3. Non-goals

- No breaking changes to published API for cosmetic reasons (DD-002 versioning still governs; see
  §10). Additive-only core changes here.
- Not turning `<GcodePreview>` into an opinionated slicer application — the SDK component stays
  embeddable; the Feature Lab is a shell *around* it.
- **A new published "viewer kit" package is out of scope for this pass** (evaluated in §12; recorded
  as a possible future epic). This pass may extract framework-neutral *control-model logic* into an
  existing package where it removes a real consumer burden, but ships no new styled-component package.
- The renderer scene theme and the documentation-capture theme are unchanged (DD-009 / the v0.19.0
  doc pass own those); only the *application chrome* of the demo/examples is designed here.

## 4. Data contracts / API

### 4.1 Consumer capability inventory (today)

The framework-neutral controller (`gcode-preview-core/controller.ts`) is the canonical vocabulary:
`GcodePreviewControls` (25 imperative methods), `GcodePreviewState` (reactive snapshot),
`PreviewEvent` (13-variant union), `PreviewControllerOptions.renderer` (declarative options). The
Three renderer (`ToolpathRenderer`) and 2D renderer (`LayerView2D`) sit behind `PreviewRenderer`;
the model viewer (`ModelViewer`) is a separate product surface.

Consumer-meaningful capabilities the SDK supports today:

- **Parse/render**: source (bytes/File), parse options, renderer mode 2d/3d, cancel, progressive
  partial streaming.
- **Inspect**: layer range, segment scrub, time scrub, move-kind visibility (travel/wipe/extrude),
  retraction/deretraction markers, feature-role visibility (skirt/brim/…), segment picking
  (`pickSegment` — source mapping).
- **Appearance**: 10 color modes — `single`, `tool`, `feature`, `colorChange`, `filament`,
  `feedrate` (speed), `object` (+isolate), `layerHeight`, `power` (CNC/laser), `moveKind`
  (cut-vs-rapid); declarative `theme`; material preset.
- **View/camera**: perspective/orthographic, 7 presets (top/bottom/front/back/left/right/iso),
  camera-state get/set (serializable), `frame()`, `frameContent` object-vs-all, build-volume cage.
- **Rendering**: quality tier (auto/tubes/lines), fidelity policy (`full`/`adaptive`/`fast`),
  progressive-preview curtain (auto/lines/hold/off), interaction-aware quality, capture → Blob,
  tube byte budget, parallel geometry pool.
- **Machine/geometry**: build volume rect/round/polygon, excluded regions, bed surface, consumer-
  wins discovery precedence.
- **Live progress**: DD-006 observation mapping, presentation (exact/approximate/stale/hidden),
  staleness ticking, telemetry-tier honesty.
- **Diagnostics/honesty**: per-field capability confidence, warnings, disclosures, `getRenderStats`
  (backend/GPU/geometry-mode/parallelism/timings), capability gates (`isColorModeAvailable`,
  `hasRetractions`, `hasColorChanges`).
- **Model product**: STL/3MF presentation, material confidence, plates, render scope, instancing,
  model capture.

### 4.2 Framework Feature Parity Matrix (as audited, pre-fix)

Legend: **prop** = declarative prop; **attr** = observed+reflected HTML attribute; **prop-only** =
JS property (not attribute-settable); **ctl** = reachable only via `controls.*`; **raw** = reachable
only via `raw.renderer()` escape hatch; **✗** = absent; **—** = not applicable. Demo/Example/Tested
mark exposure in the main demo, the framework examples, and the portable behavioral suite.

| Capability | Core | Vue | React | Svelte | WC (Element) | Demo | Example | Tested |
|---|---|---|---|---|---|---|---|---|
| source / parse | ✓ | prop | prop | prop | prop-only | ✓ | ✓ | ✓ |
| renderer mode 2d/3d | ✓ | prop | prop | prop | **attr, unobserved, no accessor** | (2d.html) | ✗ | ✗ |
| layer range | ✓ | prop | prop | prop | attr | ✓ | ✓ | ✗ |
| segment scrub | ✓ | prop | prop | prop | attr | ✓ | ✓ | ✓ |
| time scrub | ✓ | prop | prop | prop | attr | ✓ | ✗ | ✗ |
| move-kind (travel/wipe) | ✓ | prop | prop | prop | attr | ✓ | ✗ | ✗ |
| retraction markers | ✓ | prop | prop | prop | attr | ✓ | ✗ | ✗ |
| **feature-role visibility** | ctl | **ctl** | **ctl** | **ctl** | **ctl** | ✓ | ✗ | ✗ |
| color modes (10) | ✓ | prop | prop | prop | prop-only | 7/10 | ✗ | ✗ |
| quality tier | ✓ | prop | prop | prop | attr | ✓ | fixed | ✗ |
| fidelity policy (qualityMode) | ✓ | prop | prop | prop | attr | ✗ | ✗ | ✗ |
| progressive preview | ✓ | prop | prop | prop | attr | ✓ | ✗ | ✗ |
| camera mode (proj) | ✓ | prop | prop | prop | attr | ✓ | ✗ | ✗ |
| camera presets (view) | ✓ | prop | prop | prop | attr | ✓ | ✗ | ✓ |
| camera state get/set | ✓ | prop+ctl | prop+ctl | prop+ctl | prop+method | ✓ | ✗ | ✓ |
| **frame()** | ctl | **ctl** | **ctl** | **ctl** | **ctl** | ✓ | ✗ | ✗ |
| frame content object/all | ✓ | prop | prop | prop | attr | ✗ | ✗ | ✗ |
| interaction quality | ✓ | prop | prop | prop | attr | ✗ | ✗ | ✗ |
| theme | ✓ | prop | prop | prop | prop-only | ✓ | ✗ | ✗ |
| build volume | ✓ | prop | prop | prop | prop-only | (discovered) | ✗ | evt |
| build-volume cage | ✓ | prop | prop | prop | attr | ✗ | ✗ | ✗ |
| bed shapes rect/round/poly | ✓ | prop | prop | prop | prop-only | (shots) | ✗ | ✗ |
| **capture → Blob** | ctl | **ctl** | **ctl** | **ctl** | method | ✓ | ✗ | ✗ |
| live progress (observe) | ✓ | prop+handle | prop+handle | prop+handle | prop+method | ✓ | ✓ | ✓ |
| progress presentation | ✓ | state | state | state | state | ✓ | ✓ | ✓ |
| **render diagnostics (getRenderStats)** | **raw** | **raw** | **raw** | **raw** | **raw** | ✓ | ✗ | ✗ |
| **segment picking (pickSegment)** | **raw** | **raw** | **raw** | **raw** | **raw** | ✗ | ✗ | ✗ |
| capability gates (isColorModeAvailable/hasRetractions/hasColorChanges) | renderer | raw | raw | raw | raw | ✓ | ✗ | ✗ |
| CNC/laser power color | ✓ | prop | prop | prop | prop-only | ✗ | ✗ | ✗ |
| cut-vs-rapid (moveKind) color | ✓ | prop | prop | prop | prop-only | ✗ | ✗ | ✗ |
| model rendering (STL/3MF) | ModelViewer | ✗ | ✗ | ✗ | ✗ | (model*.html) | ✗ | pkg-local |
| render scope (plate/object) | ModelViewer | ✗ | ✗ | ✗ | ✗ | (model-viewer.html) | ✗ | pkg-local |
| plates | ModelViewer | ✗ | ✗ | ✗ | ✗ | (model-viewer.html) | ✗ | pkg-local |

**Finding: Vue/React/Svelte declarative parity is actually strong** (~24 aligned props each); the
real problems are (a) a set of capabilities that are *dark in every adapter* (feature-role
visibility, frame, render diagnostics, segment picking — controls/raw-only, no declarative surface),
(b) **Web Component divergence** (unobserved construction attrs, property-only inputs that can't be
set in markup, event-payload wrapping drift), and (c) documentation that both undersells (READMEs
list ~10 of ~24 props) and overclaims (`adapters.md` "identical across adapters" is wrong for the WC).

### 4.3 Demo / example exposure (today)

- **Main demo** (`tools/demo`, `main.js` 630 lines, `index.html` 355 lines): feature-rich — exposes
  most toolpath capabilities — **but imports the raw `ToolpathRenderer` + `GcodeParseSession`
  directly, bypassing every published package.** It therefore cannot catch an adapter regression and
  reaches renderer-only capabilities (`getRenderStats`, capability gates) that the controller does
  not expose. Layout: fixed 300px sidebar, `<fieldset>` groups **ordered by feature-development
  history**, single inline `<style>` (no design system), developer-oriented labels (pipeline
  subtitle "GcodeParseSession → ToolpathRenderer — DD-004 phase 3 demo", inline `#NNN`/`DD-` refs).
  Does **not** expose: fidelity policy, frame-content, interaction quality, build-volume cage, bed
  shapes, CNC power / cut-vs-rapid color, model/plates/render-scope (those live on separate sibling
  HTML pages `model.html` / `model-viewer.html` / `2d.html` / `validate.html` / `still.html`).
- **Framework examples**: React (`example-react`, 132 lines), Svelte (`example-svelte`, 104 lines),
  Vue (`tools/demo/src/vue-demo.js`, 148 lines) are **minimal-only, package-consuming** parity clones
  (corpus, load, last-layer, scrub, simulated progress, event log). **No full-feature framework
  showcase exists for any framework. No Web Component example app exists at all.**
- `tools/consumer-vue` is a pack/install **contract test**, not a UI.

### 4.4 API gaps and the additive core changes that close them

All additive (minor), no breaking change:

- **G1 — render diagnostics dark.** `getRenderStats()` exists only on `ToolpathRenderer`. Add
  `getRenderStats(): RenderStats | null` to `GcodePreviewControls` (2D returns its own 2-D stats or
  null), surface a `renderStats` event through `PreviewEvent`, and expose it in every adapter (see
  §4.7). Wire a diagnostics prop/attr where declarative makes sense; method on all handles.
- **G2 — segment picking dark.** `pickSegment(ndcX,ndcY,threshold?)` is on `PreviewRenderer` but not
  `GcodePreviewControls`. Promote it to the controls surface (returns `number | null`; 2D returns
  null) so source-mapping is reachable without `raw.renderer()`.
- **G3 — feature-role visibility not declarative.** Add a declarative surface (a
  `hiddenFeatureRoles` prop/attr, list-valued) in all four adapters, backed by the existing
  `setFeatureRoleVisible` + `getHiddenFeatureRoles`.
- **G4 — frame() only imperative.** Keep imperative; additionally accept a declarative `autoFrame`
  trigger where idiomatic (already effectively covered by `frameContent`/`view`); document the
  imperative path as first-class on every handle.
- **G5 — capture() first-class only on WC.** Add `capture(opts?)` to the Vue/React/Svelte **handles**
  (not just `controls`) to match the Element instance method.
- **G6 — capability gates unreachable.** Surface capability availability in `GcodePreviewState`
  (e.g. `state.availableColorModes`, `hasRetractions`, `hasColorChanges`) so capability-aware UI
  needs no `raw.renderer()`. This is the data that powers contextual controls (§4.5).

Web Component alignment (additive/bugfix):

- **E1** — make `renderer`/`adjacent-layers` observed with property accessors (or document them as
  construction-only consistently with a clear error) — remove the silent-ignore asymmetry.
- **E2** — provide attribute paths for `color-mode`/`theme` where representable (string attrs;
  objects stay property-only, documented).
- **E3** — normalize event `detail` shapes with the framework adapters (bare values) or document the
  DOM-idiom wrapper consistently; add typed `CustomEvent` maps.
- **E4** — re-export `RendererMode`/`PreviewRenderer` from Element `index.ts`.
- **D1** — export the Svelte `GcodePreview` component from `index.ts` (keep the subpath too).

### 4.5 Feature Lab — UX architecture

Redesign `tools/demo` from a sidebar-of-fieldsets into a **Feature Lab**: viewport-dominant, with
intent-grouped, capability-aware inspector panels.

- **Layout**: compact application header (product identity, file/job control, global actions) ·
  **central viewport as the dominant surface** · a collapsible right **inspector rail** organized by
  intent · a bottom **timeline/scrub strip** · a **status bar** (capability/disclosure honesty
  line) · quick camera controls floating over the viewport · an optional diagnostics drawer.
- **Intent grouping** (not implementation history): **File/Job · Inspect · Appearance · View/Camera ·
  Rendering · Machine/Geometry · Live Progress · Models/Plates · CNC/CAM · Diagnostics**.
- **Contextual controls** (the honesty model as UX): controls read `GcodePreviewState` capability
  data (§4.4 G6) and *explain* unavailability rather than hiding silently — e.g. "Feature coloring
  isn't available because this file doesn't identify feature roles" instead of a disabled option
  labeled `featureRoles: unavailable`. CNC power controls appear only for CNC/laser jobs; per-plate
  controls appear only with multiple plates; model controls separate from toolpath controls.
- **Responsive**: audited at 1920×1080 / 1440×900 / 1366×768 / ~1280×720 and narrow dev windows;
  inspector rail collapses to a drawer; viewport stays useful; scroll containment per panel.
- **Accessibility**: preserve keyboard camera control and shortcuts; focus indicators, semantic
  labels, ARIA on ranges/tabs, non-color-only status, contrast in both chrome themes.
- **Package-consuming**: the Feature Lab is rebuilt on the **published `gcode-preview-core`
  controller** (dogfooding the real contract), which is why the §4.4 core gaps must close first.

### 4.6 Two-tier example strategy + shared infra

Per framework (Vue, React, Svelte, Web Component):

- **Minimal example** — "get a viewer on screen" — small, approachable, unchanged in spirit
  (existing React/Svelte/Vue minimals become the canonical minimals; add a WC minimal).
- **Full showcase** — exercises the relevant public surface — one per framework.
- Optional **lower-level/custom-controls** example where valuable.

Shared, non-bypassing infrastructure (`tools/demo-kit/`, a workspace-internal package — **not
published**): capability/control **metadata** (option lists, labels, capability-gate predicates),
demo **fixtures/scenarios** (the organized corpus, §17 of the mission), **design tokens/CSS**, and
**legend data**. Each framework example imports these *and the real published adapter* — shared data,
framework-native presentation, no copy-pasted 2,000-line panels, and the adapter is never bypassed.

### 4.7 Parity-completion rule (durable process)

Add to the project's feature-completion process (CLAUDE.md + release review): every new public
capability gets a **deliberate parity decision** across Core / Vue / React / Svelte / Web Component /
lower-level API / events / **portable behavioral test** / demo / framework showcase / docs / visual
coverage — recorded, with "not applicable" a valid, explicit answer. A parity checklist item is
added to `RELEASE_REVIEW.md` generation so a capability cannot ship in core and silently vanish from
an adapter.

## 5. Lifecycle

The Feature Lab and examples own only view state; all engine lifecycle stays in the controller
(bind/parse/dispose unchanged). Shared demo-kit metadata is pure data + pure predicates (no engine
handles), so it cannot leak renderer lifecycle into examples.

## 6. Errors & failure behavior

Contextual controls consume the existing honest capability/disclosure signals; unavailable
capabilities are *explained*, never fabricated. New core surfaces (getRenderStats, pickSegment)
return `null` honestly on the 2D renderer / before ready, matching existing conventions.

## 7. Security & resource limits

No change to untrusted-input handling. Examples consume published tarballs the way external
developers do (no `raw` renderer reach-through in the shipped examples). No new network access.

## 8. Performance

No engine performance change. The Feature Lab must not regress first-frame/interaction budgets;
interaction-aware quality (DD-020) is exposed, not altered.

## 9. Testing

Extend the portable behavioral suite (`gcode-preview-core/testing.ts`) from 8 locked behaviors to
cover the currently-untested cross-adapter capabilities: layer range, time scrub, move-kind
visibility, feature-role visibility, retraction markers, **all applicable color modes + gating**,
quality/qualityMode, progressive preview, camera-mode toggle, theme, build-volume apply + cage,
frame content, interaction quality, frame, capture, **getRenderStats/pickSegment (G1/G2)**. Add a
parity guard so a new `GcodePreviewControls` method without adapter coverage fails CI.

## 10. Migration

Additive-only to published API (DD-002 minor). Web Component alignment items that change observed
behavior (E1/E3) are handled with changesets + migration notes if any attribute/event shape changes.
The demo/examples may change freely. No consumer break for cosmetic reasons.

## 11. Observability / diagnostics

`getRenderStats` becomes reachable through the public surface (G1); the Feature Lab's diagnostics
drawer reads it. Privacy-preserving (GPU strings already best-effort, never fabricated).

## 12. Alternatives considered

- **New published "viewer kit" package now (mission §22 outcome C).** Rejected for this pass:
  premature to commit a styled-component package + its design system to semver before the control-
  model logic is proven in the Feature Lab and examples. Recorded as a candidate future epic.
- **Keep the demo on the raw renderer.** Rejected: violates the "examples consume the packages"
  principle and hides adapter bugs (mission §5).
- **Four independent full demos.** Rejected: guarantees drift; the shared demo-kit (§4.6) gives
  parity without duplication while still exercising each real adapter.
- **Outcome B (shared unstyled control-model in the SDK).** Partially adopted: the *logic* (option
  lists, capability predicates, legend/format helpers) is extracted into the internal demo-kit first;
  promotion into a published package is deferred until a real consumer need is demonstrated (§21).

## 13. Risks

- **Scope creep** — mitigated by phasing (§14) and the explicit no-new-package decision.
- **Demo rebuild regresses a niche capability** — mitigated by the exposure matrix as a checklist and
  visual capture at the end.
- **WC alignment breaks a consumer** — mitigated by additive-first, changeset + migration note for
  any shape change, AnyBridge is a WC-adjacent consumer to sanity-check.

## 14. Phased delivery

1. **Audit** (this DD, §4.1–4.3) — done.
2. **Core gaps** (§4.4 G1–G6, E1–E4, D1) — additive API + tests, one changeset.
3. **Design system + Feature Lab** (§4.5) on the published controller.
4. **Two-tier examples + shared demo-kit + WC example** (§4.6).
5. **Parity tests + completion rule** (§4.7, §9).
6. **Real-use validation + visual capture** (mission §24/§26 Phase 5), coverage-matrix update.

## 15. Acceptance criteria

- A developer can reach every relevant capability through their chosen framework; deliberate
  differences documented (§4.7).
- No capability remains reachable *only* via `raw.renderer()` for lack of a public surface (G1/G2/G6).
- A genuinely simple getting-started path remains for each framework; a full showcase exists for
  each, including the Web Component.
- The main demo is a viewport-dominant Feature Lab that consumes the published packages and no longer
  reads as the inherited engineering harness.
- Portable parity tests lock the expanded capability set; a new controls method without adapter
  coverage fails CI.
- The parity-completion rule is enforced in the release review. No core package depends on AnyBridge.
