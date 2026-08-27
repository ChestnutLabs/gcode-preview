---
"@chestnutlabs/gcode-preview-core": minor
---

feat(core): parallel tube build for renderStill via the browser Web Worker pool (DD-028 Phase 4)

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
