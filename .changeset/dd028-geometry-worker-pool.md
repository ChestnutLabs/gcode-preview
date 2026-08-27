---
"@chestnutlabs/gcode-renderer-three": minor
---

feat(renderer): geometry worker pool — parallel tube build (DD-028, first phase)

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
