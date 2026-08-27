# DD-028 geometry pool — headless SwiftShader characterization (GHR-08)

**Date:** 2026-08-27 · **Host:** GHR-08 (36 vCPU / 30 GB, Ubuntu 26.04, Node 22.22)
**Context:** Prove the Node/headless geometry worker pool against the **real AnyBridge sidecar stack** and
find the honest scaling knee under software WebGL — not a synthetic hardware-GL box. Answers the
maintainer's "don't assume 36 cores = 36 workers" and gates the `createInlineGeometryWorker()` decision.

## Harness (mirrors the sidecar exactly)

- esbuild **`format:'iife'`** app bundle + the geometry worker as a **second esbuild entry**, static-served
  at `/render-page/geometry-worker.js` (module **and** classic variants built).
- Playwright Chromium `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --no-sandbox`,
  one OffscreenCanvas page, serialized runs. GL confirmed **software**:
  `ANGLE (…SwiftShader Device (Subzero)…) | 3d-webgl | capability=software`.
- Pre-built `ToolpathIR` (parse off the clock), `quality:'tubes'`, `frameContent:'object'`, single reveal
  (`renderDuringBuild:false`) — matching `window.renderThumb`. Pool size forced via `geometryConcurrency:<n>`
  to sweep past the `'auto'` cap; `geometryBuildMs` read from the `renderStats` event (build isolated from
  the SwiftShader render).

## 1. Packaging — path 1 is a clean contract (both worker kinds)

Under headless SwiftShader Chromium, the second-esbuild-entry worker engages the pool
(`buildParallelism:'pool'`) as **both** a module worker (`{type:'module'}`) **and** a classic worker
(iife, no type). The IIFE `import.meta` warning appears as expected and is harmless because
`createGeometryWorker` is supplied by URL. **No packaging problem was demonstrated → keep
`createInlineGeometryWorker()` deferred.** (AnyBridge is shipping the classic worker for max robustness.)

## 2. Scaling knee (median `geometryBuildMs`, SwiftShader)

**1.5M segments** (serial 8867 ms):

| workers | 1 | 2 | 4 | 6 | 8 | 12 | 16 | 24 | 32 |
|---|---|---|---|---|---|---|---|---|---|
| speedup | 0.93× | 1.70× | 2.30× | 2.68× | **2.70×** | 2.32× | 2.21× | 1.84× | 1.67× |

**6.5M segments** (serial 51 631 ms — the real "flushie" dragon plate's scale):

| workers | 1 | 2 | 4 | 6 | 8 | 12 | 16 |
|---|---|---|---|---|---|---|---|
| speedup | 0.98× | 1.74× | 2.73× | 3.09× | 3.79× | **3.85×** | 3.25× |

Findings:

- **1 worker is always slower than serial** (transfer/async overhead, no parallelism) — the library
  correctly stays serial for `'auto'` below 2 effective workers.
- **The knee is 6–12 workers and it degrades past it.** Bigger plates push the knee right and the ceiling
  up (Amdahl: more parallel work per serial main-thread overhead) — ~2.7× at 6–8 (1.5M), ~3.85× at 8–12
  (6.5M).
- **The `resolvePoolSize` MAX=8 cap is validated across scales.** At 6.5M, 8 workers already yields 3.79×
  vs the 3.85× peak at 12 — the cap captures ~98% of achievable speedup and sits at/just before the knee,
  avoiding the post-knee degradation. Going 8→16 *hurts*.
- **The ceiling is the serial main thread, not SwiftShader raster.** In the single-reveal model the tube
  build and the SwiftShader render are sequential; the pool never contends with the rasterizer during the
  build. The ~3–4× ceiling comes from the un-parallelized main-thread work (chunk mesh assembly + colour
  mapping + structured-clone transfer). So **36 cores ≠ 36 workers**: the honest ceiling is ~3–4× at ~8–12
  workers, whatever the core count.

## 3. Memory behaviour

- The pool's `geometryMemoryBudgetBytes` clamp (`workers × maxChunkBytes ≤ budget`) only bites at extreme
  budgets for typical 2048-seg chunks (24→15 workers at 32 MB on the 200k warm-up; never at 1.5M down to
  32 MB). **Not the binding constraint at AnyBridge's 512 MiB.**
- The **separate `tubeByteBudget`** is the real large-plate limiter. At **6.5M segments the default tube
  budget is exceeded even at minimum cross-section → the build degrades to lines** (`tubes→lines`
  disclosure), and the pool is moot. Tubes (and thus the pool) only apply to plates whose geometry fits the
  byte budget (≈≤2–2.7M segments at a ~2 GiB budget). The 6.5M scaling above required raising
  `tubeByteBudget` to 12 GiB to force tubes.
- RSS grows ~110 MB/worker (1.5M: 1301 MB serial → 2801 MB at 32; 6.5M tubes: 4956 MB → 6935 MB at 16).

## 4. Real-file validation (DD-026 T2, same plate)

Parsing the real 53 MB `.gcode.3mf` (192 MB plate, **6 521 495 segments**, orca-bambu known, 4 tools):
`nonModelClassification: known`; the new roles land on real output — **WipeTower = 50 926**, **PrimeTower
= 4 328** segments (Purge = 0: this plate's flush is the wipe tower, no `FLUSH_` bracket). **`modelBounds`
excludes the housekeeping** and frames tighter than `bounds` (bounds `y[-0.5, 244.7]` incl. front-edge
tower/skirt → modelBounds `y[12.9, 243.1]`).

## 5. Implications for the AnyBridge sidecar

- **Review-env grant (coreBudget=2 → 1 worker):** flipping the pool on is **net-negative** (1 worker is
  slower than serial). The pool only pays at a **raised** grant.
- **Where a raise is worth it:** on plates that build tubes (fit the byte budget), ~3–4 cores → 2 workers →
  ~1.7×; ~8–9 cores → ~3.5–3.8×. Past ~12 cores there's nothing to gain (cap at 8 captures it). A very large
  plate renders as lines regardless, so the pool doesn't help there.
- **Recommendation:** keep the `'auto'` cap at 8; keep `createInlineGeometryWorker()` deferred (path 1 is
  clean); a sidecar CPU-grant raise is worth **~2 → ~8 cores** for tube-building plates and no further.

_Harness + raw results (`results-1p5M.json`, `results-6p5M-tubes.json`) on GHR-08 `~/gcode-char`; not
committed (throwaway characterization box)._
