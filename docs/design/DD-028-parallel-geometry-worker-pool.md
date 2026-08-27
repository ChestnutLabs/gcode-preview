# DD-028 — Parallel geometry construction (worker pool)

**Status:** Proposed <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Nathaniel Chestnut (drafted by Claude)
**Date:** 2026-08-26 · **Last revised:** 2026-08-26
**Owning Epic:** E9/E11 (renderer performance + honesty) · **Milestone:** —
**Supersedes / Superseded by:** none
**Related:** [RR-008](../research/RR-008-parallel-geometry-construction.md) (measurements + architecture),
DD-023 (capability budgets), DD-027 (RenderStats — the measurement surface), DD-029 (preparation &
reveal — the complementary UX track)

---

## 1. Problem

Tube-geometry construction (`buildTubeChunk`) runs **single-threaded on the main thread** and is the
measured bottleneck for large files — 37–60× the lines-build, ~10.7 s at opossum-scale (RR-008 Phase 0),
while a capable workstation leaves the other cores idle. Parse and classify are already off-thread; the
build is the one heavy stage still serial and main-thread. RR-008 Phase 1 made each `GeometryChunk`
**self-contained** (reads its own `positions`, no IR), so a chunk is already a transferable worker unit.
This DD adds a bounded, capability- and memory-aware **worker pool** that builds tube chunks in
parallel — turning a one-core minute into ≈ `build / workers` + upload, with **byte-identical geometry**
and no honesty-model change. It carries the maintainer's nine requirements (RR-008 §12).

## 2. Scope

- A `GeometryWorkerPool` in `@chestnutlabs/gcode-renderer-three` that builds `extrude` tube chunks on
  worker threads and returns transferable geometry buffers.
- Capability-aware **sizing** (browser `hardwareConcurrency`; Node **cgroup quota**) and **memory-aware**
  bounding of in-flight work.
- **Deterministic** reassembly + GPU upload on the main thread (unchanged WebGL path).
- Injectable worker factory (tests/headless), transfer-only data path (no `SharedArrayBuffer`).
- RenderStats concurrency fields (DD-027).
- Node/`worker_threads` adapter for the `renderStill` sidecar (later phase; same kernel).

## 3. Non-goals

- **No OffscreenCanvas** — GPU upload / WebGL stay on the main thread (RR-008 §8.2, maintainer req 8).
- **No parse/classify parallelization** (RR-008 §4 — sequential modal state; separate lever).
- **No WASM/SIMD** yet (RR-008 §8.2 — an orthogonal later multiplier).
- **No new quality mode, no segment-dropping** — parallelism only changes *how* the same chunks build;
  the tubes→lines degradation ladder is untouched (maintainer req 5).
- **No `SharedArrayBuffer` requirement** — SAB is a later opt-in optimization (RR-008 §6 / Phase 3).

## 4. Data contracts / API

### D1 — Public renderer options (additive)

```ts
interface ToolpathRendererOptions {
  /** Geometry build concurrency (DD-028). 'auto' (default) sizes a capability+memory-aware pool and
   *  only engages it above the cost threshold; 'off' forces the current synchronous main-thread build;
   *  a number pins the worker count (still memory-bounded). */
  geometryConcurrency?: 'auto' | 'off' | number;
  /** Max bytes of live geometry the build may hold at once (DD-028 memory backpressure). Defaults to a
   *  value under the tube byte budget; discovered per host (browser: a fraction of deviceMemory; Node:
   *  the cgroup memory limit). The pool never exceeds it — proactively, since a cgroup OOM is uncatchable. */
  geometryMemoryBudgetBytes?: number;
  /** Injectable worker factory (like `createRenderer`) so tests/headless/Node stub the worker. */
  createGeometryWorker?: () => GeometryWorkerLike;
}
```

The pool itself is **internal**; only these options + the RenderStats readout are public.

### D2 — Worker message protocol (internal, transfer-only)

Request (main → worker), `positions` transferred: `{ id, positions: ArrayBuffer, count, radialSegments,
lineWidth, lineHeight }`. Response (worker → main), all buffers transferred: `{ id, positions, normals,
indices, vertexSegment, vertexCount, indicesPerSegment }`. The worker runs exactly the Phase-1
`buildTubeChunk` on a reconstructed `{positions, count}` view — **the same kernel**, so output is
identical to the serial path. Colour stays main-thread in v1 (D5).

### D3 — Sizing (one kernel, two inputs; maintainer reqs 2–3)

`poolSize = clamp(coreBudget − 1, 1, MAX)` then `min(that, floor(memoryBudget / maxChunkBytes))`:

- **Browser** `coreBudget = navigator.hardwareConcurrency`.
- **Node/sidecar** `coreBudget =` the **cgroup CPU quota** (`/sys/fs/cgroup/cpu.max` quota/period, or
  `NanoCpus / 1e9`), **never** `os.cpus().length`/`os.availableParallelism()` (RR-008 §7 — a 2-CPU
  container reports 4 cores and would thrash). `MAX ≈ 4–8`.
- **Memory bound wins when tighter:** `maxChunkBytes` is known before building (`tubeSegmentBytes ×
  chunk extrude count`), so the pool is also capped so `poolSize × maxChunkBytes ≤ memoryBudget`.

### D4 — Activation (maintainer req 6)

Engage the pool only when the estimated build cost clears a threshold; small builds stay on the current
synchronous path (no worker/transfer overhead). **v1 threshold:** total extrude segments over a tuned
bound (≈ the point where serial build > ~1 s). **The segment-count threshold is a placeholder** to be
replaced by a cost/memory *estimate* (segments × per-segment build-ns estimate) — flagged as follow-up,
not baked as the permanent rule.

### D5 — Colour mapping (v1 decision)

Colour expansion (`buildChunkColors` → `tubeVertexColors`) needs the IR's feature/object/tool channels,
so **v1 keeps colour on the main thread** after the worker returns geometry (minimal worker payload).
Moving colour into the worker (passing the needed channel slices) is a measured follow-up if colour
becomes the main-thread tail.

## 5. Lifecycle

Pool created lazily on the first pool-eligible build; workers are reused across builds; disposed with
the renderer. On a build: partition into chunks (existing `buildChunks`), dispatch `extrude` chunks to
the pool with **backpressure** (≤ poolSize in flight), wrap each returned buffer set in `BufferGeometry`
+ upload on the main thread **in chunk order**, free the transferred buffers. `travel`/`wipe`/lines
chunks build on the main thread as today (cheap). Context-loss rebuild reuses the pool.

## 6. Errors & failure behavior

A worker error or death on a chunk → **fall back to building that chunk synchronously on the main
thread** (never lose a chunk); repeated worker failure disables the pool for the build and emits a
disclosure. Memory is bounded **proactively** (D3) — the pool never relies on catching an OOM (a cgroup
kill is uncatchable; RR-008 §7). The tubes→lines degradation ladder is unchanged and still applies.

## 7. Security & resource limits

No new untrusted input (chunks are already-parsed float buffers). Worker count bounded (D3); in-flight
memory bounded (D3). No `SharedArrayBuffer` (no cross-origin-isolation surface). Node worker sizing
respects the cgroup quota so a shared host is not oversubscribed.

## 8. Performance

Target: build wall ≈ `serial_build / effectivePool + upload`, bounded by the memory cap. Before
committing pool defaults, **micro-benchmark the per-chunk transfer/serialization overhead** at realistic
chunk sizes (RR-008 §10) to set the activation threshold and chunk target. RenderStats measures the
before/after (`geometryBuildMs`, `buildParallelism`, `workerCount`). No cost for small/`off` builds
(unchanged path).

## 9. Testing

- **Deterministic equivalence:** a **synchronous fake worker** (injected) that runs `buildTubeChunk`
  inline → the pooled build produces **byte-identical** geometry (positions/normals/indices/vertexSegment)
  and identical mesh/chunk order to the serial build, for single- and multi-chunk IRs.
- **Sizing:** mock `hardwareConcurrency` and a mock cgroup `cpu.max` → asserts the pool clamps to the
  quota, not the host cores; memory bound shrinks the pool when `poolSize × maxChunkBytes` exceeds budget.
- **Backpressure:** never more than poolSize in flight; peak tracked ≤ budget.
- **Fallback:** a worker that throws → the chunk still builds (main-thread fallback) and geometry is
  complete; repeated failure disables the pool + discloses.
- **Threshold:** small IR uses the synchronous path (no worker created); large IR engages the pool.
- **Invariance:** FDM geometry byte-identical (goldens unaffected — goldens are dialect/render-free).

## 10. Migration

Additive. `geometryConcurrency` defaults to `'auto'`; a consumer can force `'off'` for the current
behavior. No signature changes beyond the new options; **minor** lockstep bump. High-level
`ToolpathRenderer` consumers get faster large-file builds with no code change; the geometry is identical.
No core package depends on AnyBridge.

## 11. Observability / diagnostics

RenderStats (DD-027) gains: `buildParallelism: 'main' | 'pool'`, `workerCount`, `computeBudget`,
`memoryBudget` (bytes), and (coordinated with DD-027) `uploadMs`. A consumer panel then reads a machine
as CPU-bound / memory-bound / GPU-bound. Pool fallbacks/disclosures surface as `disclosures[]`.

## 12. Alternatives considered

- **OffscreenCanvas full-renderer-in-worker** — rejected as the first step (largest rewrite; RR-008
  §8.2). The pool is a strict subset of its benefit at far lower risk.
- **`SharedArrayBuffer`-shared IR** — rejected as a *requirement* (cross-origin isolation is off in the
  consumer today; RR-008 §6). Optional later fast-path.
- **One worker per logical core** — rejected (maintainer req; memory + UI-thread starvation).
- **Parallelize parse instead** — deferred (sequential modal state; RR-008 §4).
- **Move GPU upload off-thread** — rejected (WebGL is main-thread; only OffscreenCanvas could, deferred).

## 13. Risks

- **Worker bundling across consumer bundlers** (Vite/webpack/Rollup/Node) — mitigated by following the
  parser's proven `new Worker(new URL('./geometry-worker.js', import.meta.url), {type:'module'})` pattern
  + the injectable factory.
- **Transfer overhead** on small chunks — mitigated by the activation threshold + a chunk-size target
  (micro-benchmarked, §8).
- **Determinism** — mitigated by ordered reassembly (D-tested).
- **Memory** — bounded proactively (D3); the sidecar's uncatchable cgroup OOM is the reason it must be
  proactive.
- **Node cgroup detection edge cases** (cgroup v1 vs v2, unset quota) — fall back to a conservative
  default (e.g. 2) when the quota can't be read; never to `os.cpus()`.

## 14. Phased delivery

- **Phase 2a — Pool + browser sizing.** `GeometryWorkerPool`, worker entry, transfer path, browser
  `hardwareConcurrency` sizing, activation threshold, deterministic reassembly, injectable factory,
  RenderStats `buildParallelism`/`workerCount`. Byte-identical, golden-gated.
- **Phase 2b — Memory-aware bound + estimate activation.** `geometryMemoryBudgetBytes` discovery +
  proactive in-flight cap; replace the segment-count threshold with a cost/memory estimate.
- **Phase 4 — Node/sidecar pool.** `worker_threads` adapter + cgroup-quota sizing for `renderStill`
  (same kernel), memory-bounded under the container cap.
- (SAB fast-path = RR-008 Phase 3, a separate opt-in DD/PR; WASM/SIMD later.)

## 15. Acceptance criteria

1. At opossum-scale, pooled `geometryBuildMs` drops toward `serial / effectivePool` (bounded by the
   memory cap) vs `'off'`; small files are unchanged (synchronous path, no worker spawned).
2. Pooled geometry is **byte-identical** to the serial build (positions/normals/indices/vertexSegment)
   with identical chunk/mesh order — verified via the synchronous fake worker.
3. Pool size honors `hardwareConcurrency − 1` (browser) and the **cgroup quota** (Node), never
   `os.cpus()`; and shrinks under the memory budget so peak in-flight geometry never exceeds it.
4. A worker failure never drops a chunk (main-thread fallback) and is disclosed.
5. FDM geometry byte-identical; no core package depends on AnyBridge; the nine RR-008 §12 requirements
   are satisfied.
