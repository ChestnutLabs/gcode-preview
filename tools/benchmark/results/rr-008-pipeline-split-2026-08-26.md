# RR-008 Phase 0 — geometry pipeline split (2026-08-26)

CPU-stage timings for the `parse → classify → build` pipeline, to localize the large-file load cost
before designing the RR-008 worker pool. Produced by `tools/benchmark/geometry-pipeline-split.mjs`.
**GPU upload + first-render are not measured here** (Node has no WebGL) — those come from DD-027
RenderStats in the browser.

Machine: maintainer dev workstation (single-thread Node). Absolute ms are machine-relative; the
**ratios and the stage that dominates** are the signal. Real files read in place (Cinderwing3D corpus),
not committed — reported anonymized by size + segment count.

## Synthetic build-only tiers (isolates lines-build vs tube-build; no parse)

| Segments | lines-build | tube-build | tube ÷ lines | tube verts | tube mem |
|---|---|---|---|---|---|
| 1.0M | 105 ms | 3,892 ms | 37× | 18.0M | 696 MB |
| 2.67M (opossum-scale) | 178 ms | 10,704 ms | 60× | 48.1M | **1,858 MB** |
| 5.0M | 354 ms | 20,349 ms | 57× | 90.0M | 3,480 MB |

## Real files (full parse + classify + build split)

| File (anonymized) | parse | classify | lines-build | tube-build | dialects |
|---|---|---|---|---|---|
| ~50 MB / 1.73M seg | 6,503 ms (57%) | 1,424 ms (12%) | 168 ms | 3,499 ms (31%) | orca-bambu |
| ~52 MB / 1.69M seg | 7,825 ms (65%) | 836 ms (7%) | 108 ms | 3,467 ms (29%) | orca-bambu, klipper |

(% is of the parse+classify+tube CPU total; lines-build is the alternative to tube-build, not additive.)

## Findings

1. **Tube-build is the main-thread bottleneck.** It is 37–60× the lines-build and grows with segment
   count; at opossum-scale (2.67M) the kernel alone is ~10.7 s here, and the browser adds three.js
   `BufferGeometry` creation + GPU upload + rAF slicing on top — consistent with the observed ~1-minute
   end-to-end. **This is the stage RR-008 Phase 2 parallelizes**, and it is the work that currently
   freezes and delays the main thread.

2. **Parse is the single *largest* CPU stage (57–65%) — but it already runs off the main thread** in the
   parser Web Worker, so it does not freeze the UI. It is, however, a large serial component of total
   wall-clock: at ~7.7 MB/s a 136 MB opossum parses in ~17 s. So after the build is parallelized, **parse
   becomes the tail** — reducing it is a separate lever (parser micro-optimization, or the deferred
   parse-parallelization / streaming path), not part of the build-threading work.

3. **Memory confirms the sidecar OOM.** Tube geometry at 2.67M segments is **1,858 MB** — essentially the
   sidecar's 2 GiB cap (hence the observed `OOMKilled`), and real pressure in the browser too. The
   RR-008 worker pool must bound peak *in-flight* geometry proactively (the memory-aware backpressure),
   not merely parallelize.

## Implication for RR-008

The measure-first result **confirms** the plan and **sharpens** it: parallelize the main-thread
tube-build first (biggest UI-unblocking win, uses idle cores, bounded by the 1.8 GB memory reality), and
treat parse as the next, separate lever once the build no longer dominates the main thread. DD-023
budgets should be set against the *parallel* build cost, not the single-thread floor.
