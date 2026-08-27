# @chestnutlabs/gcode-renderer-three

## 0.18.0

### Minor Changes

- [#416](https://github.com/ChestnutLabs/gcode-preview/pull/416) [`0ebeadf`](https://github.com/ChestnutLabs/gcode-preview/commit/0ebeadfa839e52baf243ef07b5807f3974bbac7e) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(renderer): non-rectangular build-bed geometry (DD-030 D3)

  The build volume can now draw an **honest non-rectangular bed** — delta, round, or irregular — instead of
  only a rectangle. `BuildVolumeDef` gains an optional `shape?: BedShape`
  (`{kind:'rect'} | {kind:'circular', center, diameter} | {kind:'polygon', points}`): a circle is
  polygonized, the outline is filled and drawn, and the floor grid is **clipped to the outline** so the
  printable area reads correctly (a round bed is no longer a square with a circle floating over it). The
  `mesh` escape hatch for a fully custom bed mesh is reserved for a later phase.

  `machineToVolume()` now maps a discovered `MachineGeometry.bed` of kind `circular`/`polygon` onto that
  `shape`, so a **discovered** round/delta bed renders as its true outline instead of being collapsed to its
  bounding rectangle (a visible improvement for delta/round printers). Callers supply the shape (from a
  machine profile, a config, wherever); the renderer just draws the polygon — no profile parsing in the
  library, no vendor semantics baked in.

  Additive and safe: a bed with no `shape` (or `{kind:'rect'}`) takes the original rectangular path and is
  **byte-identical** — the rectangular grid, plate, cage, excluded-region outlines, and origin tripod are
  unchanged. The volume cage stays a bounding box (the bed outline carries the shape). First increment of
  the DD-030 renderer/viewer interoperability batch.

- [#418](https://github.com/ChestnutLabs/gcode-preview/pull/418) [`c950339`](https://github.com/ChestnutLabs/gcode-preview/commit/c95033908e3ebaeb07b6f7e6f2487672dcc463f0) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(renderer): interactive view capture() → Blob (DD-030 D1)

  The interactive viewer can now hand back **what is on screen right now** as an image `Blob` — for a
  user-selected thumbnail, a large-file thumbnail fallback, or a screenshot. New `capture(opts?)` where
  `opts` is `{ width?, height?, format?, quality?, background? }` (all optional; defaults match the live
  view).

  Available on every interactive surface: `GcodePreviewControls.capture()` (so the Vue, React, Svelte, and
  Web-Component adapters all inherit it — the Web Component also exposes an imperative `capture()` method),
  and `ModelViewer.capture()` on the model-viewer handle. The toolpath `ToolpathRenderer` and the shared
  `InteractiveStage` carry the implementation.

  **Mechanism (render-to-target).** Capture renders the current scene + active camera into an off-screen
  `WebGLRenderTarget` at the requested size and reads it back, rather than flipping the interactive
  context's `preserveDrawingBuffer` (which would tax every interactive frame). That gives an arbitrary
  output size and an independent/transparent background **without** disturbing the live view, and reuses the
  headless still path's "single render, then read pixels" recipe. The thumbnail is framed at its own aspect
  so it isn't distorted; the live view is repainted afterward. The library returns the `Blob` and **never**
  triggers a download — the caller owns the pixels (same contract as `renderStill`).

  **Honest.** When the renderer cannot render-to-target (the 2D renderer, a stub GL / no WebGL) or the stage
  is disposed / its context is lost, `capture()` rejects with a typed `CaptureUnsupportedError`
  (`code: 'E_CAPTURE_UNSUPPORTED'`) — never fabricated output. Purely additive (a new optional method on the
  renderer contract; no existing signature changed). Final increment of the DD-030 renderer/viewer
  interoperability batch (bed + per-plate scope + capture).

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.18.0
  - @chestnutlabs/toolpath-core@0.18.0

## 0.17.0

### Minor Changes

- [#404](https://github.com/ChestnutLabs/gcode-preview/pull/404) [`b362f9a`](https://github.com/ChestnutLabs/gcode-preview/commit/b362f9a81232a21ff35a4a23d84c6300db83f28f) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(renderer): frame the printed model via `modelBounds` precedence (DD-026 D5/D6)

  `frameContent: 'object'` now frames the classifier's model bounds, using the precedence
  `modelBounds → objectBounds → bounds`. A label-less file that still marks its housekeeping (a prime
  tower with no object channel) now frames the model, and a Bambu prime tower emitted inside an open
  object bracket no longer inflates the frame (it is excluded from `modelBounds` even though it carries a
  member label). `objectBounds` remains the second choice so nothing regresses for files that only label
  objects.

  The `E_FRAME_CONTENT_UNAVAILABLE` disclosure now fires only when **both** `modelBounds` and
  `objectBounds` are empty — i.e. the file is genuinely unclassifiable and framing falls back to all
  extrusion — and the message reports the `nonModelClassification` confidence. No geometry, colour, or
  quality change; framing target only.

### Patch Changes

- [#406](https://github.com/ChestnutLabs/gcode-preview/pull/406) [`d1de1b4`](https://github.com/ChestnutLabs/gcode-preview/commit/d1de1b407389321442289a5be5d3104c60b68060) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - fix(renderer): geometry-pool failure degrades to serial tubes, never an unhandled rejection (DD-028)

  A tube build that engaged the worker pool could fail two ways that weren't both handled: a **runtime**
  worker error fell back to _lines_, and a **synchronous construction** failure — `new Worker(new
URL('./geometry-worker.js', import.meta.url), { type: 'module' })` throwing when a bundler leaves
  `import.meta.url` undefined (e.g. an esbuild `format: 'iife'` bundle) — escaped the build's try/catch on
  a fire-and-forget call and surfaced as an **unhandled promise rejection**, with no fallback at all.

  Both failure modes now degrade to a **serial main-thread tube build** via the new internal
  `fallbackToSerialTubes`, not to lines: the pool was sized against the memory budget, so the tubes
  already fit — only the worker couldn't run — so the quality is preserved (identical scene to
  `geometryConcurrency: 'off'`). A genuine memory/budget limit still degrades to lines downstream through
  the serial build's own tube-budget path. The degradation is recorded as a `RenderStats` disclosure
  (`pool→serial-tubes: …`) and `buildParallelism` flips to `'main'` — never silent. A defensive `.catch`
  at the call site guarantees no unhandled rejection can escape.

  This makes the DD-028 pool safe to enable in headless bundlers that can't construct the module-worker
  URL: a failed/absent worker now costs single-threaded tube quality, not a broken render.

- Updated dependencies [[`214b0db`](https://github.com/ChestnutLabs/gcode-preview/commit/214b0db2dd9d8aa177d80969bdb59173d33121a3)]:
  - @chestnutlabs/toolpath-core@0.17.0
  - @chestnutlabs/gcode-colors@0.17.0

## 0.16.0

### Minor Changes

- [#399](https://github.com/ChestnutLabs/gcode-preview/pull/399) [`6587d99`](https://github.com/ChestnutLabs/gcode-preview/commit/6587d9994dde77dd5488136e9b46257661c16c2e) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(renderer): cost/capability-driven pool activation + `'auto'` single-reveal decision (DD-028 D4 / DD-029 Phase D)

  Replaces the placeholder segment-count threshold with a **render-cost estimate** that scales with the
  real work (ring vertices) and the detected capability (software rasterizers weighted heavier). One
  estimate drives two decisions: whether the geometry worker pool is worth engaging, and whether
  `progressivePreview:'auto'` takes the single-reveal `'hold'` path (expensive tube builds) or streams
  `'lines'` (cheap builds, and always while parsing). Calibrated from the RR-008 Phase-0 measurements; a
  relative classifier, never surfaced as a precise time.

  Tuning validated (`results/dd-028-chunk-sweep-2026-08-26.md`): the renderer's existing 2048-segment
  chunk target is near-optimal for the pool (**6.46×** at opossum scale on 8 cores) — small chunks keep
  the memory cap generous, and large chunks degrade _gracefully_ to fewer workers (never an OOM). No
  re-chunking needed. `'auto'` now functionally picks `lines`/`hold`; the option default still stays
  `'lines'` pending the owner's hardware human-pass.

- [#397](https://github.com/ChestnutLabs/gcode-preview/pull/397) [`1c54132`](https://github.com/ChestnutLabs/gcode-preview/commit/1c54132a39713c3c6d582e0b6820b411eff40d20) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(renderer): geometry worker pool — parallel tube build (DD-028, first phase)

  Adds a bounded, capability-aware `GeometryWorkerPool` that builds tube chunks across workers and returns
  them in **deterministic chunk order**, byte-identical to a serial build. Because a tube chunk is
  self-contained (RR-008 Phase 1), a chunk crosses the worker boundary as a single transferable
  `positions` buffer — no `ToolpathIR`, no `SharedArrayBuffer`. Ships:
  - `handleGeometryRequest` — the host-agnostic kernel (the same `buildTubeChunk`, fed the chunk payload).
  - `GeometryWorkerPool` + `resolvePoolSize` — the bounded pool with backpressure + deterministic ordering.
    Sizing is `clamp(coreBudget − 1, 1, MAX)` — `hardwareConcurrency` in the browser; a Node/sidecar caller
    passes the **cgroup quota**, not `os.cpus()`.
  - `geometry-worker.js` — the browser Web Worker entry (bundler-friendly, injectable factory for tests).

  Measured (worker_threads, opossum-scale 2.67M segments): serial ~10.2 s → **~2.1 s at 8 workers (4.9×)**,
  byte-identical at every worker count. The renderer build-path wiring, memory-aware in-flight cap,
  cost/capability activation estimate, and the Node/sidecar adapter land in the follow-up phase against
  this proven kernel. No change to the current build path yet (the pool is exported but not yet the default
  build route); FDM geometry byte-identical.

- [#398](https://github.com/ChestnutLabs/gcode-preview/pull/398) [`fdc9111`](https://github.com/ChestnutLabs/gcode-preview/commit/fdc9111c0917af55e41fff9d20464ebbc3444589) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(renderer): wire the geometry worker pool into the build path (DD-028 [#1](https://github.com/ChestnutLabs/gcode-preview/issues/1)+[#2](https://github.com/ChestnutLabs/gcode-preview/issues/2))

  The renderer now builds tube geometry across the worker pool when engaged: `geometryConcurrency:
'auto'` (default) sizes a **capability- and memory-aware** pool and uses it for tube builds above a
  cost threshold; `'off'` forces the synchronous path; a number pins the worker count. Extrude chunks
  build on workers and stream back to the main thread (each wrapped + uploaded as it arrives, so peak
  transient geometry is memory-bounded); travel/wipe/lines stay inline. Output is **byte-identical** to
  the serial build — same kernel, same `positions` — with deterministic assembly.
  - **Capability sizing:** `clamp(coreBudget − 1, 1, MAX)` (browser `hardwareConcurrency`; Node/sidecar
    the cgroup quota), further capped by memory so `workers × maxChunkBytes ≤ geometryMemoryBudgetBytes`
    (proactive — a cgroup OOM is uncatchable). Never oversubscribes cores or memory.
  - **Safe fallbacks:** a worker failure degrades to continuous lines (never chopped); a newer `setIR`
    or dispose invalidates a stale in-flight build via a generation guard.
  - **Wiring:** `gcode-preview-core` defaults `createGeometryWorker` to the batteries-included browser
    Web Worker (`createBrowserGeometryWorker`) in a browser; Node/headless stays synchronous. New
    `geometryConcurrency` / `geometryMemoryBudgetBytes` options on both the renderer and the controller.
  - **Diagnostics:** RenderStats gains `buildParallelism: 'main' | 'pool'` and `workerCount`.

  FDM geometry byte-identical. The cost/capability activation estimate and the Node/sidecar worker_threads
  adapter follow in the next phase.

- [#396](https://github.com/ChestnutLabs/gcode-preview/pull/396) [`ecfa56b`](https://github.com/ChestnutLabs/gcode-preview/commit/ecfa56b098d721cd5d636f594d07eda9ac2be067) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(renderer): single clean reveal — strengthen `progressivePreview:'hold'` + add `'auto'` (DD-029 Phase B)

  `progressivePreview` gains `'auto'` (`'auto' | 'lines' | 'hold' | 'off'`), and `'hold'` becomes a **true
  single clean reveal**: the growing scene is no longer rendered on every build tick (the ~187
  intermediate renders RR-008 §8.1 measured) — the completed scene is rendered exactly **once**, at
  completion. Previously `'hold'` only suppressed the line _preview_ but still re-rendered the growing tube
  scene each tick.

  `'auto'` (the eventual default) will pick `'lines'` vs `'hold'` per build from a render-cost/capability
  estimate; until that estimate lands (DD-029 Phase D) it resolves to `'lines'`, so **no behavior changes
  on upgrade** (the option default stays `'lines'`). No mode drops extrusion segments or lowers final
  geometry quality — this only controls how often incomplete work is drawn. Headless `renderStill`
  (`renderDuringBuild:false`) is unaffected. Consumers wanting the single reveal (e.g. AnyBridge) select
  `'hold'` explicitly.

- [#394](https://github.com/ChestnutLabs/gcode-preview/pull/394) [`808dc56`](https://github.com/ChestnutLabs/gcode-preview/commit/808dc56bf377a435bc457d16fc51e195734e2bb5) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(renderer): staged preparation progress — `stage` event (DD-029 Phase A)

  Adds a `stage` renderer event and `PreparationStage` type (DD-029 §4 D2) so consumers can show honest
  preparation status instead of a bare spinner. The renderer emits `building-geometry` (with a real
  `progress` fraction + `{built,total}` counts — the stage the user actually waits on), `preparing-gpu`,
  and `ready`. `ready` coincides with `buildComplete` (never before it), and preparation failures still
  terminate through the existing `error` path — there is no stage failure variant, so a consumer keys its
  overlay off both terminals and never hangs.

  Additive: `buildProgress`/`buildComplete`/`parse-progress` are untouched. (`parsing`/`classifying` are
  emitted by `@chestnutlabs/gcode-preview-core` in a follow-up.) No geometry or render-policy change.

- [#388](https://github.com/ChestnutLabs/gcode-preview/pull/388) [`f3ce24f`](https://github.com/ChestnutLabs/gcode-preview/commit/f3ce24ff5439ef44ca4bac8a12eda91d187f410f) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(renderer): render diagnostics — `getRenderStats()` + `renderStats` event (DD-027 Phase 1)

  Adds a capability-honest `RenderStats` snapshot so consumers can read _what the renderer is actually
  running on_ and _why a build was slow or degraded_ instead of inferring it. `ToolpathRenderer` now
  exposes `getRenderStats(): RenderStats | null` and emits a `renderStats` event at build-complete
  carrying:
  - **GPU:** `backend`, `webglVersion`, `capability` (hardware/software/unknown), and the raw
    `gpuRenderer`/`gpuVendor` strings — the answer to "is my GPU actually being used, or is this a
    software fallback?" (via the new best-effort `probeGpuInfo`, which reads the live context once).
  - **Geometry:** `geometryMode`, source vs rendered segment counts, `decimationApplied`, `vertexCount`,
    `drawCalls`, and `tubeBytes`/`tubeByteBudget` (the latter set only when the budget actually
    constrained the build).
  - **Timings:** `geometryBuildMs` and `firstRenderMs` (`parseMs`/`totalReadyMs` are `null` here — core
    fills them when it re-emits, DD-027 Phase 2).
  - **Policy:** `qualityMode` and `disclosures[]` (honest degradation reasons already emitted).

  Every field is a real value or `null`/`'unknown'` — never fabricated when a backend genuinely can't
  provide it (2D canvas, privacy-gated `WEBGL_debug_renderer_info`, parse timing the renderer never
  sees). Read-only; FDM geometry byte-identical.

- [#375](https://github.com/ChestnutLabs/gcode-preview/pull/375) [`de453cb`](https://github.com/ChestnutLabs/gcode-preview/commit/de453cb3a84275dc27c89c20381c7f91289a6a83) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - `renderStill` builds to completion and renders once — large headless stills no longer pay for dozens of discarded renders

  A `renderStill` builds its geometry across many microtask ticks, and the incremental build rendered
  the whole (growing) scene **on every tick** — for a big tube mesh in software WebGL that's
  dozens-to-hundreds of full MSAA rasterizations, all discarded except the last. A still only needs the
  final frame.

  The `ToolpathRenderer` gains a **`renderDuringBuild`** option (default `true`, preserving the
  interactive viewer's progressive-build feedback). `renderStill` now sets it `false`: it builds the
  geometry to completion and renders **once**, cutting the per-tick render waste that dominates a large
  still's time in software rendering. Output is pixel-identical; `buildComplete` and all build events
  still fire.

  Note: this is one lever; a large still still builds the full tube mesh. Defaulting thumbnails to
  `lines`, capping segments, and reusing the GL context across stills remain follow-ups.

- [#390](https://github.com/ChestnutLabs/gcode-preview/pull/390) [`9cd66b2`](https://github.com/ChestnutLabs/gcode-preview/commit/9cd66b2f23aa32c8832d9e9da13c025cf86278b1) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - refactor(renderer): self-contained tube-chunk kernel — `buildTubeChunk(chunk, opts)` (RR-008 Phase 1)

  `buildTubeChunk` and `findPolylines` now read the chunk's own `positions` buffer instead of indexing
  back into the `ToolpathIR`. Each `GeometryChunk` already carries its segment endpoints (6 floats/seg),
  so the tube kernel becomes **fully self-contained** — a chunk can be handed to a worker as a single
  transferable buffer with no IR reference and no `SharedArrayBuffer`. This is the low-risk enabler for
  the RR-008 worker-pool phase; output is **byte-identical** to the previous implementation (the same
  Float32 endpoints, read from a different source).

  **Signature change (0.x minor):** the exported `buildTubeChunk(ir, chunk, opts)` drops its first
  argument → `buildTubeChunk(chunk, opts)`. Consumers using the high-level `ToolpathRenderer` are
  unaffected; only direct callers of the low-level primitive need to drop the `ir` argument. No rendered
  geometry, ordering, continuity, or output changes.

### Patch Changes

- Updated dependencies [[`bf032d2`](https://github.com/ChestnutLabs/gcode-preview/commit/bf032d2b4e0ce36dcbd8020caead2a512ca3b618)]:
  - @chestnutlabs/toolpath-core@0.16.0
  - @chestnutlabs/gcode-colors@0.16.0

## 0.15.0

### Minor Changes

- [#373](https://github.com/ChestnutLabs/gcode-preview/pull/373) [`8229075`](https://github.com/ChestnutLabs/gcode-preview/commit/8229075e2737c360c5d255e438ce140f4fbb13da) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - `progressivePreview` — a during-parse preview curtain over the [#60](https://github.com/ChestnutLabs/gcode-preview/issues/60) streaming preview

  New public option/prop/attribute (renderer + core controller + all four adapters), plus a
  `setProgressivePreview` control. It governs only what shows WHILE parsing — orthogonal to
  `quality`/`qualityMode`, which govern the FINAL representation:
  - **`'lines'`** (default, backward-compatible): stream the progressive line preview as it parses,
    then replace it with the final build. Existing behaviour — unchanged for current consumers.
  - **`'hold'`**: keep parsing/building and keep emitting progress (`previewAppend`; `parse-progress`
    flows in every mode), but reveal NO incomplete/neutral line preview — the first thing shown is the
    final, correctly-coloured, policy-quality build. A single clean reveal with a live progress signal,
    removing the "renders neutral, then re-renders coloured" double-take on streamed files.
  - **`'off'`**: suppress the progressive preview entirely (no geometry, no `previewAppend`) — the
    consumer supplies its own loading/progress treatment until the final build is revealed.

  The revealed representation is always the policy-correct one (full tubes at `full`, disclosed lines
  at `adaptive` per budget) — never a silent large-file lines fallback (DD-023 alignment). 3D only;
  the 2D renderer is a no-op (it has its own low-resource progressive cut).

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.15.0
  - @chestnutlabs/toolpath-core@0.15.0

## 0.14.0

### Minor Changes

- [#367](https://github.com/ChestnutLabs/gcode-preview/pull/367) [`60e24e1`](https://github.com/ChestnutLabs/gcode-preview/commit/60e24e15b6b72e9aa097f4d2fd22b0c91a480cea) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(renderer): `qualityMode` fidelity policy — Full / Adaptive / Fast (DD-023 §4 D6, Phase B)

  Adds a `qualityMode` option/prop (and `setQualityMode`) across the toolpath renderer, the core controller,
  and all four adapters — the fidelity **policy**, distinct from the geometry `quality` tier (`lines`/`tubes`):
  - **`'full'`** — render the COMPLETE representation: no every-Nth decimation, full-radial continuous tubes,
    and **no budget-driven tubes→lines fallback** (only the per-chunk vertex safety net remains). So a normal
    large plate renders at full quality on capable hardware instead of being gated down by the static ceilings.
  - **`'adaptive'`** (default) — the capability-aware auto path (`auto` decimation + `tubeByteBudget`
    cross-section coarsening, disclosed). Reproduces today's behaviour exactly.
  - **`'fast'`** — explicitly trade fidelity for responsiveness (flat lines).

  This is the consumer control from the DD-023 Phase B contract: a user/admin picks the policy; `'full'` never
  silently degrades. Capability-aware **auto** budget selection (classifier-driven Adaptive) and the
  too-heavy-for-this-client signal land in a later increment. Additive — the default `'adaptive'` preserves
  current behaviour.

### Patch Changes

- [#369](https://github.com/ChestnutLabs/gcode-preview/pull/369) [`c99b221`](https://github.com/ChestnutLabs/gcode-preview/commit/c99b2219566b6427c3d11d37be04876415db3bea) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - fix(renderer): tubes are never segment-decimated — continuous, never chopped (RR-006 / DD-023)

  Tube geometry is now built with **decimation 1 regardless of policy**: `autoDecimation` drops every-Nth
  extrusion segment, which for tubes leaves the survivors non-contiguous so the path-builder splits them into
  disconnected capped stubs — visibly chopped tubes (the RR-006 continuity break, via the `autoDecimation`
  lever that the v0.12.0 fix did not cover). Tube memory is bounded **only** by the continuity-preserving
  cross-section (radial) budget; when even a 3-sided tube can't fit, the render degrades to **continuous
  lines** (also undecimated) — never chopped tubes. This makes the honest degradation order full-radial tubes →
  lower-radial tubes → continuous lines. On the current static budget a large forced-`tubes` file (≳ ~1.9 M
  extrusion segments) now renders as continuous lines instead of chopped tubes; capability-aware budgets
  (later) raise that ceiling so capable hardware renders continuous tubes. `qualityMode: 'full'` stays the
  uncompromised reference (full-radial, no fallback).

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.14.0
  - @chestnutlabs/toolpath-core@0.14.0

## 0.13.0

### Minor Changes

- [#358](https://github.com/ChestnutLabs/gcode-preview/pull/358) [`377fc70`](https://github.com/ChestnutLabs/gcode-preview/commit/377fc7076e42a6044a9e10f2d4b27bd99fa133f3) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(renderer): shared client render-capability classifier (DD-023 Phase A)

  Adds a pure, fail-safe WebGL render-capability classifier (`classifyRenderer`, `detectRenderCapability`,
  `resolveCapability`) plus the `RenderCapability` / `CapabilityHint` / `QualityPolicy` types — the shared
  seam a later phase uses to size a generous budget on hardware and a conservative one on software (DD-023 §4
  D1). Classifies the **inner** renderer of an `ANGLE (...)` string (never the wrapper); an unrecognized
  string or a blind `WEBGL_debug_renderer_info` extension resolves conservatively to software; a
  GPU-fell-to-SwiftShader string classifies software (the safe direction). **No rendering behavior changes** —
  this is the classifier + types only; the budget/`qualityMode` wiring lands in later phases.

- [#361](https://github.com/ChestnutLabs/gcode-preview/pull/361) [`b8dd6a7`](https://github.com/ChestnutLabs/gcode-preview/commit/b8dd6a7ce05add28f922a7f71641eebe0778a146) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model): staged loading progress on createModelViewer (DD-024 Phase A)

  Adds the shared, typed, consumer-neutral loading-progress contract (`LoadStage` / `LoadUnit` / `LoadProgress`
  in `gcode-renderer-three`) and wires it into `createModelViewer` via a new `onProgress` option — closing the
  gap where the model renderer emitted no progress at all (large models "felt hung"). Events carry typed
  `stage` / `done` / `total` / `unit` (or an honest `indeterminate`) and **no human-facing copy** — the
  consumer owns all wording/i18n. `setSource` emits `parsing` (indeterminate) → `building-geometry` with real
  per-object counts → `ready`. Every event is **generation-scoped**: a superseded/cancelled `setSource` can
  never advance the next load's progress. No render behavior changes.

### Patch Changes

- [#362](https://github.com/ChestnutLabs/gcode-preview/pull/362) [`3be5312`](https://github.com/ChestnutLabs/gcode-preview/commit/3be531219cede19168ddf042ee7954c14d73d74c) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - fix(renderer): tube memory budget counts only extrude segments, not travel/wipe (RR-006 correction)

  The `tubes` budget check passed `totalSegmentsIncluded` — which sums extrude **and** travel/wipe segments —
  to `tubeRadialForBudget`, but tube geometry is only built for `extrude` chunks (travel/wipe always render as
  flat lines). On a plate with heavy inter-part travel (e.g. an 814-part full sheet), the non-tube travel
  segments wildly inflated the count, so a file whose actual tube geometry would fit the budget fell back to
  lines prematurely. The budget now counts only the extrude (tube-eligible) segments, so travel-heavy plates
  render as continuous tubes instead of dropping to lines. `autoDecimation` was already extrude-only and is
  unchanged; this only corrects the tube byte-budget check.

- Updated dependencies [[`f14849d`](https://github.com/ChestnutLabs/gcode-preview/commit/f14849d5f88eb9957a75bccf2f14da75ebb44a4e)]:
  - @chestnutlabs/gcode-colors@0.13.0
  - @chestnutlabs/toolpath-core@0.13.0

## 0.12.0

### Minor Changes

- [#352](https://github.com/ChestnutLabs/gcode-preview/pull/352) [`8bd6bbd`](https://github.com/ChestnutLabs/gcode-preview/commit/8bd6bbd1dfe7539ee4e3357f84de74c2eb703462) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - fix(renderer): bound tube memory by coarsening the cross-section, not by dropping segments (RR-006 correction)

  The v0.10.0 tube-memory budget bounded memory by **decimating segments** (drawing every Nth). For _tubes_
  that is destructive: a mesh/tube surface loses continuity when segments are dropped — each survivor becomes
  a disconnected, capped stub, so a smooth wall renders as a spiky hairball (and a shape as broken blocks) on
  large forced-`tubes` files. Screenshots from production confirmed it.

  The correct lever, mirroring the DD-022 mesh finding, is to reduce the tube's **cross-section resolution**
  (fewer sides per tube) while **keeping every segment** — the path stays continuous, the tube is just a bit
  lower-poly — and fall back to flat lines only when even the minimum cross-section (3 sides) blows the
  budget. New `ToolpathRendererOptions.tubeByteBudget` (default ~450 MB CPU, safe in a 2 GB cgroup) drives it;
  `tubeSegmentBudget` (v0.10.0) is **deprecated** and ignored (it caused the spikes). New exports:
  `tubeRadialForBudget`, `tubeSegmentBytes`, `TUBE_CPU_BYTE_BUDGET`, `MIN_RADIAL_SEGMENTS`.

  Also fixes the ordinal in the decimation disclosure string ("every 3rd", not "every 3th").

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.12.0
  - @chestnutlabs/toolpath-core@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.11.0
  - @chestnutlabs/toolpath-core@0.11.0

## 0.10.0

### Minor Changes

- [#338](https://github.com/ChestnutLabs/gcode-preview/pull/338) [`a6ae736`](https://github.com/ChestnutLabs/gcode-preview/commit/a6ae736dab468960939b477964790c6ce9130572) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(renderer): bound tube-mesh memory with a tube-segment budget (fix ~2 GB-cgroup OOM on large forced-tube files, RR-006)

  Large toolpath files (≈1.6 M+ segments) rendered as **tubes** — the quality a card/thumbnail forces —
  OOM-killed the render worker in a 2 GB memory cgroup, in both the headless `renderStill` sidecar and the
  browser render worker. Root cause: tube geometry costs ~23× the memory of lines (~552 B/segment), but
  `autoDecimation`'s reduction thresholds were calibrated for lines, so a segment count that is harmless as
  lines got **zero** decimation as tubes and allocated ~850 MB CPU + a second ~850 MB copy on GPU upload.

  Tube mode now decimates to a **`TUBE_SEGMENT_BUDGET`** (new export, default ~400k kept segments) so tube
  memory stays bounded (~700 MB peak, safe inside a 2 GB cgroup). The reduction is **disclosed** via the
  existing `decimationApplied` (nothing silently dropped) and **always preserves layer-boundary segments**
  so silhouettes and layer counts stay honest. New `ToolpathRendererOptions.tubeSegmentBudget` and
  `ChunkBuildOptions.tubeSegmentBudget` let a memory-rich host raise it or a tighter sidecar lower it.

  Lines mode and small/normal tube files are **unchanged** (the budget applies only when a build resolves to
  tubes and exceeds it). Verified on the real 47 MB, 1.73 M-segment multi-object plate: GPU-upload peak
  1590 MB → 635 MB (`decimationApplied` 1 → 4). See [RR-006](../docs/research/RR-006-tube-mesh-memory-and-large-file-budget.md).

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.10.0
  - @chestnutlabs/toolpath-core@0.10.0

## 0.9.0

### Patch Changes

- [#325](https://github.com/ChestnutLabs/gcode-preview/pull/325) [`cc6e1f6`](https://github.com/ChestnutLabs/gcode-preview/commit/cc6e1f6b48e531bc991cb1c7c53846ccbf7ca522) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - refactor(renderer): extract the DD-020 interaction-quality controller (DD-021 Phase 0)

  First step of the DD-021 shared-infrastructure extraction: the interaction-aware quality logic
  (reduce device pixel ratio while the camera moves, restore on settle) moves out of `ToolpathRenderer`
  into a small renderer-agnostic `InteractionQualityController`, so the upcoming interactive model viewer
  reuses one implementation instead of a parallel copy. The `ToolpathRenderer` now delegates to it —
  behavior is unchanged (its full test suite passes byte-for-byte), and the controller is covered by its
  own unit tests. Additive export; no public API removed.

- [#327](https://github.com/ChestnutLabs/gcode-preview/pull/327) [`dd535d6`](https://github.com/ChestnutLabs/gcode-preview/commit/dd535d64ac71bbd876e83e81dccc6dbb046bf689) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(renderer): add the shared InteractiveStage viewport (DD-021 Phase 0)

  Adds `InteractiveStage` — the shared interactive **viewport** the DD-021 model viewer will reuse: it
  owns the WebGL renderer, the dual perspective/orthographic camera, orbit/zoom/pan controls (with a new
  injectable `createControls` seam for headless tests), WebGL context-loss recovery, resize, the
  damage-driven render, and the DD-020 interaction-quality controller. It renders a `Scene` the owner
  provides and holds no scene content or IR of its own, so the toolpath renderer and the model viewer
  can drive one implementation instead of parallel camera/controls stacks. The camera types
  (`CameraMode`/`CameraView`/`CameraState`) now live here and are re-exported from the toolpath renderer
  for import-path stability. Additive; the toolpath renderer is unchanged (its full suite passes
  byte-for-byte) and adopts the stage in the next Phase 0 step.

- [#328](https://github.com/ChestnutLabs/gcode-preview/pull/328) [`3299760`](https://github.com/ChestnutLabs/gcode-preview/commit/32997607dbd30db79c91d14d2d8383d99be933af) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - refactor(renderer): drive the ToolpathRenderer through the shared InteractiveStage (DD-021 Phase 0)

  Completes the DD-021 Phase 0 extraction: the `ToolpathRenderer` no longer owns its own GL renderer,
  camera pair, orbit controls, WebGL context-loss recovery, resize, render, or interaction-quality — it
  delegates all of that to the shared `InteractiveStage` (added previously) and keeps only its scene
  content (toolpath geometry, overlays, retractions, build volume, picking). Camera/render behavior is
  unchanged — the full renderer suite passes byte-for-byte — so this removes the duplication the model
  viewer would otherwise have inherited, leaving one camera/controls implementation for both renderers.

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.9.0
  - @chestnutlabs/toolpath-core@0.9.0

## 0.8.1

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.8.1
  - @chestnutlabs/toolpath-core@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.8.0
  - @chestnutlabs/toolpath-core@0.8.0

## 0.7.0

### Minor Changes

- [#310](https://github.com/ChestnutLabs/gcode-preview/pull/310) [`bbdef97`](https://github.com/ChestnutLabs/gcode-preview/commit/bbdef97d8a1eb77a3864291918f7f5aace559ff2) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Decouple the build-volume **wireframe cage** from the bed/plate ([#306](https://github.com/ChestnutLabs/gcode-preview/issues/306) item 6). The cage (the box up to
  the volume height) is now independently toggleable: a new `controls.setBuildVolumeCage(visible)` and a
  `showVolumeCage` prop across all four adapters (`show-volume-cage` attribute on the element), plus a
  `BuildVolumeStyle.showCage` option. Default `true` (unchanged look); set `false` to show only the
  printable bed/plate without the whole machine-volume cage. The 2D renderer treats it as a documented
  no-op. Toggling flips the named `volumeCage` object in place (no geometry rebuild).

- [#313](https://github.com/ChestnutLabs/gcode-preview/pull/313) [`39ede6e`](https://github.com/ChestnutLabs/gcode-preview/commit/39ede6ebc0a1ba594a391f1b33db2bdf3445d414) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Frame-to-content: frame the printed **object**, not the skirt/prime ([#306](https://github.com/ChestnutLabs/gcode-preview/issues/306) item 6). New
  `ToolpathIR.objectBounds` (extrusion of labeled objects only, `segments.object != 0`; empty when the
  file has no object labels) and a `frameContent: 'object' | 'all'` option threaded through the renderer
  (`setFrameContent`), `renderStill`, and all four adapters (`show-`-style `frame-content` attribute on the
  element). Default `'all'` (unchanged framing). `'object'` frames only the printed objects so a prime
  line or skirt at the bed edge no longer shrinks the object in view; when the file carries no object
  labels it discloses (an `E_FRAME_CONTENT_UNAVAILABLE` event) and frames all extrusion — never fabricated.

  Note: `frameContent: 'object'` engages only when the parser populated the `objects` capability (M486 /
  EXCLUDE_OBJECT / `; printing object`). Broadening object-label detection for more slicer/firmware
  variants is tracked separately.

- [#314](https://github.com/ChestnutLabs/gcode-preview/pull/314) [`caaa0fa`](https://github.com/ChestnutLabs/gcode-preview/commit/caaa0fad0938bfa3ac1cd9f312f9cd2355c722d1) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Interaction-aware render quality ([#306](https://github.com/ChestnutLabs/gcode-preview/issues/306) item 2, DD-020). New opt-in `interactionQuality: 'off' | 'auto'`
  renderer option + `controls.setInteractionQuality` + an `interactionQuality` prop / `interaction-quality`
  attribute on all four adapters. With `'auto'`, the renderer **reduces render detail (pixel ratio) while
  the camera is moving and restores full detail when it settles** (short debounce), so orbiting a heavy tube
  scene stays responsive without permanently dropping to lines. The reduction is proactive (a gesture starts
  at 0.6× the resting pixel ratio) and adapts to measured frame time within a clamped `[0.4, 1]` band. The
  hard vertex-budget `quality-fallback` (tubes → lines when a chunk can't allocate) is unchanged as the final
  safety net. **Default `'off'` — existing behavior is byte-identical.** The 2D renderer treats it as a
  documented no-op.

  A consumer maps a High / Balanced / Performance preference on top: High = `quality:'tubes'` +
  `interactionQuality:'auto'`; Balanced = `quality:'auto'` + `interactionQuality:'auto'`; Performance =
  `quality:'lines'`.

### Patch Changes

- Updated dependencies [[`39ede6e`](https://github.com/ChestnutLabs/gcode-preview/commit/39ede6ebc0a1ba594a391f1b33db2bdf3445d414), [`1c15c5e`](https://github.com/ChestnutLabs/gcode-preview/commit/1c15c5ea38f69aba99478cec60e4a0af28b9cae4)]:
  - @chestnutlabs/toolpath-core@0.7.0
  - @chestnutlabs/gcode-colors@0.7.0

## 0.6.0

### Minor Changes

- [#300](https://github.com/ChestnutLabs/gcode-preview/pull/300) [`277e148`](https://github.com/ChestnutLabs/gcode-preview/commit/277e1481ba015d6d0fa8d5b4e5ff6c7e014d494b) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add `framingFromCenterRadius` (and the `Framing` type) — the first piece of the shared render "stage"
  (DD-018 Phase 0). This is the deterministic 3/4 camera-framing pose (printer→scene coordinates,
  `viewHalfHeight = 1.25·radius`, fixed offset), lifted verbatim from `ToolpathRenderer.frame()` and now
  single-sourced so the forthcoming `ModelRenderer` frames identically. Internal refactor for the toolpath
  side (framing output unchanged); additive public export.

- [#302](https://github.com/ChestnutLabs/gcode-preview/pull/302) [`ac1e1f9`](https://github.com/ChestnutLabs/gcode-preview/commit/ac1e1f984305071db1a16fd8bbd7f1166b877d9d) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Grow the shared render "stage" (DD-018 Phase 0): move the GL type contracts `RenderTargetCanvas` and
  `GLRendererLike` into `stage.ts` (re-exported from their previous homes, so no import paths change) and
  add `createDefaultGLRenderer(canvas, { preserveDrawingBuffer, alpha, antialias })` — the default
  `WebGLRenderer` builder extracted from `ToolpathRenderer`, now single-sourced with an `alpha` option the
  forthcoming `ModelRenderer` uses for a transparent background. Refactor-only for the toolpath side
  (alpha stays false → byte-identical); additive public exports.

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.6.0
  - @chestnutlabs/toolpath-core@0.6.0

## 0.5.2

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.5.2
  - @chestnutlabs/toolpath-core@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.5.1
  - @chestnutlabs/toolpath-core@0.5.1

## 0.5.0

### Minor Changes

- [#283](https://github.com/ChestnutLabs/gcode-preview/pull/283) [`804cafb`](https://github.com/ChestnutLabs/gcode-preview/commit/804cafb33f8f8be2617585156babf1221a856941) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Adapter surface: capabilities/warnings on `ready` + declarative `view`/`cameraState` ([#275](https://github.com/ChestnutLabs/gcode-preview/issues/275) M3+M6)

  **M3** — the `parse-complete` / `ready` event now carries `capabilities` (the per-field confidence
  map) and `warnings` alongside `{ segments, layers, complete }`, so consumers can gate their own UI on
  capability-honesty without reaching for the raw handle.

  **M6** — the `setView`/`getCameraState`/`setCameraState` methods ([#268](https://github.com/ChestnutLabs/gcode-preview/issues/268)) get first-class declarative
  props on all four adapters: a `view` prop (preset orientation) and a `cameraState` prop (restore),
  paired with a new **`camera-changed`** event (renderer → controller → adapters, emitted when a user
  camera interaction settles) so a `cameraState` binding round-trips. The 2D renderer keeps disclosing
  via `renderer-unsupported` rather than fabricating a pose. Behavioral-suite coverage added for the
  capabilities/warnings payload across all four adapters.

- [#270](https://github.com/ChestnutLabs/gcode-preview/pull/270) [`bb2af7a`](https://github.com/ChestnutLabs/gcode-preview/commit/bb2af7a4b9c433ef8caf59ecb5ece51f39a8eb9e) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Preset camera views + serializable camera state ([#268](https://github.com/ChestnutLabs/gcode-preview/issues/268))

  Adds three imperative camera methods, threaded from the renderer through `PreviewRenderer` and the
  `controls` handle into all four adapters:
  - `setView(view)` — snap to a preset orientation (`top`/`bottom`/`front`/`back`/`left`/`right`/`iso`),
    instant, preserving the active projection.
  - `getCameraState()` — read the current camera as a serializable `CameraState`
    (`{ position, target, zoom, cameraMode }`, scene coordinates); a stable contract a dashboard can
    persist.
  - `setCameraState(state)` — restore a snapshot verbatim (no re-fit to the current model).

  New public types `CameraView` and `CameraState`. No new dependency, no IR/schema change, no animation
  (snapping is instant). The low-resource 2D renderer has no 3D pose, so it honors these as documented
  disclosures (`getCameraState()` → `null`; `setView`/`setCameraState` → `renderer-unsupported`) rather
  than fabricating a pose. Covered across all four adapters by the portable behavioral suite.

### Patch Changes

- [#269](https://github.com/ChestnutLabs/gcode-preview/pull/269) [`b671d02`](https://github.com/ChestnutLabs/gcode-preview/commit/b671d02179ba6cf30ce9888fa4b851328852e0f1) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Camera UX polish: enable OrbitControls affordances already available ([#267](https://github.com/ChestnutLabs/gcode-preview/issues/267))

  Turns on `zoomToCursor` (wheel zoom moves toward the pointer, not the orbit target) and derives
  `minDistance`/`maxDistance` clamps from the framed model size so the view can't dolly through the
  model or lose it at the extremes. Clamps are recomputed in `frame()`, so they track each file's
  bounds. Internal to `scene.ts` — no dependency, no public-API/adapter change; the headless
  still-render path (no OrbitControls) is unaffected.

- [#282](https://github.com/ChestnutLabs/gcode-preview/pull/282) [`54b54fe`](https://github.com/ChestnutLabs/gcode-preview/commit/54b54fe240e5ef7edae0e03e351127de531c5069) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Keyboard-operable camera for embedded viewers (DD-004 a11y) ([#275](https://github.com/ChestnutLabs/gcode-preview/issues/275)/M4)

  The embedded adapter canvases had `aria-label` but no `tabindex`, so they weren't focusable, and the
  renderer never enabled OrbitControls key events — only the standalone demo page was keyboard-usable.
  Now every adapter canvas is focusable (`tabindex="0"`) and the renderer enables OrbitControls keyboard
  events scoped to the canvas (arrow keys pan the view when it's focused, without hijacking the page's
  arrow keys). Keyboard operability is satisfied for embedders, not just the demo.

- Updated dependencies []:
  - @chestnutlabs/gcode-colors@0.5.0
  - @chestnutlabs/toolpath-core@0.5.0

## 0.4.0

### Minor Changes

- [#254](https://github.com/ChestnutLabs/gcode-preview/pull/254) [`5f59b77`](https://github.com/ChestnutLabs/gcode-preview/commit/5f59b7788bbb14cacfe21aaf3d7134c6ba8dcd86) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat: non-extrusion color modes — color-by-power + cut-vs-rapid (DD-012 phase 4, [#189](https://github.com/ChestnutLabs/gcode-preview/issues/189))

  Two new `ColorMode`s consuming the [#189](https://github.com/ChestnutLabs/gcode-preview/issues/189) channels (DD-012 D7):
  - **`power`** — ramps each segment's modal `toolPower` (laser power / spindle RPM, the `S` value) onto
    a color ramp, the CNC/laser counterpart to color-by-speed. Auto-ranged (`toolPowerRange`) or explicit;
    `NaN` (tool off) or a file parsed without the `toolPower` channel → fallback, never a fabricated color.
    Capability-gated on `toolPower` (the Three renderer's `isColorModeAvailable` gates it).
  - **`moveKind`** — cut-vs-rapid: productive moves (`Extrude` or `Cut`) vs rapids (`Travel`) — the
    "where the tool is actually working" view. Reads the always-present `kind` channel, so it is always
    available.

  Both flow through `createSegmentColorer`, so the Three and Canvas-2D renderers get them for free. FDM
  coloring is unchanged.

### Patch Changes

- Updated dependencies [[`5f59b77`](https://github.com/ChestnutLabs/gcode-preview/commit/5f59b7788bbb14cacfe21aaf3d7134c6ba8dcd86), [`1029580`](https://github.com/ChestnutLabs/gcode-preview/commit/10295803839816adaed224c48eba1f74374c0c2a), [`8fec7c3`](https://github.com/ChestnutLabs/gcode-preview/commit/8fec7c3622cd2a6d6d57b43d7866cfea1cb71e09)]:
  - @chestnutlabs/gcode-colors@0.4.0
  - @chestnutlabs/toolpath-core@0.4.0

## 0.3.0

### Minor Changes

- [#225](https://github.com/ChestnutLabs/gcode-preview/pull/225) [`83f7db4`](https://github.com/ChestnutLabs/gcode-preview/commit/83f7db46be38477c4ff4127e250c6d6147c302ed) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add an optional **filled build-plate surface** to the 3D renderer ([#185](https://github.com/ChestnutLabs/gcode-preview/issues/185)). The bare wireframe grid
  gains a themeable, self-drawn plate underneath it so a print reads against a bed rather than empty
  space — off by default (`bedSurface: { mode: 'none' }`), so the existing look is unchanged.
  - `Theme.bedSurface` (`BedSurface`): `mode: 'none' | 'solid'`, optional `color`, `opacity`, and a
    consumer-supplied `texture` (`ImageBitmap | HTMLCanvasElement` — never a URL, so it stays CSP-safe
    and synchronous for `renderStill`). No bundled vendor plate art (trademark + bloat).
  - The plate is an unlit plane spanning the bed, seated just below `z=0` with `depthWrite: false` so it
    never occludes the toolpath.
  - Keep-out zones from `MachineGeometry.excludedRegions` now render as amber outlines on the plate.

  Additive; no IR/geometry change and no new runtime dependency.

- [#230](https://github.com/ChestnutLabs/gcode-preview/pull/230) [`e8f889b`](https://github.com/ChestnutLabs/gcode-preview/commit/e8f889b576ee06da4181a048724c880ae38fedee) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add a **color-by-layer-height** mode ([#179](https://github.com/ChestnutLabs/gcode-preview/issues/179)) — the Orca/Bambu view that reveals variable-layer-height
  prints.
  - `gcode-colors`: new `ColorMode` variant `{ mode: 'layerHeight'; ramp; range?; fallback }`, plus
    `layerHeights(ir)` (per-layer Z-delta; layer 0 is its thickness from the bed; negative deltas clamp
    to 0) and `layerHeightRange(ir)` (the auto-range). Each segment is colored by its layer's height
    mapped onto the ramp. Derived purely from `ir.layers` — no new parsing.
  - `gcode-renderer-three`: re-exports `layerHeightRange`, and `isColorModeAvailable('layerHeight')` is
    **capability-gated on `layers`** — a non-planar/CNC IR (`layers: 'unavailable'`) reports the mode
    unavailable rather than collapsing every segment to one flat color.

  Additive; works through the existing rich `colorMode` prop on every adapter with no adapter change.

- [#217](https://github.com/ChestnutLabs/gcode-preview/pull/217) [`17e9951`](https://github.com/ChestnutLabs/gcode-preview/commit/17e995123fa68274d508527261161741955b0647) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - E8 phase 1 ([#212](https://github.com/ChestnutLabs/gcode-preview/issues/212), DD-014): the low-resource 2D renderer's foundation — two new lockstep packages and
  a boundary-preserving refactor. Additive; no IR/parser change, no change to the default (`'3d'`)
  behavior or any existing public API.
  - **`@chestnutlabs/gcode-colors`** (new): the renderer-agnostic home for the whole color subsystem
    (DD-014 D3). Exports the `ColorMode` union (`single`/`tool`/`feature`/`colorChange`/`feedrate`/
    `object`), `createSegmentColorer(ir, mode)` / `segmentColor`, `feedrateRange`, `rampColor`, and
    `RGB`. Depends only on `@chestnutlabs/toolpath-core` — no `three`, no framework. Every mode degrades
    unknown channel values to its fallback, never a fabricated color.
  - **`@chestnutlabs/gcode-renderer-2d`** (new): an opt-in Canvas 2D current-layer renderer over the
    existing `ToolpathIR` for low-GPU / low-memory / WebGL-blocked devices (DD-014 D1/D4). `LayerView2D`
    plus the pure `drawLayer` / `computeLayerFit` / `layerBounds2D` / `rgbToCss` core. Depends only on
    `toolpath-core` + `gcode-colors` — no `three`, no framework. Memory is bounded to the active layer.
  - **`@chestnutlabs/gcode-renderer-three`**: the per-segment color logic moved to `gcode-colors`;
    `colors.ts` now re-exports `ColorMode`/`RGB`/`feedrateRange` and `buildChunkColors` maps the shared
    colorer onto the Three.js vertex buffer. Public API and behavior unchanged (parity test).

- [#209](https://github.com/ChestnutLabs/gcode-preview/pull/209) [`4cd453f`](https://github.com/ChestnutLabs/gcode-preview/commit/4cd453f88f3dcb012af67ee8ff30159e371fd91a) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Two additive color modes ([#177](https://github.com/ChestnutLabs/gcode-preview/issues/177), [#178](https://github.com/ChestnutLabs/gcode-preview/issues/178)) over channels the IR already parses, following the DD-009
  capability-gated `colors.ts` pattern:
  - **color-by-speed** (`{ mode: 'feedrate'; ramp; range?; fallback }`, [#177](https://github.com/ChestnutLabs/gcode-preview/issues/177)): maps each segment's
    `feedrate` onto a color ramp — auto-ranged from the IR (pass `range` to keep the scale stable across
    files). NaN feedrate (before the first `F`) → fallback. Exposes `feedrateRange(ir)`. Gated on the
    `feedrate` capability.
  - **color-by-object** (`{ mode: 'object'; palette; fallback; only? }`, [#178](https://github.com/ChestnutLabs/gcode-preview/issues/178)): shades by `seg.object`
    (1-based; 0 = none → fallback) from the E4 `M486`/`EXCLUDE_OBJECT` work; `only` isolates one object
    (others dimmed to fallback). Gated on the `objects` capability.

  Both degrade honestly to the fallback rather than fabricating a color, and are reachable through the
  existing `colorMode` prop on every adapter with no API change.

- [#224](https://github.com/ChestnutLabs/gcode-preview/pull/224) [`d161e80`](https://github.com/ChestnutLabs/gcode-preview/commit/d161e802e36cc87fa27848ceef9d68cd45628760) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Source-line ↔ segment mapping ([#184](https://github.com/ChestnutLabs/gcode-preview/issues/184)) — the "G-code debugger" surface. Additive; no IR/geometry change.
  - `toolpath-core`: framework-free primitives over `segments.srcByte` + `sourceIndex`: build a line
    index (`buildSourceLineIndex`), then `lineAtByte` / `byteRangeOfLine` / `sourceLineOfSegment`
    (segment → its 1-based source line) / `segmentAtSourceLine` (line → segment, -1 when the line
    produced none). Both directions, O(log n).
  - `gcode-renderer-three`: `ToolpathRenderer.pickSegment(ndcX, ndcY, threshold?)` raycasts the
    toolpath and returns the IR segment under a pointer (or null) — click a segment → its source line.
    The pure index-mapping helper `resolveHitSegment(mesh, vertexIndex)` is exported and unit-tested.
  - `gcode-preview-core`: `PreviewRenderer.pickSegment` (the 2D renderer returns null — no picking yet),
    reachable via `raw.renderer()`.

- [#229](https://github.com/ChestnutLabs/gcode-preview/pull/229) [`be72283`](https://github.com/ChestnutLabs/gcode-preview/commit/be72283b20215450e8bf91b9a4eee730e98b423e) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Render slicer wipe moves as an independently toggleable layer (DD-016 phase 2, [#182](https://github.com/ChestnutLabs/gcode-preview/issues/182)).

  Phase 1 populated `MoveKind.Wipe` from `;WIPE_START`/`;WIPE_END`; this makes those moves visible
  and toggleable:
  - **renderer-three**: wipe segments build into their own `'wipe'` geometry chunk (separate from
    travel), and `setKindVisible('wipe', …)` shows/hides them. Default visible — nothing disappears
    until a consumer opts out. Wipe geometry is exempt from travel decimation (it is sparse and the
    point is to see it).
  - **core**: `setKindVisible` widens to `'extrude' | 'travel' | 'wipe'` (new `MoveKindToggle` type).
    The 2D renderer treats `'wipe'` as a documented no-op (the flat view has no distinct wipe form).
  - **adapters** (Vue/React/Svelte/Element): a `showWipe` prop / `show-wipe` attribute (default true)
    mirrors `showTravel`.

  Additive and backward-compatible; existing callers passing `'extrude'`/`'travel'` are unaffected.
  Completes [#182](https://github.com/ChestnutLabs/gcode-preview/issues/182).

### Patch Changes

- Updated dependencies [[`e8f889b`](https://github.com/ChestnutLabs/gcode-preview/commit/e8f889b576ee06da4181a048724c880ae38fedee), [`39348de`](https://github.com/ChestnutLabs/gcode-preview/commit/39348de9ce68717e71516f9acaccd475139983ba), [`17e9951`](https://github.com/ChestnutLabs/gcode-preview/commit/17e995123fa68274d508527261161741955b0647), [`d161e80`](https://github.com/ChestnutLabs/gcode-preview/commit/d161e802e36cc87fa27848ceef9d68cd45628760), [`82bd7ae`](https://github.com/ChestnutLabs/gcode-preview/commit/82bd7ae7f76e742767719d8efa11173a6548fc03)]:
  - @chestnutlabs/gcode-colors@0.3.0
  - @chestnutlabs/toolpath-core@0.3.0

## 0.2.0

### Minor Changes

- [#171](https://github.com/ChestnutLabs/gcode-preview/pull/171) [`1c2e5b0`](https://github.com/ChestnutLabs/gcode-preview/commit/1c2e5b031845630a6f82501de51e1ae902d52559) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add M600 filament-swap color-change annotation (E9 phase 3, [#147](https://github.com/ChestnutLabs/gcode-preview/issues/147), DD-009 D2).

  The parser now records a sparse `colorChanges` events channel on `ToolpathIR`
  (`{ x, y, z, segIndex, srcByte, tool }`, capability `colorChanges`) — `M600` is a marker with a
  position but no motion segment, captured in a side channel that leaves segment indices, scrub, and
  layer ranges untouched (mirrors the `retractions` channel from [#148](https://github.com/ChestnutLabs/gcode-preview/issues/148)). Detection lives in the parser
  (where `M600` was previously discarded as `unsupported-command`), so a bare `M600` is honored even
  when no dialect is detected. A new `colorChange` renderer color mode shades segments by **swap slot**
  (the count of color changes at or before a segment) using the existing palette-index path — not the
  `tool` channel — so multi-material prints color by active filament across manual swaps. Capability-
  gated: offered only when the IR actually carries an `M600`. Exposed through the existing `colorMode`
  option, so all adapters and `renderStill` support it with no new prop.

  DD-009 D2 was amended (maintainer-approved) to move detection from the dialect layer to the parser
  and realize the "dedicated color-change channel" as this sparse events channel.

- [#170](https://github.com/ChestnutLabs/gcode-preview/pull/170) [`d4c51a3`](https://github.com/ChestnutLabs/gcode-preview/commit/d4c51a394c1078efe959646b68f42de74e7cf4de) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add an orthographic camera option (E9 phase 2, [#150](https://github.com/ChestnutLabs/gcode-preview/issues/150), DD-009 D3).

  The renderer now carries both a perspective and an orthographic camera and switches between them with
  `setCameraMode('perspective' | 'orthographic')`, surfaced as a `cameraMode` renderer/controller option
  (default `'perspective'`), a `cameraMode` prop on the Vue, React, and Svelte adapters, and a
  `renderStill` option. Toggling preserves the view direction, target, and apparent framing — the
  orthographic frustum is sized to the same half-height the perspective view frames — and OrbitControls
  follows the active camera. Orthographic (parallel) projection suits dimensional/technical inspection.

- [#168](https://github.com/ChestnutLabs/gcode-preview/pull/168) [`11c75bd`](https://github.com/ChestnutLabs/gcode-preview/commit/11c75bd540c1490f888ec9ecee64814cafb25156) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add opt-in retraction/deretraction markers (E9 phase 1, [#148](https://github.com/ChestnutLabs/gcode-preview/issues/148), DD-009 D1).

  The parser now records a sparse `retractions` events channel on `ToolpathIR`
  (`{ x, y, z, kind, srcByte, segIndex }`, capability `retractions`) — E-only retraction moves emit no
  segment, so they are captured positionally in a side channel that leaves segment indices, scrub, and
  layer ranges untouched. The renderer draws them as opt-in always-on-top markers (warm = retract, cool
  = unretract) via `setShowRetractions`, clipped by the current layer/scrub window and shown only when
  the IR actually carries events. Exposed as a `showRetractions` prop across the Vue, React, and Svelte
  adapters (default off).

- [#173](https://github.com/ChestnutLabs/gcode-preview/pull/173) [`aceb9f2`](https://github.com/ChestnutLabs/gcode-preview/commit/aceb9f29091bec94f0de91791dd093ab0d92b834) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add a bounded declarative theming API (E9 phase 4, [#153](https://github.com/ChestnutLabs/gcode-preview/issues/153), DD-009 D4).

  A small, stable `Theme` object — `background`, `gridColor`, `bedColor`, `hemisphereIntensity`,
  `directionalIntensity`, and a `materialPreset` (`'matte'` | `'glossy'`) — surfaced as a renderer
  `theme` option + `setTheme()`, a controller `renderer.theme` option + `controls.setTheme()`, a `theme`
  prop on the Vue/React/Svelte adapters, and a `theme` option on `renderStill` (so headless thumbnails
  theme identically). The public type is three-free (`ThemeColor = number | string`) and re-exported
  through `gcode-preview-core`, so it stays valid across `three` upgrades; deep customization keeps using
  the `createRenderer` / `raw.renderer()` escape hatches.

  Additive and opt-in — the defaults reproduce the existing look exactly, and `setTheme` uses replace
  semantics (omitted fields reset to their defaults). Semantic colors (progress/retraction markers,
  overlay ghost/band, and the origin tripod) are intentionally not themeable; the material preset affects
  tube (extrude) geometry only — lines-quality geometry is unlit.

### Patch Changes

- Updated dependencies [[`1c2e5b0`](https://github.com/ChestnutLabs/gcode-preview/commit/1c2e5b031845630a6f82501de51e1ae902d52559), [`11c75bd`](https://github.com/ChestnutLabs/gcode-preview/commit/11c75bd540c1490f888ec9ecee64814cafb25156)]:
  - @chestnutlabs/toolpath-core@0.2.0

## 0.1.0

### Minor Changes

- [#141](https://github.com/ChestnutLabs/gcode-preview/pull/141) [`c26879f`](https://github.com/ChestnutLabs/gcode-preview/commit/c26879f4148b77e5e9070bc2ee421a265c9571d3) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - First published line of the Chestnut Labs G-code Preview stack (`v0.1.0`, DD-008): worker-based
  `.gcode` / `.gcode.3mf` parsing into a versioned `ToolpathIR`, cross-vendor dialect annotation
  (PrusaSlicer, Orca/Bambu, Cura, Klipper, Marlin, RepRap-flavor), a Three.js renderer with layer
  clipping, scrub, tubes, build plates and the honest live-progress overlay, a framework-neutral
  preview controller, and first-class Vue/React/Svelte adapters with capability parity.

- [#145](https://github.com/ChestnutLabs/gcode-preview/pull/145) [`ab7db35`](https://github.com/ChestnutLabs/gcode-preview/commit/ab7db35b3fcc84da3f26c4b6fe91671470df05c5) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add `renderStill(source, options)` to `@chestnutlabs/gcode-preview-core`: a headless,
  non-interactive still-image entry point (DD-008 §4.8; the reusable capability behind AnyBridge's
  G-code thumbnail worker, [#791](https://github.com/ChestnutLabs/gcode-preview/issues/791)). Accepts G-code bytes or a pre-parsed `ToolpathIR`, builds to
  completion, frames deterministically (or applies an explicit camera pose), and renders one frame
  to an `OffscreenCanvas` or DOM canvas for the caller to read back.

  `gcode-renderer-three` gains the supporting surface: `ToolpathRenderer` accepts an `OffscreenCanvas`
  render target (new `RenderTargetCanvas` type) and a `preserveDrawingBuffer` option for readable
  single-frame renders.

### Patch Changes

- Updated dependencies [[`c26879f`](https://github.com/ChestnutLabs/gcode-preview/commit/c26879f4148b77e5e9070bc2ee421a265c9571d3)]:
  - @chestnutlabs/toolpath-core@0.1.0
