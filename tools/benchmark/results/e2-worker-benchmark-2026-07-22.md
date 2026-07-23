# E2 worker-pipeline benchmark — DD-003 §8 exit evidence (issue #47)

**Date:** 2026-07-22 · **Environment:** Windows 11, Node v24.16.0, AMD64 desktop (same machine as the
RR-001 §5.5 baseline) · **Pipeline:** `GcodeParseSession` (consumer-supplied-worker escape hatch) over a
real `node:worker_threads` boundary running the actual protocol-v1 handler; one child process per fixture
for clean RSS attribution. Corpus: MIT demo 3DBenchy + synthetic 10/100/250 MB tiers (Benchy repeated,
generated to temp, never committed). Harness: `tools/benchmark/worker-bench.mjs`.

## Baseline comparison (RR-001 §5.5, main-thread engine)

| Metric @ 250 MB | Baseline (main thread) | Worker pipeline | Change |
|---|--:|--:|---|
| Longest main-thread stall | ~32,400 ms (the whole parse) | **3 ms** | ~10,000× better — the E2 goal |
| Peak process RSS | 3,272 MB | **1,532 MB** | 2.1× lower (SoA writer + budget) |
| Wall time | 32,418 ms | 29,661 ms | slightly faster despite thread hop |

## Parse (session + real worker thread; per-fixture child process)

| Fixture | Size MB | Wall ms | MB/s (target ≥5) | Max main-thread stall ms (target <16) | Peak RSS MB | Segments | Complete |
|---|--:|--:|--:|--:|--:|--:|---|
| demo/3DBenchy (3.5MB) | 3.5 | 500 | 7.05 | 2 | 102 | 108729 | true |
| synthetic ~10MB | 10.6 | 1254 | 8.43 | 2 | 152 | 326187 | true |
| synthetic ~100MB | 102.2 | 11207 | 9.12 | 2 | 666 | 3153141 | true |
| synthetic ~250MB | 250.3 | 29661 | 8.44 | 3 | 1532 | 7719759 | true |

## Cooperative cancel (~100 MB, cancel at t+500 ms)

- latency: **83 ms** (target <250) · terminate() used: **false** (must be false) · partial segments delivered: 104716

## Pure IR transfer (~250 MB IR, worker → main)

- delivery: **2 ms** (target <100) · segments: 7719759

## Verdicts vs DD-003 §8

- PASS — main-thread stall <16 ms (all tiers)
- PASS — throughput ≥5 MB/s (all tiers)
- PASS — peak RSS ≤1536 MB @ 250 MB
- PASS — transfer delivery <100 ms
- PASS — cooperative cancel <250 ms without terminate

Overall: **ALL TARGETS MET**

## Notes

- **Peak RSS @ 250 MB is within 0.3 % of the 1536 MiB target** (1532 MB). The §7.2 `maxBufferBytes`
  default (1536 MiB) is therefore calibrated right at the natural working set of the largest supported
  tier — an input materially larger than 250 MB will stop with a bounded `E_LIMIT_BUFFER_BYTES` partial
  rather than exceed memory, which is the designed behavior.
- Transfer delivery of the full 7.7 M-segment IR measured **2 ms** — zero-copy transfer working as
  specified (a structured clone of ~440 MB of buffers would take orders of magnitude longer).
- Cooperative cancel acknowledged in **83 ms** across a real thread boundary with `terminate()` unused
  and a 104,716-segment bounded partial delivered.
- Discovered en route: the packages' emitted ESM used extensionless relative imports (bundler-only);
  fixed to explicit `.js` specifiers so plain-Node consumers (and this harness) can import `dist` directly.

## §7.2 provisional defaults — verdict

Confirmed as shipped: `maxInputBytes` 512 MB · `maxSegments` 20 M · `maxBufferBytes` 1536 MiB ·
`maxLineLength` 64 KB · `maxWarnings` 10 k. Recorded in DD-003.
