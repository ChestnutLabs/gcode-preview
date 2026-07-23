# E5 Live-Progress Benchmark — DD-006 §8 evidence (2026-07-23)

**Harness:** `tools/benchmark/progress-bench.mjs` (`node --expose-gc`, deterministic mulberry32
observation streams) · **Node** v24.16.0 · **Machine:** dev laptop (same noise-band caveat as the
E2–E4 reports: ~5 % deltas unresolvable here; these results clear budgets by 15–30×, far outside
the noise band, so no reference-machine confirmation is required for the verdicts).

## Mapper `observe()` latency (budget: p95 < 0.1 ms at the 10 M tier)

ms per observation, 10 000 samples per tier after 2 000-observation warmup:

| IR tier | byte | layer | percent-bytes | percent-job | byte+layer cross-check |
|---|---|---|---|---|---|
| 10 MB (310 k segs) | p95 0.002 | 0.001 | 0.002 | 0.001 | 0.002 |
| 100 MB (3.15 M) | 0.003 | 0.002 | 0.002 | 0.002 | 0.003 |
| 250 MB (7.7 M) | 0.003 | 0.002 | 0.003 | 0.001 | 0.003 |
| **10 M** | **0.003** | 0.002 | 0.002 | 0.001 | 0.003 |

**Worst p95 anywhere: 0.003 ms — PASS (33× under budget).** p50 is 0.001–0.002 ms everywhere;
occasional maxima (≤ ~1 ms) are GC/scheduler blips, not algorithmic (binary searches are O(log n):
the 10 M tier is no slower than 310 k).

## Steady-state allocation (10 Hz soak proxy)

50 000 byte-tier observations after warmup, `--expose-gc` collected before/after:

| IR tier | heap drift | per observation |
|---|---|---|
| 310 k / 3.15 M / 7.7 M / 10 M | −30…+6 KB total | **0 B/obs** |

**No steady-state allocation growth — PASS.** (Result objects are small and die young; nothing
accumulates in the mapper.)

## Renderer `setProgress()` (budget: ≤ 0.5 ms steady-state — the DD-004 scrub budget)

Lines scene fully built (headless stub GL — CPU-side draw-state walk incl. ghost/band overlay
range updates; 2 000 samples each):

| IR tier | chunks | overlay warm-up (one-time) | exact p50 / p95 | band p50 / p95 |
|---|---|---|---|---|
| 100 MB (3.15 M) | 7 | 2.9 ms | 0.005 / 0.007 | 0.005 / 0.011 |
| 10 M | 14 | 4.1 ms | 0.007 / **0.029** | 0.007 / 0.013 |

**Worst p95: 0.029 ms — PASS (17× under budget).** The one-time ghost/band mesh warm-up (2.9–4.1
ms) happens on the first live observation only and is under a frame.

## Verdicts vs DD-006 §8

| Target | Result | Verdict |
|---|---|---|
| `observe()` p95 < 0.1 ms @ 10 M | 0.003 ms | **PASS** |
| `setProgress` ≤ scrub budget (0.5 ms) | 0.029 ms | **PASS** |
| 10 Hz soak: no steady-state allocation | 0 B/obs over 50 k | **PASS** |
| No frame regression vs E3 baselines | vr 17/17 PASS incl. 14 pre-overlay baselines unchanged (2026-07-23 run) | **PASS** |
| Tubes ghost cost | ghost pass renders the chunk LINE buffers (shared/wrapped attributes) — CPU cost included above; GPU overdraw needs real GL | reference-machine item (with E3 orbit-fps) |

## Reference-machine items (accumulating, non-blocking)

Run on real hardware alongside the E3 `perfRun()`:
1. `http://localhost:5199/vr.html` → `perfRun()` — orbit fps (E3) now also exercises scenes with
   the overlay ghost active.
2. GPU frame cost of the ghost pass on the 250 MB tier (expectation: lines drawn ≤ 2×; the tubes
   path ghosts as lines by design).
