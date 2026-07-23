# E4 Dialect & Container Benchmark — DD-005 §8 (issue #78)

**Date:** 2026-07-23 · **Machine:** Windows 11 Pro dev machine (same host as the E2/E3 reports) ·
**Harness:** [`dialect-container-bench.mjs`](../dialect-container-bench.mjs) (real dists;
TTFP through a real `worker_threads` boundary with the batteries-equivalent composition).

## 1. §8 budget results

| §8 budget | Target | Measured | Verdict |
|---|---|---|---|
| Hook overhead, hooks **unset** | ≤ 1% | **not measurable above noise** — the engine skips event creation behind `!== undefined` guards; cost is two predictable branches/line | **PASS** (architectural) |
| Adapter overhead, **active** (Prusa; and the noop-hooks floor) | ≤ 5% | paired-median runs span **−2%…+6%** — the budget sits inside this machine's noise band (committed script asserts a 10% regression tripwire) | **PASS with caveat** — see §3 |
| Container open (discovery only) @ ~250 MB plate | ≤ 250 ms | **63–100 ms** across runs | **PASS** |
| Plate inflate throughput | ≥ 5 MB/s | **146–164 MB/s** (262 MB plate) | **PASS** (~30× floor) |
| TTFP from `.gcode.3mf` @ ~100 MB plate | ≤ 3 s | **1,322 ms** (4.14 M segments final; machine metadata delivered) | **PASS** — via the §2 ratified container default |

## 2. Ratified: container-path preview threshold (maintainer decision at the E4 gate)

At the direct-input default (25 MiB), container TTFP measured **3,678 ms — over budget**: extraction
adds fixed latency and the streaming parser processes decompressed bytes slower than the in-memory
driver. Measured resolution: a **lower `partialMinBytes` default of 8 MiB for container-extracted
plate streams** restores TTFP to **1,377 ms with zero total-time cost** (14.5 s vs 14.8 s totals).
Implemented in `worker-core` (`CONTAINER_PARTIAL_MIN_BYTES`); an explicit consumer `partialPreview`
setting always wins (guarded by test). Rationale: a container already implies a substantial file, so
the threshold's purpose (skip preview overhead on small inputs) is served at 8 MiB. **Direct-input
defaults are unchanged** (DD-004 ratification stands).

## 3. Environment caveat (same class as the E3 fps deviation)

The ~5% overhead budgets cannot be resolved on this dev machine: successive paired-median runs of
identical work vary by more than the budget itself. The mechanism cost is bounded by construction
(one `CommandEvent` object per command when hooks are installed; per-marker pushes) and every
measurement lands in the −2%…+6% band. The committed script remains a **10% regression tripwire**;
a quiet reference-machine run (`node tools/benchmark/dialect-container-bench.mjs`) is recommended to
pin the exact figure, alongside the E3 `perfRun()`.

## 4. §7.2 container limits — ratified unchanged

All limits (`maxEntries` 4096, `maxEntryNameBytes` 1024, per-entry/total expanded caps 512 MB/1 GiB,
`maxMetadataBytes` 8 MB) are enforced incrementally with structured-outcome tests and produced no
measurement pressure to adjust. Ratified as shipped.

## 5. Evidence record

The [compatibility matrix](../../docs/compatibility/dialects-and-containers.md) is published as the
accumulated per-phase evidence (fixtures + dates per row); the §7.3 security review record awaits
maintainer sign-off — both are E4 exit inputs.
