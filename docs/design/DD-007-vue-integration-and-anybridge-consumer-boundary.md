# DD-007 — Vue Integration and AnyBridge Consumer Boundary

**Status:** **Accepted (2026-07-23, D1–D4 with clarifications; D3 adds the E7 repository-publication mandate)** <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Chestnut Labs
**Date:** 2026-07-23 · **Last revised:** 2026-07-23
**Owning Epic:** E6 (#7) · **Milestone:** M4
**Supersedes / Superseded by:** none
**Related:** DD-002 (package boundaries/versioning this package joins), DD-003 (worker sessions the
composable owns), DD-004 (renderer lifecycle it mounts), DD-005 §4.5 (worker entry selection it
exposes), DD-006 (progress surface it wires), architecture doc §`gcode-preview-vue`, E6 epic (#7),
issue #101 (this DD), **AnyBridge #783** (the consumer-side epic; all AnyBridge-specific work lives
there), `docs/05_ANYBRIDGE_HANDOFF.md`

---

> **Accepted 2026-07-23 — D1–D4 with maintainer clarifications and additions** (D1 amended
> same-day with the multi-framework requirement below).
> **(D1)** **Ship first-class Vue, React, and Svelte integrations as thin adapters over the shared
> engine.** Vue is the reference implementation and must include both a **complete, ready-to-use**
> `<GcodePreview>` component and the `useGcodePreview` composable; the component must remain a
> **shell over the same composable and engine, never a separate implementation**.
> *Additional framework-integration requirement:* the upstream repository supported Vue, React, and
> Svelte integrations — **preserve and modernize that multi-framework capability** as part of the
> package work, even though AnyBridge currently consumes only Vue. Structure the integrations as
> thin framework adapters over the same framework-neutral engine, worker, state model, and
> TypeScript contracts: **Vue** `<GcodePreview>` + `useGcodePreview()`; **React** `<GcodePreview>`
> + `useGcodePreview()`; **Svelte** `<GcodePreview>` plus an equivalent store/action API. Each
> framework supports both adoption levels (ready-to-use component with sensible defaults; a
> lower-level surface for consumers building their own controls/design system). The frameworks
> must **not** contain separate viewer implementations or drift into different feature sets — they
> expose equivalent capabilities, props/options, events/callbacks, worker configuration, and
> TypeScript types wherever framework conventions allow. Vue remains the reference implementation
> and the integration required by AnyBridge, but React and Svelte must be **publishable,
> documented, tested through separate example applications, and included in the
> repository-publication plan** (#109); installation/quick-start examples for all three frameworks
> go into the rewritten README and documentation.
> **(D2)** dual/universal worker: batteries default
> (all supported dialect adapters + `.gcode.3mf`) so consumers work with zero setup, plus a
> consumer-supplied worker path for smaller builds / custom adapters / unusual bundlers / stricter
> CSP; **both paths documented, the default path tested with Vite**. **(D3)** `npm pack` tarballs
> into a genuinely separate test application as the pre-publication proof; **additionally, since
> these packages are now intended to publish, E7 must include a complete repository-publication
> pass** — the repo still reads as the upstream fork and must stand on its own publicly before any
> release: rewrite the README around the current project (capabilities, packages, dialects,
> consumers; install + quick-start for both component and composable; both worker paths; `.gcode`/
> `.gcode.3mf`/build-volume/live-progress/dialect support), update package names/descriptions/
> keywords/repository links/exports/metadata, clearly document upstream relationship and
> attribution, review licensing/notices/contribution/development docs and project status, and
> remove or rewrite stale fork-specific material. Tracked as an E7-linked issue opened with this
> acceptance; scope lands in DD-008. **(D4)** the component carries the **full supported surface**
> through props and matching events, with advanced props **optional with sensible defaults** so
> `<GcodePreview :source="file" />` stays the thin adoption path — no API switch required to reach
> the full viewer.

---

## 1. Problem

Everything a consumer needs exists as framework-neutral packages (session, renderer, progress
mapper), but the first consumer is a Vue application, and gluing worker sessions + a WebGL renderer
+ reactive props into Vue **correctly** is genuinely fiddly: disposal on unmount, HMR re-mount
without leaking workers/GL contexts, SSR-safe imports, canvas sizing (ResizeObserver quirks the
demo already fought), prop-driven state vs. imperative handles, and worker-asset resolution inside
a library dependency. If every consumer solves these independently, the first one (AnyBridge)
solves them inside its app — exactly where this logic must not live (master plan: the viewer must
be reusable by a second application without importing AnyBridge).

E6 ships the **thin** Vue layer that owns those mechanics and nothing else.

### 1.1 Consumer evidence (what the package must work inside)

Surveyed 2026-07-23 from `ChestnutLabs/AnyBridge`:

- **App:** `frontend/` (`anybridge-webui`) — Vue **^3.5**, Vite **^5.4**, vue-tsc, Vitest 2,
  Pinia/vue-router (which this package must NOT touch).
- **Design system:** `frontend/packages/anybridge-ui` — Vue **^3.4** peer, Vite lib build + vue-tsc
  declarations, ESM-first exports map. Consumed by the app as a path dep (`"@anybridge/ui": "*"`).
- **Integration surface (AnyBridge #783):** mount in the File Library preview/validation flow
  (their #593 surface + FileInspector); bytes come from AnyBridge's own
  `GET /files/{id}/content`; telemetry arrives as their normalized `JobProgress` (DD-006 §1.1);
  permissions/safety stay theirs.

Implications: Vue peer `^3.4` (covers 3.4 lib + 3.5 app), ESM library with a Vite-friendly worker
asset, types via vue-tsc-compatible declarations, zero store/router/design-system coupling.

## 2. Scope

- `@chestnutlabs/gcode-preview-vue`: a **headless composable** plus a **thin component** over the
  existing neutral API — parse lifecycle, renderer mount/dispose, progress wiring, capability
  surfacing. No styling system, no UI chrome beyond the canvas. **Vue is the reference
  implementation.**
- **Multi-framework adapters (D1 amendment)**: `@chestnutlabs/gcode-preview-react` (component +
  hook) and `@chestnutlabs/gcode-preview-svelte` (component + store/action API) as thin adapters
  over the same shared engine/state model (§4.6) — modernizing the upstream repository's
  Vue/React/Svelte support. Each ships both adoption levels, its own example application, and
  parity-locked capabilities/types; both are publishable and join the #109 publication plan.
- Worker-entry selection surfaced per DD-005 (batteries default; slim/custom supported).
- Package build (Vite lib + declarations), README + examples, boundary lint.
- **Consumer contract fixture**: a committed Vue consumer that installs the **packed tarball**
  (`npm pack` — no registry publish before E7/DD-008) and runs contract tests in CI, proving
  "committed consumer builds resolve reproducibly".
- Cross-link to the AnyBridge-side integration issue (#783); their DD/issues own everything
  AnyBridge-specific.

## 3. Non-goals

- No `@chestnutlabs/*` **publish** (E7/DD-008 owns the release program).
- No file/job acquisition, network access, telemetry transport, or printer protocols.
- No VueKit/Pinia/vue-router/AnyBridge imports (lint-enforced) and no CSS/design-system shipping.
- No new rendering or parsing capability — this DD adds **zero** features below the Vue seam.
- No Nuxt/SSR *rendering* support (SSR-safe to *import* is in scope; server-side WebGL is not).

## 4. Data contracts / API

### 4.1 Package shape — ACCEPTED (D1: component is a shell over the composable, never a separate implementation)

One package, two entry styles — a headless composable for hosts that own their DOM/UX (AnyBridge's
FileInspector case) and a thin component for drop-in use (examples, second consumers):

```ts
// composable — the primary surface; the component is built on it
export function useGcodePreview(options?: UseGcodePreviewOptions): GcodePreviewHandle;

export interface UseGcodePreviewOptions {
  /** Custom worker factory (DD-005 slim/custom entries). Default: batteries worker. */
  createWorker?: () => Worker;
  renderer?: {
    buildVolume?: BuildVolumeDef;
    quality?: QualityMode | 'auto';
    colorMode?: ColorMode;
    tube?: TubeOptions;
  };
  /** Applied to every parse unless overridden per-call. */
  parseDefaults?: WireParseOptions;
}

export interface GcodePreviewHandle {
  /** Bind the renderer to a canvas; disposes/rebinds safely. Template-ref friendly. */
  canvasRef: Ref<HTMLCanvasElement | null>;
  /** Parse bytes/File and render (replaces the current scene). Progressive preview included. */
  parse(input: Uint8Array | ArrayBuffer | File, opts?: WireParseOptions): Promise<ParseOutcome>;
  cancel(): void;
  /** DD-006: feed observations; mapping + overlay handled internally. */
  observeProgress(obs: ProgressObservation): MappedProgress | null;
  clearProgress(): void;
  // Reactive state (shallow, read-only): parsing, progress { bytesProcessed, totalBytes },
  // result summary (segments/layers/capabilities/warnings), metadata (machine/thumbnails/dialects),
  // presentation mode, activeQuality, layerCount/segmentCount, disclosure notes.
  state: Readonly<GcodePreviewState>;
  // Controls (thin passthroughs): setLayerRange, setScrubPosition, setKindVisible, setColorMode,
  // setQuality, setBuildVolume, frame.
  controls: GcodePreviewControls;
  /** Escape hatches — the neutral objects themselves (advanced consumers; not reactive). */
  raw: { session: GcodeParseSession; renderer: () => ToolpathRenderer | null };
  /** Renderer + session events, re-emitted (also available as Vue emits on the component). */
  onEvent(cb: (e: PreviewEvent) => void): () => void;
  dispose(): void; // idempotent; also runs automatically on scope dispose (onScopeDispose)
}
```

```vue
<!-- component — thin wrapper: canvas + prop/emit wiring, no styling beyond size:100% -->
<GcodePreview
  :source="bytesOrFile"          <!-- re-parse on change -->
  :parse-options="wireOpts"
  :build-volume="volume"
  :quality="'auto'"
  :color-mode="mode"
  :layer-range="[lo, hi]"
  :scrub="segIndexOrNull"
  :progress="progressObservationOrNull"   <!-- DD-006 observation, mapped internally -->
  @ready="..." @parse-error="..." @build-complete="..." @quality-fallback="..."
  @machine-geometry-mismatch="..." @progress-presentation-changed="..." @disclosure="..."
/>
```

The component exposes the composable handle via `defineExpose` for template-ref access.

### 4.2 Lifecycle & environment safety — ACCEPTED

- **Import-safe everywhere**: no `window`/`Worker`/WebGL access at module scope; everything
  constructs on first mount/`parse`. SSR imports succeed; rendering requires a browser (a
  `E_NO_BROWSER` error event otherwise, never a throw during hydration).
- **Unmount = dispose**: worker terminated, renderer disposed (DD-004 rules), mapper reset —
  registered via `onScopeDispose`, so both component and bare-composable usage clean up. HMR
  re-mounts get fresh instances; a leak test guards this.
- **Canvas sizing**: ResizeObserver with an initial explicit fit + window-resize fallback (the
  demo's hard-won pane behavior moves INTO the package so consumers never re-learn it).
- **Context loss**: renderer's own recovery (§5.2) surfaces as events; no package logic.
- **Reactivity boundary**: IR/typed arrays are **never** made reactive (`shallowRef`/`markRaw`) —
  wrapping a 40 B/segment SoA in proxies would be a silent performance disaster.

### 4.3 Worker asset & bundling — ACCEPTED (D2: dual path, both documented, default tested with Vite)

Default worker: `new Worker(new URL('@chestnutlabs/gcode-parser/worker', import.meta.url), { type: 'module' })`
wrapped in `createDefaultWorker()` inside the package. Vite (the evidenced consumer tooling)
resolves dep worker URLs natively; the consumer-smoke harness already proves the pattern for
Vite + Electron. Consumers with other bundlers (or CSP worker restrictions) pass `createWorker`.
The package README documents the `optimizeDeps.exclude` requirement (workspace gotcha) for
linked-dev consumption; the packed tarball path (the contract fixture) must need **no** config.

### 4.4 Boundary & versioning — ACCEPTED

- Dependencies: `@chestnutlabs/toolpath-core`, `@chestnutlabs/gcode-parser`,
  `@chestnutlabs/gcode-renderer-three`. Peers: `vue ^3.4`, `three` (matching the renderer's peer).
  **Lint-enforced forbidden**: pinia, vue-router, any `@anybridge/*`, network modules — the DD-002
  §5 override table gains a `gcode-preview-vue` row.
- Versioning: joins the DD-002 regime; the package is additive-evolvable (new props/events minor).
- The AnyBridge side consumes ONLY the public package surface — enforced socially by #783's
  ownership table and technically by this repo never importing from AnyBridge.

### 4.5 Consumer contract fixture — ACCEPTED (D3: tarballs; E7 gains the repository-publication pass)

`tools/consumer-vue/` (extends the consumer-smoke family): a minimal Vite+Vue app that
1. installs the **packed tarballs** (all four `@chestnutlabs/*` packages via `npm pack`, committed
   lockfile resolving `file:` tarball paths built in CI),
2. mounts `<GcodePreview>`, parses a corpus fixture, asserts contract behaviors (parse resolves,
   canvas mounts, events fire, progress observation maps, capability gates hold, dispose leaves no
   workers), and
3. runs headless in CI (stub-GL where needed, real worker).

This is the "committed consumer builds resolve reproducibly" gate — and it is exactly the shape
AnyBridge's own integration will take, minus their app concerns.

### 4.6 Multi-framework architecture — ACCEPTED (D1 amendment)

Three frameworks must expose equivalent capability without three viewer implementations. The
mechanics the Vue composable owns (session/renderer/mapper orchestration, canvas binding, resize,
bed precedence, progress chain, dispose rules) are framework-agnostic except for reactivity — so
they extract into a small **framework-neutral controller**:

```ts
// @chestnutlabs/gcode-preview-core (headless; no vue/react/svelte imports — lint-enforced)
export function createPreviewController(options: PreviewControllerOptions): PreviewController;
interface PreviewController {
  bindCanvas(canvas: HTMLCanvasElement | null): void;
  parse(input, opts?): Promise<ParseOutcome>;
  cancel(): void;
  observeProgress(obs): MappedProgress | null;
  tickProgress(nowMs): MappedProgress | null;
  clearProgress(): void;
  controls: GcodePreviewControls;
  /** Plain snapshot state + change subscription — each framework maps this to its reactivity. */
  getState(): GcodePreviewState;
  onStateChange(cb: (state: GcodePreviewState) => void): () => void;
  onEvent(cb: (e: PreviewEvent) => void): () => void;
  raw: { session: GcodeParseSession; renderer: () => ToolpathRenderer | null };
  dispose(): void;
}
```

- **Adapters are reactivity bridges only**: Vue (`shallowReactive` + `onScopeDispose`), React
  (`useSyncExternalStore` + effect cleanup), Svelte (readable store + component/action lifecycle).
  Anything beyond the bridge belongs in the controller — that is the drift firewall.
- **Parity is enforced, not hoped for**: the state/options/controls/event **TypeScript contracts
  live in `gcode-preview-core`** and are re-exported (never redeclared) by every adapter; a shared
  behavioral test suite (parse → state → controls → progress → dispose, driven through each
  adapter) runs in all three packages; the E6 exit includes a capability-parity table.
- The Vue composable (phase-1 code) **refactors onto the controller** with its public API and
  tests unchanged — the tests prove the refactor.
- Note: this supersedes the §12 rejection of a neutral facade — that rejection was explicitly
  premised on no second framework consumer existing; the amendment creates the second and third.

## 5. Lifecycle

Component flow: mount → `canvasRef` binds → (source prop set) → worker parse with progressive
preview streaming into the renderer → `ready` with summary + metadata (bed geometry auto-applied
per DD-005 consumer-wins precedence: a `:build-volume` prop wins over file-discovered) → progress
observations map/overlay per DD-006 → unmount disposes everything. `parse()` during an active
parse cancels-then-restarts (session semantics preserved).

## 6. Errors & failure behavior

All session/renderer errors surface as events/emits (`parse-error`, renderer `error` passthrough)
with the structured codes already defined (DD-003 §6, DD-005 §6); the composable never throws from
event context. Prop misuse (e.g. scrub out of range) clamps via the underlying APIs. Absent-browser
environments degrade as §4.2.

## 7. Security & resource limits

No new surface: the package forwards `WireParseOptions` (DD-003/DD-005 limits regimes apply
unchanged) and adds no network, storage, or eval. The default worker is the batteries entry —
consumers wanting the smaller attack/bundle surface pass the slim worker via `createWorker`.

## 8. Performance

- The wrapper adds **no** per-frame or per-segment work: reactive state updates are event-driven
  summaries (numbers/strings), never typed-array copies.
- Prop-driven scrub/layer-range calls the renderer directly (≤ 0.5 ms budget unchanged).
- Bundle: the Vue layer itself ≤ 10 kB min+gz (it is glue); three/parser/renderer dominate and are
  already accounted. Measured in the E6 exit evidence.
- HMR/mount-cycle leak test: 50 mount/unmount cycles → stable worker count and heap (CI).

## 9. Testing

- **Component/composable unit tests** (Vitest + @vue/test-utils + happy-dom, stub GL + real or
  stubbed worker): lifecycle (mount/unmount/dispose/HMR), prop wiring (source change re-parses,
  scrub/layer-range/color/quality passthroughs), progress wiring (observation → presentation
  emit), capability gating passthrough, SSR-import safety, reactivity-boundary (IR never proxied).
- **Contract fixture** (§4.5) in CI on the packed tarballs.
- Boundary lint tests (forbidden imports) as in every package.

## 10. Migration

Purely additive: a new package; no changes to existing packages beyond (possibly) a
`./worker` export-map alias in `gcode-parser` if the current entry path needs a stable specifier
— flagged during phase 1 if required (additive, no schema/protocol impact).

## 11. Observability / diagnostics

`PreviewEvent` re-emits carry the underlying structured events unchanged; the component adds
`disclosure` (decimation/truncation/dialect notes as user-presentable strings — the demo's
disclosure line, packaged). The README documents an event-log recipe.

## 12. Alternatives considered

- **Component-only** (no composable): rejected — AnyBridge's FileInspector wants headless control;
  a component-only API forces template gymnastics for imperative flows.
- **A new framework-neutral `createViewer()` facade beneath the Vue layer**: rejected for v1 — the
  session/renderer/mapper triple IS the neutral API; inserting a fourth abstraction now would
  freeze its shape before a second framework consumer exists to justify it (revisit at E8/2D or a
  React consumer).
- **Publishing to a private registry for the fixture**: rejected — `npm pack` tarballs prove the
  same resolution properties without standing infrastructure before E7.
- **Shipping styles/chrome (toolbars, sliders)**: rejected — AnyBridge has a design system; chrome
  belongs to hosts (the demo remains the reference implementation of controls).

## 13. Risks

- **Worker URL resolution outside Vite** (webpack, etc.): mitigated by the `createWorker` escape
  hatch + README matrix; the evidenced consumer is Vite.
- **Vue reactivity accidentally deep-proxying IR buffers**: mitigated by `shallowRef`/`markRaw` +
  an explicit test asserting non-proxied identity.
- **AnyBridge concerns leaking downward** over time: mitigated by the lint row + contract fixture
  (which has no AnyBridge deps by construction) + #783's ownership table.
- **Tarball fixture drift** (stale packs): mitigated by CI packing fresh from the workspace on
  every run while the committed lockfile pins the resolution shape.

## 14. Phased delivery (amended: multi-framework phases 5–7)

1. **Package scaffold + composable core** — workspace package, boundary lint row, `useGcodePreview`
   (session+renderer lifecycle, parse, controls, dispose/HMR safety), unit tests. Fixture-manifest
   and README skeletons start here (evidence-from-phase-1, per precedent).
2. **Component + progress + events** — `<GcodePreview>`, prop wiring, DD-006 observation prop +
   presentation emits, disclosure surface, capability gating tests.
3. **Package build + docs** — Vite lib build + declarations + exports map (worker specifier
   resolved), README + examples (composable and component), demo page consumes the package to
   prove parity.
4. **Consumer contract fixture** — `tools/consumer-vue` on packed tarballs, contract tests, CI
   wiring, leak test.
5. **Shared controller extraction** (`@chestnutlabs/gcode-preview-core`, §4.6) — the Vue
   composable's engine glue moves into `createPreviewController`; shared TS contracts + the
   framework-portable behavioral test suite; the Vue package refactors onto it with its public
   API and tests unchanged.
6. **React adapter** (`@chestnutlabs/gcode-preview-react`) — `useGcodePreview` hook
   (`useSyncExternalStore` bridge) + `<GcodePreview>` component; separate example application;
   shared behavioral suite green.
7. **Svelte adapter** (`@chestnutlabs/gcode-preview-svelte`) — store/action API + `<GcodePreview>`
   component; separate example application; shared behavioral suite green.
8. **E6 exit** — bundle/leak evidence vs §8 for all adapters, **capability-parity table** across
   Vue/React/Svelte, AnyBridge #783 cross-link comment, #109 publication-plan update (three
   frameworks), docs current-state, epic checklist.

## 15. Acceptance criteria

- [ ] Composable + component land with lifecycle/HMR/SSR-import safety tests green.
- [ ] Prop/event surface wires every shipped capability (parse, preview, bed, colors, quality,
      scrub, progress) with no AnyBridge/VueKit/Pinia imports (lint-verified).
- [ ] Contract fixture builds from committed lockfile + packed tarballs and passes in CI.
- [ ] §8 evidence: wrapper bundle ≤ 10 kB min+gz; 50-cycle leak test stable.
- [ ] README/examples published; AnyBridge #783 cross-linked with the consumption recipe.
- [ ] No changes to worker protocol, IR, or any lower package's public surface (beyond an
      additive worker-entry alias if phase 1 finds it necessary — flagged, not silent).
- [ ] **Multi-framework (D1 amendment)**: React and Svelte adapters ship both adoption levels as
      thin bridges over `gcode-preview-core` (no separate viewer implementations — shared TS
      contracts re-exported, never redeclared); the shared behavioral suite passes in all three
      packages; each has a working example application; the E6 exit records the capability-parity
      table; #109 covers all three frameworks' install/quick-start docs.

## Decision log

- **2026-07-23 — D1 amended (maintainer, same-day).** The upstream repository supported Vue,
  React, and Svelte integrations (upstream README: community `gcode-preview-react` /
  `gcode-preview-svelte` wrappers) — **preserve and modernize that multi-framework capability**:
  first-class Vue/React/Svelte adapters over the shared engine, each with both adoption levels,
  parity-locked capabilities/types (no separate implementations, no feature drift), React/Svelte
  publishable + documented + tested via separate example apps + included in the #109 publication
  plan; README quick-starts for all three. Vue remains the reference implementation and the
  AnyBridge requirement. Architectural consequence recorded in §4.6: the engine glue extracts into
  `@chestnutlabs/gcode-preview-core` (`createPreviewController`) and adapters become reactivity
  bridges — superseding the §12 facade rejection, whose premise (no second framework consumer) the
  amendment removes. Phases 5–7 added (#112 core extraction, #113 React, #114 Svelte); the exit
  becomes phase 8 (#108).
- **2026-07-23 — Accepted.** Maintainer accepted **D1–D4 with clarifications**: (D1) component is
  a complete, ready-to-use surface but strictly a shell over the composable/engine; (D2) dual
  worker path — batteries default + consumer-supplied — both documented, default path tested with
  Vite; (D3) tarball fixture confirmed **and** — packages now being intended for publication — E7
  gains a mandatory **repository-publication pass** (README rewrite around the current project,
  package metadata, upstream attribution, licensing/contribution review, stale fork material
  removed; the repo must stand alone publicly before release) tracked as an E7-linked issue and
  scoped into DD-008; (D4) full prop/event surface with advanced props optional and defaulted so
  `:source`-only stays the thin path. Implementation issues opened under epic #7.
- **2026-07-23 — Proposed.** Open maintainer decisions:
  - **D1** Package shape: headless composable + thin component in one package (proposed) vs.
    component-only or split packages.
  - **D2** Default worker: batteries entry via `new URL` with `createWorker` escape hatch
    (proposed) vs. requiring consumers to always supply the worker.
  - **D3** Contract fixture form: committed `tools/consumer-vue` app on `npm pack` tarballs with
    a pinned lockfile (proposed) vs. registry-based (needs infra) or link-based (weaker
    reproducibility evidence).
  - **D4** Component prop surface: the full controls set as props (proposed, §4.1) vs. a minimal
    `source`-only component pushing everything else through the composable.
