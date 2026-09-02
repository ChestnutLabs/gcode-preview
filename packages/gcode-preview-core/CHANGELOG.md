# @chestnutlabs/gcode-preview-core

## 0.20.1

### Patch Changes

- Updated dependencies [[`672fe42`](https://github.com/ChestnutLabs/gcode-preview/commit/672fe42c9391608adb3b816a6369d86b9f34307e), [`672fe42`](https://github.com/ChestnutLabs/gcode-preview/commit/672fe42c9391608adb3b816a6369d86b9f34307e), [`672fe42`](https://github.com/ChestnutLabs/gcode-preview/commit/672fe42c9391608adb3b816a6369d86b9f34307e)]:
  - @chestnutlabs/gcode-renderer-three@0.20.1
  - @chestnutlabs/gcode-parser@0.20.1
  - @chestnutlabs/gcode-renderer-2d@0.20.1
  - @chestnutlabs/toolpath-core@0.20.1

## 0.20.0

### Minor Changes

- [#427](https://github.com/ChestnutLabs/gcode-preview/pull/427) [`8810ba4`](https://github.com/ChestnutLabs/gcode-preview/commit/8810ba43f1641362e1705e713a8afe93659f740a) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Close the dark-capability gaps so no shipped capability is reachable only through the
  `raw.renderer()` escape hatch, with full parity across all four framework adapters (DD-031).

  **New on the public controller (`GcodePreviewControls`), so it flows to every adapter's `controls`:**
  - `getRenderStats()` — the DD-027 render-diagnostics snapshot (backend, GPU, geometry mode, build
    parallelism, timings), previously reachable only on the Three renderer. Returns `null` on the 2D
    renderer (which produces no GPU/geometry diagnostics — never a fabricated stats object).
  - `pickSegment(ndcX, ndcY, threshold?)` — source-mapping / segment picking, previously renderer-only.
  - `isColorModeAvailable(mode)` — the honest per-file color-mode capability gate.

  **New capability-aware state (`GcodePreviewState`):** `availableColorModes`, `hasRetractions`,
  `hasColorChanges` — refreshed after each parse, so a UI can offer and _explain_ controls instead of
  guessing (e.g. gray out feature coloring on a file with no feature roles, with a reason).

  **Adapter parity:**
  - `hiddenFeatureRoles` is now a declarative prop (Vue/React/Svelte) and a `hidden-feature-roles`
    attribute (Web Component) — the declarative form of `setFeatureRoleVisible` (hide Skirt/Brim to
    declutter a part). Gate it on `capabilities.featureRoles`.
  - `capture()` is now a top-level method on the Vue/React/Svelte handles too, matching the Web
    Component's `element.capture()`.
  - Web Component: `renderer`/`adjacentLayers` gain property accessors; the package now also re-exports
    `RendererMode` and `PreviewRenderer`.

  All additive — existing code keeps working unchanged; the 2D renderer honors the widened contract as
  documented no-ops / honest `null`. The portable behavioral suite is extended (layer-range, color-mode
  gating, diagnostics + picking reachability) and gains a controls-completeness parity guard so a
  capability can no longer ship in core and silently vanish from an adapter.

### Patch Changes

- Updated dependencies [[`718d1bd`](https://github.com/ChestnutLabs/gcode-preview/commit/718d1bde45856b58c37580d629da6d177f9f2004)]:
  - @chestnutlabs/gcode-renderer-three@0.20.0
  - @chestnutlabs/gcode-parser@0.20.0
  - @chestnutlabs/gcode-renderer-2d@0.20.0
  - @chestnutlabs/toolpath-core@0.20.0

## 0.19.0

### Minor Changes

- [#423](https://github.com/ChestnutLabs/gcode-preview/pull/423) [`81690dc`](https://github.com/ChestnutLabs/gcode-preview/commit/81690dcfece21d6fd11074ad7a264bcfc9edf455) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(renderer): `setFeatureRoleVisible(role, visible)` — show/hide a single feature role

  Toggle a `FeatureRole` on or off — e.g. hide `Skirt`/`Brim` to declutter a part preview, or isolate
  `Support`. Feature roles live per-segment inside the extrusion geometry (unlike the whole-chunk move-kind
  toggle), so hidden segments are collapsed to NaN positions and the GPU discards them; showing the role
  again restores the geometry byte-for-byte. Available on `ToolpathRenderer` and via
  `GcodePreviewControls.setFeatureRoleVisible` (a no-op on the 2D renderer). Additive and capability-gated:
  gate the UI on `capabilities.featureRoles === 'known'`, like the feature colour mode; untouched geometry
  (no role hidden) is byte-identical. Also exports `FeatureRoleValue` from `@chestnutlabs/toolpath-core`.

### Patch Changes

- Updated dependencies [[`81690dc`](https://github.com/ChestnutLabs/gcode-preview/commit/81690dcfece21d6fd11074ad7a264bcfc9edf455)]:
  - @chestnutlabs/gcode-renderer-three@0.19.0
  - @chestnutlabs/toolpath-core@0.19.0
  - @chestnutlabs/gcode-parser@0.19.0
  - @chestnutlabs/gcode-renderer-2d@0.19.0

## 0.18.0

### Minor Changes

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

- Updated dependencies [[`5144890`](https://github.com/ChestnutLabs/gcode-preview/commit/51448906f87ca09f3ed11f1286f7b79356110a83), [`bcb4b78`](https://github.com/ChestnutLabs/gcode-preview/commit/bcb4b786fcfc6a2e967d8bfff1d4fd3a06731681), [`dc89056`](https://github.com/ChestnutLabs/gcode-preview/commit/dc890568d45e59635b9994d8409ef6cdc0847f80), [`0ebeadf`](https://github.com/ChestnutLabs/gcode-preview/commit/0ebeadfa839e52baf243ef07b5807f3974bbac7e), [`c950339`](https://github.com/ChestnutLabs/gcode-preview/commit/c95033908e3ebaeb07b6f7e6f2487672dcc463f0)]:
  - @chestnutlabs/gcode-parser@0.18.0
  - @chestnutlabs/gcode-renderer-three@0.18.0
  - @chestnutlabs/gcode-renderer-2d@0.18.0
  - @chestnutlabs/toolpath-core@0.18.0

## 0.17.0

### Minor Changes

- [#408](https://github.com/ChestnutLabs/gcode-preview/pull/408) [`63e191c`](https://github.com/ChestnutLabs/gcode-preview/commit/63e191cd5e3a36f697ba660c17cf5c7d28406af0) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(render-still): expose `tubeByteBudget` on `RenderStillOptions`

  `renderStill` now accepts `tubeByteBudget?: number`, forwarded to the renderer's existing option. This is
  the **final-geometry** byte budget (RR-006) — a **different axis** from `geometryMemoryBudgetBytes` (the
  parallel build's in-flight transient cap): it bounds the whole retained tube mesh and so decides whether a
  large plate renders as full **tubes** or degrades to **lines**.

  Previously the headless still was stuck behind the conservative default (~450 MB CPU / ~900 MB peak), so a
  big full-sheet plate silently fell to lines even when the deployment had RAM to spare, with no way to opt
  in. A caller whose resource policy says the RAM is available can now raise the budget to retain tubes on
  large plates (peak RAM ≈ 2× the budget). The library never reads the container — choosing a value from the
  actual CPU/RAM grant is deployment policy, not baked into gcode-preview.

  Additive and behavior-preserving at the default. `geometryMemoryBudgetBytes` (CPU parallelism transient)
  and `tubeByteBudget` (final-geometry retention) are independent knobs, matching the two-axis
  capability-aware model the DD-028 headless characterization established.

### Patch Changes

- Updated dependencies [[`d1de1b4`](https://github.com/ChestnutLabs/gcode-preview/commit/d1de1b407389321442289a5be5d3104c60b68060), [`214b0db`](https://github.com/ChestnutLabs/gcode-preview/commit/214b0db2dd9d8aa177d80969bdb59173d33121a3), [`b362f9a`](https://github.com/ChestnutLabs/gcode-preview/commit/b362f9a81232a21ff35a4a23d84c6300db83f28f)]:
  - @chestnutlabs/gcode-renderer-three@0.17.0
  - @chestnutlabs/toolpath-core@0.17.0
  - @chestnutlabs/gcode-parser@0.17.0
  - @chestnutlabs/gcode-renderer-2d@0.17.0

## 0.16.0

### Minor Changes

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

- [#400](https://github.com/ChestnutLabs/gcode-preview/pull/400) [`12deb4d`](https://github.com/ChestnutLabs/gcode-preview/commit/12deb4d79891cfab39b1a9c8d1f3f93665564a9e) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(core): parallel tube build for renderStill via the browser Web Worker pool (DD-028 Phase 4)

  `renderStill` now parallelizes big-plate tube geometry across the browser Web Worker pool — the same
  byte-identical kernel the interactive path uses. `renderStill` runs in a browser-class WebGL2 context
  (headless Chromium / Electron / OffscreenCanvas worker — never raw Node; "pure-Node GPU rendering is out
  of scope"), so this is Web Workers, **not** `worker_threads`, and it stays DD-007-clean (no `node:`
  imports, no filesystem).
  - New `renderStill` options: `geometryConcurrency: 'auto' | 'off' | number` (default `'auto'`),
    `coreBudget`, `geometryMemoryBudgetBytes`, `createGeometryWorker` (override). The batteries-included
    browser Web Worker is the default factory when `Worker` is available.
  - **Container-throttle-aware:** `navigator.hardwareConcurrency` over-reports a CFS-throttled container
    (e.g. 4 visible cores / 2.0-CPU quota), so a containerized caller (the sidecar) reads its cgroup
    `cpu.max` in its own Node host and passes the quota as `coreBudget`; the pool sizes to
    `min(hardwareConcurrency, coreBudget) − 1`, further bounded by `geometryMemoryBudgetBytes`. At a 2-CPU
    grant this honestly resolves to ~serial; a larger grant is used automatically.

  FDM geometry byte-identical.

- [#395](https://github.com/ChestnutLabs/gcode-preview/pull/395) [`70b1f5b`](https://github.com/ChestnutLabs/gcode-preview/commit/70b1f5bae3458f21c44950d17fc8c6e413ea8570) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(core): staged preparation progress — `parsing`/`classifying` stages (DD-029 Phase A)

  The controller now maps the parser's own phase to the DD-029 `stage` vocabulary: the `parsing` phase
  emits `stage:'parsing'` with the real byte fraction, and the `finalizing` phase (where dialect
  annotation settles) emits `stage:'classifying'`. The renderer's later `building-geometry`/`preparing-gpu`/
  `ready` stages already forward through the controller, so a consumer sees the full ordered vocabulary
  `parsing → classifying → building-geometry → preparing-gpu → ready`.

  Additive: `parse-progress`/`parse-complete`/`buildComplete` are untouched. No geometry or render-policy
  change.

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

### Patch Changes

- Updated dependencies [[`6587d99`](https://github.com/ChestnutLabs/gcode-preview/commit/6587d9994dde77dd5488136e9b46257661c16c2e), [`1c54132`](https://github.com/ChestnutLabs/gcode-preview/commit/1c54132a39713c3c6d582e0b6820b411eff40d20), [`fdc9111`](https://github.com/ChestnutLabs/gcode-preview/commit/fdc9111c0917af55e41fff9d20464ebbc3444589), [`ecfa56b`](https://github.com/ChestnutLabs/gcode-preview/commit/ecfa56b098d721cd5d636f594d07eda9ac2be067), [`808dc56`](https://github.com/ChestnutLabs/gcode-preview/commit/808dc56bf377a435bc457d16fc51e195734e2bb5), [`affc879`](https://github.com/ChestnutLabs/gcode-preview/commit/affc8796583be309ce469969f2777a833253549a), [`f3ce24f`](https://github.com/ChestnutLabs/gcode-preview/commit/f3ce24ff5439ef44ca4bac8a12eda91d187f410f), [`de453cb`](https://github.com/ChestnutLabs/gcode-preview/commit/de453cb3a84275dc27c89c20381c7f91289a6a83), [`9cd66b2`](https://github.com/ChestnutLabs/gcode-preview/commit/9cd66b2f23aa32c8832d9e9da13c025cf86278b1), [`41d2dcf`](https://github.com/ChestnutLabs/gcode-preview/commit/41d2dcf49d28268c13d4d1dbaf4604a9efaacfaf), [`bf032d2`](https://github.com/ChestnutLabs/gcode-preview/commit/bf032d2b4e0ce36dcbd8020caead2a512ca3b618)]:
  - @chestnutlabs/gcode-renderer-three@0.16.0
  - @chestnutlabs/gcode-parser@0.16.0
  - @chestnutlabs/toolpath-core@0.16.0
  - @chestnutlabs/gcode-renderer-2d@0.16.0

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

- Updated dependencies [[`8229075`](https://github.com/ChestnutLabs/gcode-preview/commit/8229075e2737c360c5d255e438ce140f4fbb13da)]:
  - @chestnutlabs/gcode-renderer-three@0.15.0
  - @chestnutlabs/gcode-parser@0.15.0
  - @chestnutlabs/gcode-renderer-2d@0.15.0
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

- Updated dependencies [[`60e24e1`](https://github.com/ChestnutLabs/gcode-preview/commit/60e24e15b6b72e9aa097f4d2fd22b0c91a480cea), [`c99b221`](https://github.com/ChestnutLabs/gcode-preview/commit/c99b2219566b6427c3d11d37be04876415db3bea)]:
  - @chestnutlabs/gcode-renderer-three@0.14.0
  - @chestnutlabs/gcode-parser@0.14.0
  - @chestnutlabs/gcode-renderer-2d@0.14.0
  - @chestnutlabs/toolpath-core@0.14.0

## 0.13.0

### Minor Changes

- [#364](https://github.com/ChestnutLabs/gcode-preview/pull/364) [`f14849d`](https://github.com/ChestnutLabs/gcode-preview/commit/f14849d5f88eb9957a75bccf2f14da75ebb44a4e) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(color): `filament` colour mode — render a toolpath in the file's own filament colours (DD-024)

  Adds a `{ mode: 'filament' }` colour mode: colour a toolpath by the source's OWN filament colours
  (`metadata.filaments[].color`, from the g-code header / slicer metadata), so a consumer needn't extract and
  re-supply a palette gcode-preview already knows. Because those colours live in parse **metadata** (not the
  IR), the `gcode-preview-core` controller resolves the mode against each file's metadata **before the build** —
  multi-extruder files colour by tool, colour-change (M600) files by swap slot — so the **first visible pass is
  already coloured**, eliminating the neutral-then-recolour flash on raw `.gcode`. Honesty preserved: with no
  usable filament colours the render stays neutral (never a fabricated palette); the mode reaching the IR-only
  colorer unresolved is likewise honestly neutral. Fixes the raw-g-code (e.g. Dune Striker) colour flash
  renderer-side, no consumer palette extraction required.

### Patch Changes

- Updated dependencies [[`377fc70`](https://github.com/ChestnutLabs/gcode-preview/commit/377fc7076e42a6044a9e10f2d4b27bd99fa133f3), [`b8dd6a7`](https://github.com/ChestnutLabs/gcode-preview/commit/b8dd6a7ce05add28f922a7f71641eebe0778a146), [`3be5312`](https://github.com/ChestnutLabs/gcode-preview/commit/3be531219cede19168ddf042ee7954c14d73d74c)]:
  - @chestnutlabs/gcode-renderer-three@0.13.0
  - @chestnutlabs/gcode-renderer-2d@0.13.0
  - @chestnutlabs/gcode-parser@0.13.0
  - @chestnutlabs/toolpath-core@0.13.0

## 0.12.0

### Patch Changes

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

- Updated dependencies [[`8bd6bbd`](https://github.com/ChestnutLabs/gcode-preview/commit/8bd6bbd1dfe7539ee4e3357f84de74c2eb703462)]:
  - @chestnutlabs/gcode-renderer-three@0.12.0
  - @chestnutlabs/gcode-parser@0.12.0
  - @chestnutlabs/gcode-renderer-2d@0.12.0
  - @chestnutlabs/toolpath-core@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-parser@0.11.0
  - @chestnutlabs/gcode-renderer-2d@0.11.0
  - @chestnutlabs/gcode-renderer-three@0.11.0
  - @chestnutlabs/toolpath-core@0.11.0

## 0.10.0

### Minor Changes

- [#339](https://github.com/ChestnutLabs/gcode-preview/pull/339) [`33c4652`](https://github.com/ChestnutLabs/gcode-preview/commit/33c46528967b88d5b67ab81e61a3ab7f7e1cdc79) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(core): expose `decimationApplied` on `RenderStillResult` (honest disclosure for large tube cards)

  `renderStill` now returns `decimationApplied` (1 = none, > 1 = every-Nth extrusion kept, layer boundaries
  always preserved). The headless still path is where a farm renders thumbnail/cards, and the tube-segment
  budget (RR-006, `gcode-renderer-three`) can now decimate a large card to bound memory — but the still
  result carried no signal of it, so a card could be silently simplified. This closes that gap: a consumer
  can disclose "simplified for size" on a decimated card, matching the interactive controller's existing
  `state.disclosure`. Additive; small/normal renders report `decimationApplied: 1`.

### Patch Changes

- Updated dependencies [[`a6ae736`](https://github.com/ChestnutLabs/gcode-preview/commit/a6ae736dab468960939b477964790c6ce9130572)]:
  - @chestnutlabs/gcode-renderer-three@0.10.0
  - @chestnutlabs/gcode-parser@0.10.0
  - @chestnutlabs/gcode-renderer-2d@0.10.0
  - @chestnutlabs/toolpath-core@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [[`cc6e1f6`](https://github.com/ChestnutLabs/gcode-preview/commit/cc6e1f6b48e531bc991cb1c7c53846ccbf7ca522), [`dd535d6`](https://github.com/ChestnutLabs/gcode-preview/commit/dd535d64ac71bbd876e83e81dccc6dbb046bf689), [`3299760`](https://github.com/ChestnutLabs/gcode-preview/commit/32997607dbd30db79c91d14d2d8383d99be933af)]:
  - @chestnutlabs/gcode-renderer-three@0.9.0
  - @chestnutlabs/gcode-parser@0.9.0
  - @chestnutlabs/gcode-renderer-2d@0.9.0
  - @chestnutlabs/toolpath-core@0.9.0

## 0.8.1

### Patch Changes

- Updated dependencies [[`92ae9a2`](https://github.com/ChestnutLabs/gcode-preview/commit/92ae9a2532e7ecc1a7b9938eda442d105e4f31b4)]:
  - @chestnutlabs/gcode-parser@0.8.1
  - @chestnutlabs/gcode-renderer-2d@0.8.1
  - @chestnutlabs/gcode-renderer-three@0.8.1
  - @chestnutlabs/toolpath-core@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-parser@0.8.0
  - @chestnutlabs/gcode-renderer-2d@0.8.0
  - @chestnutlabs/gcode-renderer-three@0.8.0
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

- [#312](https://github.com/ChestnutLabs/gcode-preview/pull/312) [`6293342`](https://github.com/ChestnutLabs/gcode-preview/commit/62933424cb59684878bf142ad7fc7edb44507a19) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add a `background` convenience option to `renderStill` ([#306](https://github.com/ChestnutLabs/gcode-preview/issues/306)): `'transparent'` composites the still on a
  consumer card (creates an alpha GL context so the unset scene background shows through), or a solid
  `ThemeColor` paints a themed backdrop. Shorthand for wiring `theme.background` + an alpha `createRenderer`
  yourself — so a presentation card thumbnail is `renderStill(ir, { quality: 'tubes', showTravel: false,
showWipe: false, background: 'transparent' })` (no build volume, extrude-only framing). An explicit
  `theme.background` or `createRenderer` you pass still wins.

- [#307](https://github.com/ChestnutLabs/gcode-preview/pull/307) [`69806d8`](https://github.com/ChestnutLabs/gcode-preview/commit/69806d8e44498925c9140acb124a5f76395a1e8f) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Surface slicer **`metadata`** on the `ready` / `parse-complete` event ([#306](https://github.com/ChestnutLabs/gcode-preview/issues/306) item 4). The
  `DialectMetadata` a slicer file carries — per-tool `filaments` (`{slot, type, color, name}`),
  `filamentUsage` (`{lengthMm, volumeCm3, weightG}`), `printEstimate` (`{seconds, mode}`), `thumbnails`,
  `dialects`, and whitelisted `raw` settings — is now on the event across all four adapters, so a consumer
  can build a "Slice details" panel without reaching into the raw handle. Capability-honest: `metadata` is
  `undefined` when the file carried none, and individual fields are absent (never fabricated) when a slicer
  didn't emit them. (Purge/waste, prime/tower, and cost are not parsed and are intentionally not present.)

### Patch Changes

- Updated dependencies [[`bbdef97`](https://github.com/ChestnutLabs/gcode-preview/commit/bbdef97d8a1eb77a3864291918f7f5aace559ff2), [`39ede6e`](https://github.com/ChestnutLabs/gcode-preview/commit/39ede6ebc0a1ba594a391f1b33db2bdf3445d414), [`caaa0fa`](https://github.com/ChestnutLabs/gcode-preview/commit/caaa0fad0938bfa3ac1cd9f312f9cd2355c722d1), [`1c15c5e`](https://github.com/ChestnutLabs/gcode-preview/commit/1c15c5ea38f69aba99478cec60e4a0af28b9cae4)]:
  - @chestnutlabs/gcode-renderer-three@0.7.0
  - @chestnutlabs/toolpath-core@0.7.0
  - @chestnutlabs/gcode-parser@0.7.0
  - @chestnutlabs/gcode-renderer-2d@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [[`277e148`](https://github.com/ChestnutLabs/gcode-preview/commit/277e1481ba015d6d0fa8d5b4e5ff6c7e014d494b), [`ac1e1f9`](https://github.com/ChestnutLabs/gcode-preview/commit/ac1e1f984305071db1a16fd8bbd7f1166b877d9d)]:
  - @chestnutlabs/gcode-renderer-three@0.6.0
  - @chestnutlabs/gcode-parser@0.6.0
  - @chestnutlabs/gcode-renderer-2d@0.6.0
  - @chestnutlabs/toolpath-core@0.6.0

## 0.5.2

### Patch Changes

- [#292](https://github.com/ChestnutLabs/gcode-preview/pull/292) [`d7f3e88`](https://github.com/ChestnutLabs/gcode-preview/commit/d7f3e88afd80fd07167625cd8128f569830be3f8) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Fix: `renderStill` now honors `showTravel: false` (and its documented default of false), and adds a
  matching `showWipe` option (also default false).

  `renderStill` only ever turned travel visibility **on** (`if (options.showTravel === true) …`), and the
  renderer defaults travel (and wipe) visible — so `showTravel: false`, and omitting the option (documented
  default false), were both no-ops and travel always rendered into the still. Travel and wipe visibility are
  now applied unconditionally from their options, so a headless thumbnail is a clean model-only image by
  default. (Retraction markers were already off by default — the renderer never enables them in a still.)

  Note: this does not change camera framing. `renderStill` frames to the IR's **extrude-only** bounds
  (`ir.bounds`), never the travel-inclusive bounds — so a still that still shows lines reaching the plate
  corners after this fix indicates those moves are classified as extrusion, not travel (an E-mode/motion
  classification question, unrelated to `showTravel`).

- Updated dependencies []:
  - @chestnutlabs/gcode-parser@0.5.2
  - @chestnutlabs/gcode-renderer-2d@0.5.2
  - @chestnutlabs/gcode-renderer-three@0.5.2
  - @chestnutlabs/toolpath-core@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-parser@0.5.1
  - @chestnutlabs/gcode-renderer-2d@0.5.1
  - @chestnutlabs/gcode-renderer-three@0.5.1
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

- Updated dependencies [[`804cafb`](https://github.com/ChestnutLabs/gcode-preview/commit/804cafb33f8f8be2617585156babf1221a856941), [`b671d02`](https://github.com/ChestnutLabs/gcode-preview/commit/b671d02179ba6cf30ce9888fa4b851328852e0f1), [`54b54fe`](https://github.com/ChestnutLabs/gcode-preview/commit/54b54fe240e5ef7edae0e03e351127de531c5069), [`bb2af7a`](https://github.com/ChestnutLabs/gcode-preview/commit/bb2af7a4b9c433ef8caf59ecb5ece51f39a8eb9e)]:
  - @chestnutlabs/gcode-renderer-three@0.5.0
  - @chestnutlabs/gcode-parser@0.5.0
  - @chestnutlabs/gcode-renderer-2d@0.5.0
  - @chestnutlabs/toolpath-core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`b2053be`](https://github.com/ChestnutLabs/gcode-preview/commit/b2053be4b8e71250bc6077f60ef996fe601b6f3e), [`5f59b77`](https://github.com/ChestnutLabs/gcode-preview/commit/5f59b7788bbb14cacfe21aaf3d7134c6ba8dcd86), [`13fd5c6`](https://github.com/ChestnutLabs/gcode-preview/commit/13fd5c61d730428a7f7e73c28cf3cc9c48e68c19), [`1029580`](https://github.com/ChestnutLabs/gcode-preview/commit/10295803839816adaed224c48eba1f74374c0c2a), [`11f317d`](https://github.com/ChestnutLabs/gcode-preview/commit/11f317de2d6cb963d2a7fb0c894c89d3d5adc86d), [`8fec7c3`](https://github.com/ChestnutLabs/gcode-preview/commit/8fec7c3622cd2a6d6d57b43d7866cfea1cb71e09), [`879b60a`](https://github.com/ChestnutLabs/gcode-preview/commit/879b60ae0fca87ca8187791603a1bc7f54e61c4c), [`b84bea9`](https://github.com/ChestnutLabs/gcode-preview/commit/b84bea959b7aae24d148e6bcc488a9ed254a54f0)]:
  - @chestnutlabs/gcode-parser@0.4.0
  - @chestnutlabs/gcode-renderer-three@0.4.0
  - @chestnutlabs/toolpath-core@0.4.0
  - @chestnutlabs/gcode-renderer-2d@0.4.0

## 0.3.0

### Minor Changes

- [#219](https://github.com/ChestnutLabs/gcode-preview/pull/219) [`bb23c90`](https://github.com/ChestnutLabs/gcode-preview/commit/bb23c901cc405ea22aad9003ccb20c7cab525490) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - E8 phase 3 ([#214](https://github.com/ChestnutLabs/gcode-preview/issues/214), DD-014 D5): select the renderer with a **`renderer: '2d' | '3d'`** prop, plus a
  live-progress marker in the 2D view. Additive; the default (`'3d'`) output is unchanged.
  - **`gcode-preview-core`**: a renderer-agnostic `PreviewRenderer` seam. `renderer.mode` (default
    `'3d'`) picks the implementation; the **3D renderer is now loaded on demand** (dynamic `import()`),
    so a `'2d'` consumer's bundle **never pulls Three.js**. New `LayerView2DRenderer` adapts the Canvas
    2D renderer to the seam. Genuine 3D-only requests on the 2D view (camera projection, quality modes)
    are disclosed via a new `renderer-unsupported` event rather than faked. The controller's renderer
    now resolves asynchronously; controls issued before it is ready are queued and replayed in order.
  - **`gcode-renderer-2d`**: a live-progress "completed cut" (DD-006) — `LayerView2D.setProgress` /
    `drawLayers({ progress })` dims the not-yet-printed extrusion of the layer currently printing.
  - **Adapters** (Vue/React/Svelte/Element): a top-level `renderer` prop (+ `adjacentLayers`) maps to
    `renderer.mode`; `raw.renderer()` now returns the neutral `PreviewRenderer`. `<GcodePreview renderer="2d" />`.

  No IR/parser change; no change to the 3D renderer's public API or output.

- [#220](https://github.com/ChestnutLabs/gcode-preview/pull/220) [`ca4d9c0`](https://github.com/ChestnutLabs/gcode-preview/commit/ca4d9c0cbbec7d4edc98403f615332c2b3c34453) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - E8 phase 4 ([#215](https://github.com/ChestnutLabs/gcode-preview/issues/215), DD-014 §6/§11) — capability honesty for the low-resource 2D view. Closes E8.
  - `gcode-renderer-2d`: `describe2DDisclosures(ir)` + `LayerView2D.getDisclosures()` return honest
    notes when the IR can't be faithfully shown as flat layers — `capabilities.layers: 'unavailable'`
    (non-planar / CNC: every move is on layer 0, so the 2D view shows them all in one flat top-down
    frame; Z variation and non-XY motion aren't represented) or `'inferred'`. Planar FDM → no note.
  - `gcode-preview-core`: `LayerView2DRenderer` emits those disclosures on `setIR` via the
    `renderer-unsupported` event, so a consumer UI is told what the flat view omits — never fabricated.

  The DD-014 §8 low-resource budget is verified on a real device (Linux/Chrome host): layer-change
  redraw ~0.2 ms median (≤ 3.6 ms even at 6× CPU throttle) vs the 16 ms budget, and ~0 MB heap growth
  over 870 renders (the 2D renderer builds no per-layer geometry). See
  `tools/benchmark/results/e8-2d-lowresource-benchmark-2026-07-26.md`.

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

- [#223](https://github.com/ChestnutLabs/gcode-preview/pull/223) [`82bd7ae`](https://github.com/ChestnutLabs/gcode-preview/commit/82bd7ae7f76e742767719d8efa11173a6548fc03) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Time-based scrub + a print-time estimate ([#181](https://github.com/ChestnutLabs/gcode-preview/issues/181)). Additive; no IR/geometry change.
  - `toolpath-core`: `computeToolpathTime(ir)` builds a cumulative **kinematic** time axis (per-segment
    length ÷ feedrate; constant-velocity, not accel-aware — a slight *under*estimate) plus
    `segmentsCompletedAtTime(cumulativeMs, ms)`. Unknown feedrates contribute 0 and flag the estimate
    approximate (`hasUnknownFeedrate`) — never a fabricated duration.
  - `gcode-preview-core`: state gains `totalTimeMs` + `timeEstimateSource` — **prefers the slicer's own
    estimate** (`DialectMetadata.printEstimate`, [#183](https://github.com/ChestnutLabs/gcode-preview/issues/183)) when present (`'slicer'`), else the kinematic
    total (`'kinematic'`). New `controls.setScrubTime(ms)` cuts the toolpath at a print time (resolves to
    a segment-index scrub).
  - Adapters (Vue/React/Svelte/Element): a `scrubTime` prop → `setScrubTime`.

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

- Updated dependencies [[`75f9f2b`](https://github.com/ChestnutLabs/gcode-preview/commit/75f9f2b2c758ef15b26a4b0f8dd955c89c9c5fb1), [`83f7db4`](https://github.com/ChestnutLabs/gcode-preview/commit/83f7db46be38477c4ff4127e250c6d6147c302ed), [`e8f889b`](https://github.com/ChestnutLabs/gcode-preview/commit/e8f889b576ee06da4181a048724c880ae38fedee), [`39348de`](https://github.com/ChestnutLabs/gcode-preview/commit/39348de9ce68717e71516f9acaccd475139983ba), [`5f3b16a`](https://github.com/ChestnutLabs/gcode-preview/commit/5f3b16a7aa8dfcce451d74f0cebece5f0eaaecef), [`dc1c535`](https://github.com/ChestnutLabs/gcode-preview/commit/dc1c5350ce545ae01e13c0782fed30d5d318f010), [`dc1c535`](https://github.com/ChestnutLabs/gcode-preview/commit/dc1c5350ce545ae01e13c0782fed30d5d318f010), [`17e9951`](https://github.com/ChestnutLabs/gcode-preview/commit/17e995123fa68274d508527261161741955b0647), [`f1afbb2`](https://github.com/ChestnutLabs/gcode-preview/commit/f1afbb2d2b6341805f7908aed501b4892ef7bd04), [`bb23c90`](https://github.com/ChestnutLabs/gcode-preview/commit/bb23c901cc405ea22aad9003ccb20c7cab525490), [`ca4d9c0`](https://github.com/ChestnutLabs/gcode-preview/commit/ca4d9c0cbbec7d4edc98403f615332c2b3c34453), [`4cd453f`](https://github.com/ChestnutLabs/gcode-preview/commit/4cd453f88f3dcb012af67ee8ff30159e371fd91a), [`d161e80`](https://github.com/ChestnutLabs/gcode-preview/commit/d161e802e36cc87fa27848ceef9d68cd45628760), [`82bd7ae`](https://github.com/ChestnutLabs/gcode-preview/commit/82bd7ae7f76e742767719d8efa11173a6548fc03), [`2d2b32b`](https://github.com/ChestnutLabs/gcode-preview/commit/2d2b32b836b296f2fac460073df10a7796596e9f), [`be72283`](https://github.com/ChestnutLabs/gcode-preview/commit/be72283b20215450e8bf91b9a4eee730e98b423e)]:
  - @chestnutlabs/gcode-parser@0.3.0
  - @chestnutlabs/gcode-renderer-three@0.3.0
  - @chestnutlabs/toolpath-core@0.3.0
  - @chestnutlabs/gcode-renderer-2d@0.3.0

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

- Updated dependencies [[`1c2e5b0`](https://github.com/ChestnutLabs/gcode-preview/commit/1c2e5b031845630a6f82501de51e1ae902d52559), [`d4c51a3`](https://github.com/ChestnutLabs/gcode-preview/commit/d4c51a394c1078efe959646b68f42de74e7cf4de), [`11c75bd`](https://github.com/ChestnutLabs/gcode-preview/commit/11c75bd540c1490f888ec9ecee64814cafb25156), [`aceb9f2`](https://github.com/ChestnutLabs/gcode-preview/commit/aceb9f29091bec94f0de91791dd093ab0d92b834)]:
  - @chestnutlabs/toolpath-core@0.2.0
  - @chestnutlabs/gcode-parser@0.2.0
  - @chestnutlabs/gcode-renderer-three@0.2.0

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

- Updated dependencies [[`c26879f`](https://github.com/ChestnutLabs/gcode-preview/commit/c26879f4148b77e5e9070bc2ee421a265c9571d3), [`ab7db35`](https://github.com/ChestnutLabs/gcode-preview/commit/ab7db35b3fcc84da3f26c4b6fe91671470df05c5)]:
  - @chestnutlabs/toolpath-core@0.1.0
  - @chestnutlabs/gcode-parser@0.1.0
  - @chestnutlabs/gcode-renderer-three@0.1.0
