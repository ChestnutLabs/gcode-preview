# DD-028 pool tuning — chunk target vs speedup under the memory cap (2026-08-26)

The "measure and tune" checkpoint for the pool wiring: does the renderer's tube chunk target
(`TUBES_CHUNK_TARGET = 2048`, tuned for the *inline* per-tick stall budget) hurt the *pool* path (many
small chunks → many worker round-trips)? Swept the chunk target against the real `worker_threads` pool
at opossum-scale (2.67M segments), applying the DD-028 memory cap (`workers × maxChunkBytes ≤ budget`,
budget = 225 MB = half the 450 MB tube budget) with an 8-core sizing.

Serial baseline: 9,891 ms.

| chunk target | chunks | max chunk MB | memCap | pool size | pool ms | speedup |
|---|---|---|---|---|---|---|
| **2,048** (renderer default) | 223 | 7 | 33 | 7 | 1,531 | **6.46×** |
| 16,000 | 112 | 13 | 16 | 7 | 1,522 | 6.50× |
| 32,000 | 75 | 20 | 11 | 7 | 1,683 | 5.88× |
| 65,000 | 38 | 40 | 5 | 5 | 2,149 | 4.60× |
| 128,000 | 21 | 73 | 3 | 3 | 3,506 | 2.82× |
| 250,000 | 11 | 139 | 1 | 1 | 9,435 | 1.05× |

## Findings

1. **The renderer's existing `2048` chunk target is near-optimal for the pool — 6.46×.** The worry that
   many small chunks (223 of them) would erode the speedup via worker round-trips was **wrong**: the
   round-trip overhead is negligible, and small chunks keep the memory cap generous (`memCap = 33`), so
   the pool runs at the full core-limited size (7 on an 8-core box). **No re-chunking is needed.**
2. **The memory cap is the real constraint — and it degrades gracefully, exactly as designed.** Large
   chunks (250k → 139 MB each) get memory-capped to **1 worker** → ~1× (serial-safe, *no OOM*). This is
   the proactive backpressure working: parallelism is bounded so peak transient geometry never exceeds
   the budget. A build that can't be parallelized within budget stays serial rather than OOMing.
3. **Sweet spot 2k–16k segments/chunk (≈6.5×).** The renderer sits in it. Larger chunks trade speedup
   for lower round-trip count but hit the memory cap sooner; smaller is fine.

## Conclusion

The merged pool wiring (#1) + memory cap (#2) are well-tuned as shipped: ~6.5× on an 8-core box at the
opossum scale, memory-safe by construction. Real per-machine speedup is bounded by the client's core +
memory budget (fewer cores → lower ceiling; tighter memory → the cap engages sooner), and the owner's
4070 human-pass will confirm the end-to-end browser numbers post-publish.
