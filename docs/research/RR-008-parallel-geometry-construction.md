# RR-008 — Parallelizing geometry construction

**Status:** In progress <!-- In progress | Complete | Superseded -->
**Author(s):** Nathaniel Chestnut (investigated by Claude)
**Date:** 2026-08-26
**Owning Epic:** E9/E11 (renderer performance + honesty) · **Informs:** a future DD (threading
architecture), DD-023 (capability budgets — this RR argues the single-thread build cost is a floor to
lower, not a ceiling to budget around), DD-027 (RenderStats — the measurement harness)

## 1. Question & the decision it informs

An RTX 4070 takes ~1 minute to load the "opossum" plate (~2.67M segments) at Detail:High. The GPU is
confirmed **hardware** (`ANGLE (NVIDIA … RTX 4070 …, D3D11)`), so the wait is **CPU-side, single-
threaded JavaScript geometry construction**, while the rest of a many-core workstation sits idle. The
decision this informs: **should geometry construction be parallelized across a worker pool, and if so
where and how** — before we bake DD-023 quality-degradation budgets around a single-thread assumption.

The maintainer's directive: treat the single-thread timing as a baseline to *improve*, use available
CPU where the workload can be safely parallelized, be capability- and memory-aware (not one-worker-
per-core), and bring architecture/options **before** a large threading rewrite.

## 2. The current pipeline, stage by stage

| Stage | Where it runs today | Cost | Bound |
|---|---|---|---|
| **Parse** (lex bytes → IR SoA) | **Web Worker** (`gcode-parser/session.ts:64`) | moderate | already off main thread; single-threaded within the worker |
| **Classify** (dialect adapters: features/objects/roles) | **same Web Worker** (composed in `worker-core`) | low–moderate | off main thread |
| **IR handoff** (typed arrays → main) | zero-copy `ArrayBuffer` **transfer** (`protocol.ts:119`) | ~free | — |
| **Geometry build — lines** (`buildChunks`) | **MAIN THREAD** | low (typed-array copies) | single-threaded |
| **Geometry build — tubes** (`buildTubeChunk`) | **MAIN THREAD** (`scene.ts:677`, per chunk in `buildTick`) | **HIGH** — per-segment trig × `radialSegments` | **single-threaded — the bottleneck** |
| **GPU upload** (`BufferGeometry`/`BufferAttribute`) | **MAIN THREAD** (`makeChunkMesh`) | moderate; lazy on first render | WebGL-context-bound → must stay main thread (unless OffscreenCanvas) |
| **Render** | main thread | low once built | WebGL-context-bound |

**Conclusion:** parse and classify are *already* off the main thread. The `~1 minute` is almost
entirely **`buildTubeChunk` on one thread**. `buildTick` (`scene.ts:702`) time-slices the build across
animation frames so the UI stays responsive, but that only *spreads* the single-thread cost over frames
— it never uses a second core. GPU upload is a smaller, main-thread-bound tail.

## 3. Cost profile — why tubes dominate

`buildTubeChunk` (`tubes.ts:109`) is a pure typed-array kernel. Per segment it writes `radialSegments`
ring vertices, each requiring corner-averaged tangent + smallest-axis normal + `sin`/`cos`/`hypot`/
normalize (`writeRing`, `tubes.ts:138`). For the opossum that is ≈2.67M segments × (8+1) ring vertices
× several transcendental ops — tens of millions of trig evaluations on one thread. `buildChunks` for
lines (`chunks.ts:127`) is only SoA→interleaved **copies** (cheap). So tubes are the target; lines are
already near-free.

**Measured (Phase 0, 2026-08-26 — see `tools/benchmark/results/rr-008-pipeline-split-2026-08-26.md`).**
Tube-build is 37–60× the lines-build; at 2.67M segments the bare kernel is ~10.7 s and its geometry is
1,858 MB (≈ the 2 GiB sidecar cap → the observed `OOMKilled`). On a real 50 MB / 1.73 M-segment file:
parse 6.5 s (57%, in the worker), classify 1.4 s, bare tube-kernel 3.5 s.

**Correction — the kernel number is a FLOOR, not the on-screen wall-clock.** A follow-up measurement of
the *full* renderer build path on that same file (color expansion + three.js `BufferGeometry`
construction + build ticks, still headless so **no** real GPU work) was **5.1 s vs 3.7 s** for the bare
kernel — ~35% more. And even that excludes three browser-only main-thread costs the Node bench
structurally cannot see:

1. **GPU upload** of the tube geometry (hundreds of MB) — main-thread, on first draw of each chunk.
2. **`renderDuringBuild` re-renders the *growing* scene every tick** — 187 real GPU renders on that
   1.73M file (more at opossum-scale), each of an increasingly-large tube scene. The interactive
   default renders during the build; the headless stub `render()` is a no-op, so this is invisible in
   every Node number here.
3. **rAF frame gaps** — the build yields to a ~16 ms browser frame each tick (185 ticks ≈ ≥3 s of
   frame-boundary latency, more when a frame's render exceeds the budget).

So the on-screen ~1 minute for the opossum = parse (worker, ~17 s at 136 MB) + full main-thread build +
GPU upload + ~hundreds of intermediate scene renders + rAF gaps. **The authoritative end-to-end split
must come from DD-027 RenderStats in a real browser** (with `uploadMs`, `firstRenderMs`, and an
intermediate-render count) — the Node kernel numbers are the inner floor that motivated the threading
direction, not the wall-clock. Finding (2) is independently actionable and cheaper than threading: see
§8.1.

## 4. Parallelization analysis, stage by stage

- **Parse:** partitioning the byte stream across workers is hard — the lexer carries **sequential modal
  state** (G90/G91 abs/rel, M82/M83 extruder mode, current position, active tool). A safe split needs a
  cheap pre-scan for line offsets + modal checkpoints. Parse is also a smaller fraction than tube build.
  **Defer** — revisit only after build is parallel and RenderStats shows parse is the new tail.
- **Classify:** runs in the parse worker; cheap relative to build. **Defer.**
- **Geometry build (tubes):** **embarrassingly parallel at chunk granularity.** Each `GeometryChunk` is
  independent; tube continuity is *within* a chunk (`findPolylines` splits at discontinuities inside the
  chunk), and chunks are **layer-aligned**, so partitioning at chunk boundaries loses no continuity —
  the exact §4.5 draw-range contract is per-chunk already. **This is the parallelization target.**
- **GPU upload:** WebGL-context-bound → main thread. Moving array *construction* off-thread still frees
  the main thread of the expensive part; upload of prebuilt buffers is comparatively cheap. Only
  **OffscreenCanvas** (§6) can move upload itself off the main thread.

### 4.1 The key enabler — self-contained chunks

`buildTubeChunk` currently reads `ir.segments.{x0..z1}` indexed by `chunk.segIndices`. But
`chunk.positions` **already holds those same six endpoints per segment** (`chunks.ts:139`). Refactoring
the kernel (and `findPolylines`) to read `chunk.positions` instead of `ir.segments` makes each chunk
**self-contained**: a worker needs only the chunk's `positions` `Float32Array` (transferable), never the
whole IR. This:

- removes any need for `SharedArrayBuffer` in the base design (no cross-origin-isolation dependency);
- bounds per-worker memory to a single chunk;
- is a **pure, behavior-identical refactor** — golden/visual-parity-gated, shippable on its own even
  before any worker exists (it also cleanly decouples the kernel from the IR type).

## 5. Concurrency model (capability- and memory-aware)

- **Pool size** = `clamp(coreBudget - 1, 1, MAX)` with `MAX` ≈ 4–8 (diminishing returns + per-worker
  memory; leave a core for the main/UI thread). `coreBudget` is `navigator.hardwareConcurrency` in the
  browser, but **the cgroup CPU quota, not `os.cpus().length`, in Node** — see §7: a container with a
  2-CPU CFS quota on a 4-core host reports 4 from `os.cpus().length`/older `os.availableParallelism()`,
  and a pool sized to that oversubscribes the quota (context-switch thrash, not throughput). Read
  `/sys/fs/cgroup/cpu.max` (quota/period) or clamp to `NanoCpus / 1e9`.
- **Engage-threshold:** only fan out above a size where the win beats worker spin-up + transfer overhead
  (e.g. tube builds over ~200k segments); small builds stay synchronous on the main thread. Avoids
  regressing the common small-file case.
- **Backpressure / memory cap:** at most `poolSize` chunks in flight; each task's output buffers are
  transferred back, wrapped, uploaded, then freed → peak ≈ `poolSize × per-chunk geometry`, kept under
  the existing `tubeByteBudget`. If `poolSize × per-chunk` would exceed the budget, shrink the pool.
- **Determinism:** reassemble chunk meshes in chunk order regardless of completion order, so scene
  contents and `drawRange` math are identical to the serial build.
- **Never one-worker-per-core** (the maintainer's explicit constraint) — the cap + threshold + memory
  gate are the whole point.

## 6. Data-transfer options

1. **Transfer/copy (default; no cross-origin isolation needed).** Hand each worker its chunk's
   `positions` buffer (a clone, since the main thread keeps `chunk.positions` for lines fallback +
   picking); the worker returns `positions`/`normals`/`indices`/`vertexSegment`/`color` as
   **transferred** `ArrayBuffer`s. Portable everywhere; bounded memory. This is the base design.
2. **`SharedArrayBuffer` fast-path (optional; requires `crossOriginIsolated`).** When the host serves
   COOP:`same-origin` + COEP:`require-corp`/`credentialless`, place the IR coordinate arrays in a SAB and
   let workers read directly — zero per-chunk copy. Feature-detected; **falls back to (1)** when
   isolation is absent. Gated on a *consumer deployment* choice (headers).

   *Deployment reality (AnyBridge, confirmed 2026-08-26):* the viewer host does **not** set COOP/COEP
   today, so `crossOriginIsolated` is false and SAB is unusable there now. It **is** achievable — the SPA
   is served same-origin and self-contained (SPA + API + assets one origin, no CDN), so COOP/COEP can be
   added in the same middleware — but it is an owner-gated deployment-behavior change, with a subresource
   audit caveat (COEP:`require-corp` requires every subresource to be same-origin or CORP-tagged; any
   web-font/CDN subresource must be self-hosted or the host must use COEP:`credentialless`). **Implication
   for us:** the base design **must not require** isolation (path 1); SAB is a pure optimization we can
   light up later *if* measurement shows the per-chunk copy is a real cost and the consumer opts into the
   headers. The self-contained-chunk refactor (§4.1) means path 1 already needs no IR sharing at all.

## 7. Worker packaging & the sidecar

- **Browser:** bundle a dedicated geometry worker the same way the parser already does —
  `new Worker(new URL('./geometry-worker.js', import.meta.url), { type: 'module' })` — with an
  **injectable factory** (like the renderer's `createRenderer`) so tests/headless can stub it. This is a
  solved pattern in this repo.
- **Node / sidecar (`renderStill`):** the same `buildTubeChunk` runs there single-threaded too, so a
  `worker_threads` pool with the same self-contained-chunk kernel parallelizes headless big-plate stills
  as well — one kernel, two host adapters.

  *Deployment reality (service-manager, review-env `wrk-496014` on hubulinu, 2026-08-26):* the gcode
  sidecar container has **NanoCpus = 2.0 CPUs** (CFS quota, not cpuset-pinned) on a 4-vCPU/15 GiB host,
  and a **2 GiB hard memory cap**. Two consequences for the design:
  - **Size the Node pool to the cgroup quota, not `os.cpus().length`** (§5) — here that means **≤ 2 build
    workers** at current sizing. The limit is raisable server-side via the worker's resource spec, so
    read it at runtime rather than hard-coding.
  - **Big-plate stills are already MEMORY-bound**, not only CPU-bound: the sidecar has hit an observed
    `OOMKilled` at the 2 GiB cap on big plates. So a parallel build there must **not** multiply peak
    working set — the in-flight-chunk cap (§5) and the existing `tubeByteBudget` must be enforced against
    the 2 GiB ceiling, and more workers must not mean proportionally more live geometry. This *reinforces*
    the memory-aware backpressure design rather than changing it.
  - **The observed kill was `OOMKilled=true` — a kernel *cgroup* kill at the container limit, not an
    in-process V8 heap OOM** (which would show `OOMKilled=false` + non-zero exit). Two consequences: (a) a
    cgroup kill is **uncatchable in-process** — no JS `try/catch` or `'error'` event fires — so the pool
    must bound peak working set **proactively below the cap**, never react to an allocation failure; and
    (b) because it is a cgroup (not heap-ceiling) death, **raising the container memory cap is a valid
    lever** (a V8-heap OOM would instead need `--max-old-space-size` headroom). So the backpressure must
    key off a *configured* budget (default under the cap, raisable with it), not off catching failures.
    (SM sees container resource observations, not phase timings or the internal call stack — phase
    attribution + which stage OOMs must come from instrumenting `renderStill` itself, i.e. the DD-027
    timings applied to the headless path.)

## 8. Later multipliers (independent of the pool)

### 8.1 Render-during-build — a cheaper, independent win (feeds DD-029)

Phase 0 surfaced a cost that is **not** threading and is cheaper to fix: with `renderDuringBuild=true`
(the interactive default), `buildTick` re-renders the **growing** scene every tick — ~187 real GPU
renders for a 1.73M file, more at opossum-scale — each of an increasingly-large tube scene. The user
cannot meaningfully inspect a half-built toolpath, and repeatedly rendering it is expensive, worst on
weaker machines. Two levers, both independent of the worker pool:

1. **Make prepare → single clean reveal a first-class path** (not just the existing `progressivePreview:
   'hold'`, which suppresses the *line preview* but still renders the growing *tube* scene each tick).
   The interactive build should be able to render **once**, at completion, with honest staged progress
   in the meantime — the `renderDuringBuild:false` path (#375, today headless-only) generalized to
   interactive. **This is the subject of DD-029 (preparation & reveal).**
2. **When progressive preview *is* used** (cheap/small workloads), throttle **screen redraws** by a
   time / render-cost budget rather than blindly every tick — never by dropping geometry work. Every
   extrusion segment is still built; only the number of intermediate *draws* is bounded.

Neither drops segments. Both reduce on-screen time before (and on top of) the worker pool.

### 8.2 WASM/SIMD and OffscreenCanvas

- **WASM + SIMD kernel.** `writeRing`'s trig/normalize is a natural `f32x4` SIMD target; a WASM kernel
  processing ring vertices in lanes would speed each worker further. Sequence it **after** the JS worker
  pool proves the harness — it is an orthogonal multiplier, not a prerequisite.
- **OffscreenCanvas (endgame).** `transferControlToOffscreen` moves the *entire* renderer (build + GL +
  upload + render) into a worker, freeing the main thread completely — but it is the **largest rewrite**
  (event/pointer forwarding, pick raycasting, camera, resize, context-loss all cross the worker
  boundary). The worker-pool build is a strict subset of its benefit at far lower risk; recommend the
  pool first and OffscreenCanvas as a later strategic decision.

## 9. Coordination with DD-027 (RenderStats)

RenderStats is the measurement harness for this work and makes the bottleneck (and the improvement)
visible. Beyond the landed fields, add: `uploadMs` (GPU-upload split, distinct from `geometryBuildMs`),
and concurrency fields — `buildParallelism: 'main' | 'pool'`, `workerCount`, `hardwareConcurrency`. Then
a panel reads "parse 3s / build 55s / upload 2s, main-thread, 1 worker" today and "build 9s, pool, 6
workers" after — the before/after the maintainer asked for.

## 10. Limitations & unknowns

- **Exact stage split not yet measured** — the parse-vs-build-vs-upload numbers on the opossum are
  pending (DD-027 `geometryBuildMs` + AnyBridge manual capture). The design should be **confirmed against
  real numbers before Phase 2 code** (measure first).
- ~~**`crossOriginIsolated` status** of the AnyBridge viewer host~~ — **answered (2026-08-26):** off
  today, AB-achievable if the SAB path wins (§6). Confirms the base design must not require isolation.
- **`navigator.hardwareConcurrency`** on the owner's box (asked — pending). **Sidecar vCPU/RAM answered
  (2026-08-26):** 2-CPU CFS quota + 2 GiB hard cap, raisable (§7); big plates already `OOMKilled` at the
  cap → server-side is memory-bound, and the Node pool must be cgroup-quota-aware.
- Worker transfer/serialization overhead per chunk at realistic chunk sizes (to be micro-benchmarked in
  Phase 2 before committing pool defaults).

## 11. Recommendation & phasing (measure-first, low-risk-first)

- **Phase 0 — Measure.** Land RenderStats timings (Phase 1 done; core `parseMs`/`totalReadyMs` next) and
  get the real opossum split. Do **not** design pool defaults blind.
- **Phase 1 — Enabler (low risk).** Refactor `buildTubeChunk`/`findPolylines` to **self-contained
  chunks** (read `chunk.positions`, not `ir.segments`). Pure, golden-gated, ships decoupling value with
  zero threading.
- **Phase 2 — Worker pool.** Geometry worker + bounded, capability- and memory-aware pool for tube build;
  transfer path (no isolation dependency); engage-threshold; injectable factory; deterministic
  reassembly; RenderStats concurrency + `uploadMs` fields.
- **Phase 3 — SAB fast-path (optional).** Feature-detected `SharedArrayBuffer` sharing of IR coords when
  the host is cross-origin isolated; transfer fallback otherwise.
- **Phase 4 — Node/sidecar pool.** `worker_threads` pool for `renderStill`, same kernel; parallelizes
  headless stills within the cgroup quota.
- **Phase 5 — Later multipliers.** WASM/SIMD tube kernel; and, as a separate strategic effort,
  OffscreenCanvas full-renderer-in-worker.

**Rejected / deferred now:** parallelizing parse (sequential modal state; smaller fraction — revisit
after build); OffscreenCanvas as the first step (largest rewrite); one-worker-per-core (memory/UI);
`SharedArrayBuffer` as a *requirement* (base design must work without cross-origin isolation).

**Net:** the pipeline is already well-factored for this — parse/classify are off-thread, the build is a
pure kernel over independent layer-aligned chunks, and one small refactor makes those chunks fully
self-contained. A bounded worker pool then turns a one-core minute into roughly `minute / workers` plus
upload, without touching geometry correctness or the honesty model. DD-023 budgets should be set against
the *parallel* build cost, not the single-thread floor.

## 12. Phase 2 worker-pool design requirements (maintainer-directed, 2026-08-26)

Carried into the Phase 2 threading DD; Phase 0 + Phase 1 approved to proceed now.

1. **The 2 CPU / 2 GiB sidecar grant is not the renderer's permanent ceiling** — it is the current
   workload grant and is raisable on more capable hosts. The renderer must **adapt to the compute and
   memory it is actually allowed to use**, discovered at runtime, not hard-code today's sizing.
2. **One kernel, two sizing inputs.** Browser and managed sidecar share the geometry kernel but size
   differently: browser off available *client* concurrency (leaving the UI responsive); managed worker
   off the actual **cgroup / Service-Manager CPU quota and memory limit**, never raw host `os.cpus()`.
3. **Worker count bounded by BOTH compute and memory**, not `hardwareConcurrency` alone — whichever binds
   first sets the pool size.
4. **Proactive memory backpressure.** The observed `OOMKilled=true` (cgroup kill) is uncatchable
   in-process, so peak *in-flight* geometry memory must be bounded **ahead of allocation**, not by
   catching failures afterward.
5. **Deterministic ordering + exact correctness.** Parallelism must not create seams, lost joins,
   reordered material/tool state, or a new quality mode — byte-for-byte the same geometry, reassembled in
   deterministic chunk order.
6. **Cost/memory-estimate activation, eventually.** Large-work fan-out should key off a useful
   cost/memory *estimate*, not an arbitrary "segment count ≥ N → use workers" rule (the initial threshold
   is a placeholder to be replaced by the estimate).
7. **`SharedArrayBuffer` stays optional.** The first implementation must work with **transferable
   buffers, no COOP/COEP required**; SAB is a later optimization layer only if measured copy costs prove
   it worthwhile.
8. **GPU upload / main-thread WebGL stays where it belongs.** The target is the CPU geometry kernel; do
   not move WebGL off the main thread just to thread (OffscreenCanvas remains a separate, later call).
9. **Expose concurrency + memory facts through RenderStats** — worker count, parallelism mode, the
   compute/memory budget actually used — so a machine can be seen to be CPU-bound, memory-bound, or
   GPU-bound rather than guessed.
