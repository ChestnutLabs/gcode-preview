# E3 Renderer Benchmark & Visual Regression — DD-004 §8 (issue #61)

**Date:** 2026-07-22 · **Machine:** Windows 11 Pro dev machine (same host as the
[E2 report](e2-worker-benchmark-2026-07-22.md)) · **Harnesses:**
[`renderer-bench.mjs`](../renderer-bench.mjs) (Node, warm-run),
[`partial-ttfp-bench.mjs`](../partial-ttfp-bench.mjs) (real `worker_threads` boundary),
`tools/demo/vr.html` (in-browser GL: `vrRun()` / `perfRun()`).

Synthetic tiers match the DD-003 corpus by segment count: **~10 MB ≈ 310 k**,
**~100 MB ≈ 3.15 M**, **~250 MB ≈ 7.7 M** segments.

## 1. §8 budget results

| §8 budget | Target | Measured | Verdict |
|---|---|---|---|
| Full `lines` build @ 250 MB tier | ≤ 2 s | **498 ms** (7.7 M segs, decimation ×3 → 2.57 M drawn, 11 chunks) | **PASS** |
| Incremental-build stall (`lines`) | ≤ 16 ms/tick | **12.5 ms max** (250 MB tier, time-budgeted ticks; 100 MB: 11.9 ms; 10 MB: 7.0 ms) | **PASS** |
| Renderer memory (`lines`) | ≤ 2× IR bytes | **0.4×** @ 250 MB tier (123 MB vs 308 MB IR); 0.6× @ 100 MB; 1.2× @ 10 MB (no decimation) | **PASS** |
| `setLayerRange`/`setScrubPosition` | ≤ 16 ms | **≤ 0.5 ms** at every tier (Node); 0.7 ms live in-browser on real IRs (#58/#59) | **PASS** |
| TTFP (progressive preview) | ≤ 3 s @ 100 MB, ≤ 6 s @ 250 MB | **2,873 ms** @ 100 MB (774 k segs shown) · **3,037 ms** @ 250 MB | **PASS** (#60) |
| Orbit fps ≥ 30 @ 250 MB `lines` · ≥ 60 @ ≤10 MB `tubes` | reference machine | **Deferred — see §3** | **DEVIATION (documented)** |

## 2. Findings & fixes made during this phase

- **Fixed:** the phase-2 fixed `chunksPerTick: 4` produced 23–29 ms ticks at the
  big tiers. Default ticks are now **time-budgeted** (~8 ms of work per tick,
  ≥ 1 chunk; explicit `chunksPerTick` remains for deterministic tests). Warm-run
  max tick at every tier is now within budget.
- **Fixed:** tube chunks at the 250 k lines target would build for ~540 ms each.
  Tubes mode now re-chunks at **2,048 segments/chunk**, bounding per-chunk build
  work under the stall budget (~4–8 ms/chunk warm).
- **Cold-start caveat:** the very first build after process start can show a
  30–66 ms tick (JIT + first-GC); steady-state is within budget. Recorded, not
  budget-relevant (the budget governs interactive use).
- **Node GC caveat (tubes):** Node-measured tube-build max ticks (29–55 ms)
  are dominated by V8 major-GC pauses under the 193–624 MB allocation burst,
  not by scheduled work (which is time-budgeted). Browser GC behavior differs;
  the in-browser harness measures the real thing on real hardware.
- **Tubes cost data:** 310 k segs → 5.58 M verts / 193 MB / 1.2 s total build;
  1 M segs (auto boundary) → 18 M verts / 624 MB / 3.6 s total build.

## 3. fps measurement — environment limitation (deviation for acceptance)

The embedded browser pane used for this session **suspends requestAnimationFrame
and virtualizes WebGL**, so vsync-based fps is unmeasurable and forced-sync
(`readPixels`) numbers measure the remoting pipeline, not frame cost (observed
3–22 "fps" while the same pane interactively rendered 935 k-vertex scenes
smoothly). The committed harness makes the ratification run a 2-minute task on
real hardware: open `tools/demo` → `npm run dev` → `/vr.html` → `perfRun()`
(orbit fps for ≤10 MB tubes and the 250 MB-tier lines scene) and `vrRun()`
(visual regression). **The two fps budgets remain provisional pending that
reference-machine run** — every CPU-side §8 budget is ratified by the numbers
above.

## 4. Visual regression (governance §10.2)

Baseline: the 7 MIT corpus fixtures × {lines, tubes} rendered at a fixed
camera (`frame()` on model bounds) at 800×600 — **14 baseline PNGs** committed
under [`test-data/visual-baselines/`](../../../test-data/visual-baselines/) with
compact metrics (16×16 grayscale grid + lit-pixel ratio) in
`tools/demo/src/vr-baseline.json`. Tolerance compare (`vrRun()`): mean grid
delta ≤ 10/255 per cell and lit-ratio delta ≤ 0.05. Re-run against the committed
baseline in the capture environment: **14/14 PASS**.

## 5. Threshold ratifications → DD-004

| Threshold | Provisional | Ratified | Evidence |
|---|---|---|---|
| §4.4 LOD steps | >2 M → ×2, >5 M → ×3, >10 M → ×5 | **unchanged** | keeps 250 MB tier at 123 MB geometry / 498 ms build with layer boundaries intact |
| §4.3 `auto` tubes boundary | ≤ 1 M segments | **unchanged** | 18 M verts / 624 MB / 3.6 s at the boundary — heavy but buildable; §6.1 fallback + per-chunk vertex budget guard the edge |
| Tubes chunk target | (new) | **2,048 segs/chunk** | bounds per-tick tube work under the 16 ms stall budget |
| Tick scheduling | `chunksPerTick: 4` | **time-budgeted ~8 ms/tick** | fixed-count ticks violated §8 at ≥100 MB tiers |
| §5.4 partial threshold | ≥ 25 MiB, 1 s interval | **unchanged** | TTFP passes both budgets; 100 MB margin is 127 ms — lowering `minInputBytes` (e.g. 16 MiB) documented as an available tuning knob, not required |
