---
"@chestnutlabs/gcode-renderer-three": minor
"@chestnutlabs/gcode-preview-core": minor
---

feat(renderer): wire the geometry worker pool into the build path (DD-028 #1+#2)

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
