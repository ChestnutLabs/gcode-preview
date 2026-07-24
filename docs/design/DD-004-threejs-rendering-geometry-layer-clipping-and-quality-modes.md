# DD-004 — Three.js Rendering, Geometry, Layer Clipping, and Quality Modes

**Status:** **Accepted (2026-07-22, all recommendations approved)** <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Chestnut Labs
**Date:** 2026-07-22 · **Last revised:** 2026-07-22
**Owning Epic:** E3 (#4) · **Milestone:** M2
**Supersedes / Superseded by:** none
**Related:** DD-001 (Accepted — the IR this renderer consumes), DD-002 (Accepted — package boundary),
DD-003 (Accepted — §5.3 TTFP obligation discharged in §5.4 below), RR-001 §5.4 (Sindarius LOD behavior
spec), E2 benchmark report, issue #53 (this DD), architecture doc §8, master plan §8.4/§9.2/§9.5

> **Accepted 2026-07-22 — all five decisions approved as recommended:** §4.3 lines/tubes quality tiers
> with layer-aligned chunks; §4.4 every-Nth LOD with mandatory disclosure (thresholds provisional,
> benchmark-ratified); §4.5 draw-range clipping architecture; §5.4 progressive preview required ≥ the
> 25 MB threshold via the reserved `partial` protocol slot (E3-scoped follow-up); §6.2 single Z-up→Y-up
> rotation, public API in printer coordinates. Renderer implementation may proceed per §14 phasing.

> **Benchmark ratification (2026-07-22, issue #61 — [E3 report](../../tools/benchmark/results/e3-renderer-benchmark-2026-07-22.md)):**
> §4.4 LOD steps (>2 M → ×2, >5 M → ×3, >10 M → ×5) and the §4.3 `auto` tubes boundary (≤ 1 M segments)
> are **ratified unchanged**; the §5.4 partial threshold (25 MiB, 1 s interval) is **ratified unchanged**
> (TTFP 2,873 ms @ 100 MB / 3,037 ms @ 250 MB — the 100 MB margin is 127 ms; lowering `minInputBytes`
> stays available as a consumer tuning knob). Two measured refinements are recorded as part of the
> accepted design: **time-budgeted build ticks** (~8 ms of work per tick — the fixed 4-chunks/tick
> default violated the §8 stall budget at ≥ 100 MB tiers) and a **2,048-segment chunk target in tubes
> mode** (a 250 k-segment tube chunk built for ~540 ms). All CPU-side §8 budgets measured PASS; the two
> orbit-fps budgets **remain provisional pending a reference-machine run** of the committed harness
> (`tools/demo/vr.html` → `perfRun()`) — the measurement environment for this phase virtualizes WebGL
> and suspends rAF (documented deviation, report §3). Visual-regression baselines committed
> (`test-data/visual-baselines/`, tolerance compare via `vrRun()`): 14/14 PASS at capture.

---

## 1. Problem
The inherited renderer is capable (fat lines, tube geometry, build volume, tool colors) but structurally
coupled to the inherited parser objects: `SceneManager` consumes `Job`/`Path` instances and rebuilds
`three` geometry from per-path JS arrays. It cannot render the DD-001 `ToolpathIR`, has no LOD/quality
tiers for the 100–250 MB class the E2 pipeline now parses (3–7.7 M segments), no explicit context-loss
recovery, and its full-rebuild render path re-allocates on every option change.

E2 delivered compact, transferable SoA buffers precisely so a renderer can consume them directly. DD-004
decides how `@chestnutlabs/gcode-renderer-three` turns those buffers into an interactive scene — and
discharges the **binding DD-003 §5.3 obligation** to evaluate time-to-first-preview with real numbers.

## 2. Scope
- `@chestnutlabs/gcode-renderer-three`: scene/resource lifecycle, geometry construction from IR,
  layer/range clipping and scrub, coloring/visibility modes, camera + build volume, quality/LOD modes,
  WebGL context-loss recovery, disposal.
- The renderer-facing progress-overlay *hook* (E5 supplies semantics later).
- Renderer benchmarks and visual-regression strategy.

## 3. Non-goals
- Parsing or re-parsing (architecture §8: the renderer consumes IR, never raw G-code).
- Dialect metadata production (E4), live-progress mapping semantics (E5), Vue wrapper (E6),
  2D low-resource renderer (E8), WebGPU (future ADR).
- Replacing the inherited demo/facade in this Epic's first phases (§9 migration).

## 4. Data contracts / API

### 4.1 Input contract
The renderer consumes a DD-001 `ToolpathIR` and **must not mutate it** (renderer-private GPU buffers
only). Everything it needs is already in the IR:
- `segments` SoA — positions are **origin-relative Float32**: uploadable to GPU attributes with **zero
  precision loss and zero conversion** (the floating-origin decision paying off); `kind` drives
  extrude/travel/arc visibility; `tool`/`feature` drive coloring; `layer` indexes the layer table.
- `layers[]` — **layer-contiguous segment ranges** (`segStart`/`segEnd`): the structural basis for cheap
  layer clipping (§4.5).
- `bounds`/`boundsWithTravel` + `header.originOffset` — camera framing and build-volume placement.

### 4.2 Public API (package `@chestnutlabs/gcode-renderer-three`)
```ts
class ToolpathRenderer {
  constructor(opts: { canvas: HTMLCanvasElement; buildVolume?: BuildVolumeDef; quality?: QualityMode | 'auto' });
  setIR(ir: ToolpathIR): void;            // builds renderer-private GPU resources
  setLayerRange(startLayer: number, endLayer: number): void;   // 0-based, inclusive
  setScrubPosition(segmentIndex: number): void;                // partial reveal within range
  setVisibility(v: { travel?: boolean; extrusion?: boolean }): void;
  setColorMode(m: 'tool' | 'feature' | 'single', opts?: ColorOptions): void;
  setQuality(q: QualityMode | 'auto'): void;
  frame(): void;                          // fit camera to bounds
  dispose(): void;
  onEvent(cb: (e: RendererEvent) => void): () => void;  // contextlost/restored, buildComplete, error
}
type QualityMode = 'lines' | 'tubes';
```
Camera interaction is OrbitControls-style (rotate/pan/zoom, reset) and keyboard-operable (master plan
§9.5). The facade (`@chestnutlabs/gcode-preview`, E6-era) composes this with the parser session; advanced
consumers may use the renderer directly (DD-002 §4).

### 4.3 Geometry strategy & quality tiers — DECIDED (as recommended)
| Mode | Geometry | Cost | Use |
|---|---|---|---|
| **`lines`** *(default ≥ threshold)* | one interleaved position attribute per chunk, `GL_LINES` (`LineSegments`), 2 verts/segment, vertex colors | ~48 B/segment GPU; build is a tight typed-array loop | large files; always-works fallback |
| **`tubes`** *(small/medium)* | batched extrusion geometry (inherited `ExtrusionGeometry` approach via `BatchedMesh`) | ~10–50× lines | print-like appearance where budgets allow |
- Chunking: geometry is built in **layer-aligned chunks** (target ~250 k segments/chunk) so clipping,
  partial reveal, and progressive build operate on chunk granularity without giant single buffers.
- `auto` quality picks by segment count: `tubes` ≤ 1 M segments, else `lines` (thresholds provisional,
  ratified by E3 benchmarks like DD-003 §7.2's were).
- Fat lines (`LineSegments2`, screen-space width) are an **optional enhancement within `lines` mode** for
  small files only — they cost 4 verts + instancing per segment; plain `GL_LINES` is the scalable path.
**Decided:** as recommended.

### 4.4 LOD / decimation policy — DECIDED (as recommended) (Sindarius behavior spec, RR-001 §5.4)
When segment count exceeds the interactive budget for the active mode, apply **every-Nth extrusion-move
decimation** with N stepped by count (provisional: >2 M → N=2, >5 M → N=3, >10 M → N=5), always keeping
layer-boundary segments so silhouettes and layer counts stay honest; travel moves hide first. Decimation
is a **render-only** reduction (the IR is untouched) and the active reduction is **reported to the
consumer** (capability-style event) so the UI can say "preview simplified" — degrade honestly (master
plan §9.4/§9.5). **Recommendation:** ship the mechanism + provisional thresholds; ratify numbers in the
E3 benchmark phase. *(Approved 2026-07-22.)*

### 4.5 Layer clipping & scrub strategy — DECIDED (draw-range architecture)
Two complementary mechanisms:
1. **Range clipping = chunk/draw-range selection** (primary): because segments are layer-contiguous,
   `setLayerRange` maps to whole-chunk visibility + `drawRange` trims on boundary chunks — O(chunks),
   no shader dependency, works in both modes.
2. **Intra-layer scrub = index cutoff**: `setScrubPosition(segmentIndex)` trims the boundary chunk's
   `drawRange` to the segment index (lines mode: exact; tubes mode: nearest batched item). This is also
   the hook E5's progress overlay will drive (segment index comes from `sourceIndex`/byte mapping).
The inherited shader-clip (`clipMinY/clipMaxY` uniforms) is **not** carried forward as the primary
mechanism — it clips by height rather than print order and breaks on non-planar/vase paths.
**Recommendation:** draw-range architecture. *(Approved 2026-07-22.)*

### 4.6 Coloring & visibility
- Per-segment **vertex colors** computed renderer-side from `tool`/`feature`/`kind` channels + the
  consumer palette; recolor = attribute rewrite (no geometry rebuild).
- `feature` coloring only when `capabilities.featureRoles !== 'unavailable'` — the UI is told when a
  mode is unavailable rather than silently rendering nonsense (DD-001 capability model).
- Travel rendered as plain thin lines, toggleable; arcs are ordinary segments (`ARC_SEGMENT` flag
  available for future emphasis).

## 5. Lifecycle

### 5.1 Resource lifecycle
`setIR` disposes previous GPU resources, then builds chunks (§5.3); `dispose()` releases geometries,
materials, render lists, and the renderer. Every `three` object created is tracked for disposal — the
leak class the inherited `disposables[]` pattern already fights, made systematic.

### 5.2 Context loss (master plan §8.4)
`webglcontextlost` → prevent default, emit `contextlost`, halt the render loop. `webglcontextrestored` →
rebuild all GPU resources **from the retained IR** (the canonical source survives by design), emit
`restored`. A renderer that cannot restore emits a structured `error` — never a silent black canvas.

### 5.3 Incremental build (UI responsiveness)
Geometry chunks are built **incrementally across frames** (one/few chunks per rAF tick, same cooperative
principle as DD-003 §5.2): the first chunks become visible while later ones build, and a 7.7 M-segment
IR never blocks the main thread for seconds. `buildComplete` fires when all chunks exist.

### 5.4 Time-to-first-preview — DECIDED (progressive preview ≥25 MB threshold) — the DD-003 §5.3 obligation, discharged
Measured full-parse latency (E2 benchmarks): **~0.5 s @ 3.5 MB · ~1.5 s @ 10 MB · ~11 s @ 100 MB ·
~30 s @ 250 MB**. With §5.3 incremental build, first pixels follow the `done` transfer within tens of ms.
Verdict against the master-plan §9.2 "time to first useful preview" requirement:
- **≤ ~25 MB (the overwhelmingly common case): parse-then-render is fine** — first preview in ~1–3 s
  with a progress bar. Progressive IR delivery would add complexity for negligible gain.
- **≥ ~100 MB: a 11–30 s blank canvas is NOT acceptable.** Progressive preview **is needed**.
**Recommendation:** implement the reserved `partial` protocol slot (DD-003 §4.3) as an **E3-scoped
follow-up issue**, activated only for inputs above a size threshold (provisional: 25 MB): the worker
posts layer-aligned partial segment batches (copies — transferred buffers detach, so partials are
snapshots); the renderer appends chunks as batches arrive; the final `done` transfer replaces the
snapshot set with the canonical zero-copy IR. MVP phases 1–3 ship parse-then-render; the progressive
issue lands before the E3 exit so the 100/250 MB tiers meet the requirement. *(Approved 2026-07-22.)*

## 6. Errors & environment

### 6.1 Failure behavior
Renderer errors (shader compile, allocation, context) surface as structured events; a failed `tubes`
build falls back to `lines` with an event rather than failing the preview (degrade honestly).

### 6.2 Camera & axis convention — DECIDED (as recommended)
G-code is Z-up; `three` is Y-up. Convention: the scene root applies the Z-up→Y-up rotation once, and the
**public API speaks G-code/printer coordinates exclusively** (layers along printer-Z). Build volume:
XY footprint centered per common firmware convention, origin marker at printer (0,0,0); the IR's
`originOffset` positions geometry absolutely inside the volume. **Recommendation:** as stated (matches
the inherited demo's observable behavior). *(Approved 2026-07-22.)*

## 7. Security & resource limits
The renderer receives inert IR (no untrusted text). Its resource risks are GPU/memory: geometry bytes are
budgeted (chunk building stops with an `error` + partial scene rather than driving the tab into GPU-OOM;
budget provisional, benchmarked in E3), and decimation (§4.4) bounds vertex counts. No network, no eval,
no DOM outside the provided canvas.

## 8. Performance
Provisional budgets — measured (not invented) in the E3 benchmark phase, hard-ratified like DD-003 §8:
- **Interaction:** ≥ 30 fps orbit/zoom with the 250 MB-tier IR in `lines` mode (decimation permitted, and
  reported) on the reference machine; ≥ 60 fps for ≤ 10 MB in `tubes`.
- **Geometry build:** no main-thread stall > 16 ms during incremental build; full `lines` build ≤ 2 s for
  the 250 MB tier.
- **Memory:** renderer GPU+JS overhead ≤ 2× the IR's segment-buffer bytes in `lines` mode.
- **Scrub latency:** `setLayerRange`/`setScrubPosition` ≤ 16 ms (draw-range updates only).
- **TTFP** (with §5.4 progressive follow-up): first useful preview ≤ 3 s for 100 MB, ≤ 6 s for 250 MB.

## 9. Migration
- New package built **alongside** the inherited `SceneManager`; the inherited demo keeps working
  untouched until the new renderer reaches demo parity, then a demo page switches to the IR pipeline
  (worker parse → renderer) as the E3 public-preview deliverable.
- The tube profile math from inherited `ExtrusionGeometry` (MIT) is ported with provenance recorded in
  `docs/UPSTREAM_PROVENANCE.md`, as the interpreter was (DD-003 §9 precedent).
- No inherited public API breaks in E3; facade unification is DD-002 §7 phase 3 / E6 territory.

## 10. Observability / diagnostics
Renderer exposes: active quality mode, decimation factor, chunk/vertex counts, last build duration,
context-loss count. Surfaced through the event API for the demo's diagnostics panel; no user paths or
file contents in any diagnostic.

## 11. Testing
- **Pure-geometry unit tests (Node, no GL):** chunk builders are pure functions (IR slice → typed
  arrays): vertex/index counts, layer-chunk alignment, decimation keep-set, color-channel mapping,
  draw-range math for range/scrub — all testable like the parse core.
- **Visual regression:** the Vite consumer-smoke harness pattern grows a renderer page; screenshots of
  the demo corpus at fixed camera/ranges compared within tolerance (governance §10.2 "controlled visual
  regression"); run as E3 exit evidence, automated with the release program (E7).
- **Context-loss test:** `WEBGL_lose_context` extension drive loss/restore, assert scene rebuilds.
- **Benchmarks:** extend `tools/benchmark` with a renderer page measuring §8 budgets on the corpus.

## 12. Alternatives considered
- **Reuse inherited `SceneManager` with the #29 adapter feeding it:** rejected as the target — keeps the
  object-per-path model and full-rebuild lifecycle E2 exists to escape; retained only as the migration
  bridge (§9).
- **Instanced cylinders/greased-line tricks for all sizes:** rejected as default — per-segment instancing
  costs dwarf `GL_LINES` at 7.7 M segments; kept available inside `tubes` mode where budgets allow.
- **Shader-clip as primary layer mechanism (inherited approach):** rejected (§4.5) — height-based, wrong
  for vase/non-planar, and draw-ranges are cheaper.
- **WebGPU-first:** rejected — master plan defers WebGPU to a future ADR; the chunked architecture keeps
  the door open.

## 13. Risks
| Risk | Mitigation |
|---|---|
| Fat-line/tube costs explode on large files | `auto` quality gates by segment count; `lines` fallback always available |
| Decimation misleads users | reduction reported via event; UI obligated to disclose (§4.4) |
| Progressive partial batches drift from final IR | batches are provisional; final `done` IR replaces them wholesale (§5.4) |
| GPU memory variance across devices | §7 budget + fallback; budgets ratified on reference hardware in E3 benchmarks |
| Renderer-private model becomes a second IR | chunks are rebuildable from IR only; no serialization; contract tests |

## 14. Phased delivery (issues open only after acceptance)
1. **Pure geometry builders** from IR (chunking, lines mode, colors, decimation) + Node unit tests.
2. **Scene/lifecycle**: renderer shell, camera/OrbitControls, build volume, incremental build, dispose,
   context-loss.
3. **Clipping/scrub/visibility/coloring** APIs + demo page on the worker pipeline.
4. **Tubes mode** (ported extrusion profile, BatchedMesh) + `auto` quality.
5. **Progressive preview** (`partial` protocol, ≥ 25 MB threshold) — the §5.4 verdict's follow-up.
6. **Benchmarks + visual regression** vs §8 budgets; ratify provisional thresholds.

## 15. Acceptance criteria
- Renderer consumes `ToolpathIR` only (no raw G-code, no parser internals — lint-enforced like DD-002 §5).
- Range/scrub/visibility/coloring APIs work in both quality modes; decimation is disclosed, never silent.
- Context loss recovers from retained IR; disposal leaves no GPU residue (tested).
- §8 budgets met on the reference corpus or deviations documented and explicitly accepted.
- TTFP requirement satisfied per §5.4 (progressive preview for the ≥100 MB tiers) before E3 exit.
- All **[DECISION]** items resolved and recorded.
