# DD-003 — Worker Parsing, Streaming, Transfer, and Resource Limits

**Status:** **Accepted (2026-07-22, with maintainer amendments)** <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Chestnut Labs
**Date:** 2026-07-22 · **Last revised:** 2026-07-22 (amendment)
**Owning Epic:** E2 (#3) · **Milestone:** M2
**Supersedes / Superseded by:** none
**Related:** DD-001 (Accepted), DD-002 (Accepted), RR-001 (Accepted; §5.4 reference behavior, §5.5 baseline
benchmarks), issue #41 (this DD), architecture doc §7, master plan §8.3/§9.2/§9.3

> **Accepted 2026-07-22. Decisions log (maintainer):**
> - **§4.2 Input/streaming:** accepted as recommended.
> - **§4.4 Worker instantiation:** bundler-native `new URL` default + consumer-supplied `Worker` escape
>   hatch, **plus package-consumer smoke coverage for the Vite/browser and Electron use cases** (§11, §15).
> - **§5.3 Progressive partials:** v1 deferral accepted — **not a permanent rejection**; E3/DD-004 must
>   explicitly evaluate time-to-first-preview against real renderer requirements and open the follow-up if
>   progressive IR delivery is needed.
> - **§7.2 Limits:** numeric defaults accepted **provisionally**, amended with a configurable **cumulative
>   allocation/working-buffer budget** (`maxBufferBytes`) with pre-allocation checks; `maxSegments` alone is
>   not a memory limit. Limit-exceeded delivery reconciled with §6 (terminal `done`, `complete:false`,
>   `stats.stopReason`).
> - **§9 Interpreter migration:** port-with-golden-equivalence-gate accepted as recommended.
> - **§5.2 amendment:** the parse loop must take an **explicit bounded event-loop yield** so a queued
>   `cancel` can actually be processed; the <250 ms cancellation test verifies the **cooperative** path;
>   `terminate()` is last-resort only.

---

## 1. Problem
Parsing runs on the UI thread in the inherited engine. Measured on the founding baseline (RR-001 §5.5):
**~1.5 s @ 10 MB, ~14.4 s @ 100 MB, ~32.4 s @ 250 MB of synchronous work** — a frozen tab at real print-file
sizes — and **peak memory ~13× file size** (250 MB → ~3.27 GB RSS across 11.6 M command objects), which
exceeds default browser/Electron renderer memory caps. The Master Plan (§4.4) makes worker-first,
resource-aware parsing an architectural requirement, and Fluidd demonstrates the pattern in production
(worker + streaming reads + neutral model; RR-001 §5.4 — behavior spec only, GPL source not reused).

DD-001 solved the *representation* half (transferable SoA `ToolpathIR`). DD-003 decides the *execution*
half: how untrusted G-code is parsed off-thread, streamed, bounded, cancelled, and delivered.

## 2. Scope
- The **parse core**: a worker-safe, dependency-light G-code interpreter that writes `ToolpathIR`
  SoA buffers **directly** (no intermediate object graphs), in `@chestnutlabs/gcode-parser`.
- The **worker protocol**: versioned request/response messages — parse, progress, warning, done
  (with buffer transfer), error, cancel.
- **Input & streaming model**: accepted input forms and chunked line-drain parsing.
- **Resource limits** and bounded failure (partial IR with `complete:false`).
- **Cancellation** lifecycle.
- **Source-byte tracking** so `srcByte`/`sourceIndex` carry real values (the E5/DD-006 input; the #29
  adapter could only report `unavailable`).
- Test strategy: golden-fixture equivalence, parser-state correctness, adversarial corpus, benchmarks.

## 3. Non-goals
- Rendering and time-to-first-pixel (E3/DD-004). §5.3 defines the *hook* for progressive delivery only.
- Slicer/firmware **metadata** dialects — feature roles, objects, thumbnails (E4/DD-005). The core parses
  generic machine state (G0/G1/G2/G3, G20/G21, G90/G91/M82/M83, G92, tool changes) exactly as scoped to
  the parser by architecture doc §6.
- Container extraction (`.gcode.3mf`) — E4.
- Live-progress mapping semantics (E5/DD-006) — this DD only guarantees the byte-accurate `sourceIndex`.
- Replacing the inherited public facade — the facade keeps its current path until E3 wires the new
  pipeline in; equivalence is protected by the golden fixtures.

## 4. Data contracts / API

### 4.1 Public API (package `@chestnutlabs/gcode-parser`)
```ts
// Pure, worker-free core — fully testable in Node:
parseGcodeToIR(input: string | Uint8Array, opts?: ParseOptions): ParseResult;
createStreamingParser(opts?: ParseOptions): { write(chunk: Uint8Array): void; end(): ParseResult; stats(): ParseStats };

// Worker client — the supported production path:
class GcodeParseSession {
  constructor(opts?: SessionOptions); // SessionOptions.worker? lets a consumer supply its own Worker
  parse(input: ParseInput, opts?: ParseOptions): Promise<ParseResult>;
  cancel(): void;
  onProgress(cb: (p: ParseProgress) => void): () => void;
}

type ParseInput = string | Uint8Array | Blob /* File */ | ReadableStream<Uint8Array>;
type ParseResult = { ir: ToolpathIR; stats: ParseStats };
type ParseProgress = { bytesProcessed: number; totalBytes?: number; segments: number; phase: 'reading'|'parsing'|'finalizing' };
```
`ParseResult.ir` is the DD-001 `ToolpathIR`; on the worker path its typed buffers arrive **transferred**
(zero-copy), never structured-cloned.

### 4.2 Input & streaming model — DECIDED (as recommended)
The worker owns the read loop (Fluidd-validated shape): bytes → `TextDecoder{stream:true}` → rolling
line-drain buffer → parse complete lines → append to growable SoA buffers, tracking the **byte offset of
each command** for `srcByte`.

Accepted inputs and how they reach the worker:
| Input | Mechanism |
|---|---|
| `Blob`/`File` | post the Blob (cheap handle); worker streams it via `blob.stream()` — **preferred for large files** |
| `ReadableStream<Uint8Array>` | **transferred** to the worker (transferable streams); fallback: main thread pumps chunks |
| `Uint8Array` | transferred (zero-copy) |
| `string` | structured-cloned (small inputs/tests only; docs steer large inputs to Blob/stream) |

**Decided:** implement all four; document Blob/stream as the large-file path.

### 4.3 Worker protocol (versioned)
`PROTOCOL_VERSION = 1`, included in every message.
```
main -> worker:  {v, type:'parse', id, input, opts}   | {v, type:'cancel', id}
worker -> main:  {v, type:'progress', id, ...}        (throttled, ≥ ~100 ms apart)
                 {v, type:'warning',  id, warning}     (batched)
                 {v, type:'done',     id, ir, stats}   (buffers in transfer list)
                 {v, type:'error',    id, error: {code, message, srcByte?}}
                 {v, type:'cancelled',id, partial?: {ir, stats}}
```
Unknown `type`/version mismatch → structured `error`, never a silent hang. One parse per session at a time;
a second `parse` while active rejects (`E_BUSY`).

**Terminal-message contract (amended; reconciles with §6):** a parse ends in exactly one terminal message.
- `done` — carries `ir` + `stats` and is used **both** for complete parses **and** for limit-bounded
  parses: when a resource limit stopped the parse, `ir.header.complete === false`,
  `ir.header.truncatedAtByte` is set, and `stats.stopReason` carries the structured error
  (`{code: 'E_LIMIT_SEGMENTS' | 'E_LIMIT_INPUT_BYTES' | 'E_LIMIT_BUFFER_BYTES' | …, message, srcByte?}`).
  The client **resolves** `parse()` with this `ParseResult` — callers can render what was parsed and say so
  honestly. `stats.stopReason === undefined` ⇔ `ir.header.complete === true`.
- `error` — reserved for failures that produce **no usable IR** (input read failure, protocol/version
  mismatch, worker crash, internal fault). The client **rejects** `parse()` with the structured error.
- `cancelled` — the client rejects with `E_CANCELLED`; `partial` (bounded IR, `complete:false`) is attached
  when `opts.partialOnCancel` is set.

### 4.4 Worker instantiation & distribution — DECIDED (a + c, with consumer smoke coverage)
| Option | Pros | Cons |
|---|---|---|
| **(a) `new Worker(new URL('./worker.js', import.meta.url), {type:'module'})`** *(recommended default)* | standard; Vite/webpack/Rollup bundle the worker for consumers automatically | requires a bundler or native ESM workers |
| (b) Inline worker from a bundled Blob URL | works without bundler config | inflates bundle; blocked by strict CSP (`worker-src blob:`) |
| (c) Consumer-supplied `Worker`/URL (`SessionOptions.worker`) | escape hatch for exotic CSP/Electron setups | consumer must wire the file |
**Decided:** (a) as the default, (c) always available; document CSP notes; not (b) as default.
**Amendment:** package-consumer **smoke coverage is required for the Vite/browser and Electron use cases**
(§11) — the packed artifact must instantiate its worker and complete a parse in both environments before
the E2 exit.

## 5. Lifecycle

### 5.1 Session lifecycle
`idle → parsing → (done | error | cancelled) → idle`. `dispose()` terminates the worker. Worker crash
(`onerror`) rejects the active parse with `E_WORKER_CRASHED`; the session recreates the worker lazily on
next use. All failure paths release buffers.

### 5.2 Cancellation (first-class) — amended
`cancel()` posts `{type:'cancel'}`. **A flag check alone is insufficient**: a `message` event cannot be
delivered while the worker is inside a synchronous parse loop, so the flag would never be set. Therefore
the parse loop must take an **explicit bounded event-loop yield**:

- The loop processes at most **`yieldIntervalMs` (default 50 ms) of CPU work** between yields, then awaits a
  **macrotask** yield (a `MessageChannel`-based yield, not `setTimeout(0)`, which browsers clamp) so queued
  `cancel` messages are actually dispatched before parsing resumes. Streaming inputs additionally yield
  naturally at each `read()`; the explicit yield guarantees the bound even for fully in-memory
  `string`/`Uint8Array` inputs.
- After each yield the loop checks the cancel flag; response is `cancelled` (with the partial IR,
  `complete:false`, when `opts.partialOnCancel` is set).
- **The §8 <250 ms cancellation test must verify the cooperative path** — cancel acknowledged via
  `cancelled` on a large synchronous input **without** worker termination.
- If the worker still fails to acknowledge within 2 s (pathological/buggy input handling), the client
  **terminates** the worker — strictly a last-resort backstop, never the mechanism (master plan §9.3).

### 5.3 Progressive partial results — DECIDED (v1 deferral; not a permanent rejection)
v1 ships **progress events + single final transfer** (Fluidd-proven; simplest correct thing). The protocol
reserves `{type:'partial'}` for batched incremental IR delivery — batching forces copies (transferred
buffers detach) and complicates layer bookkeeping, and no renderer exists yet to consume it.

**Amended obligation on E3:** this deferral is **not a permanent rejection** of progressive preview.
**DD-004 must explicitly evaluate time-to-first-preview against the real renderer requirements** (using the
E2 benchmark data for full-parse latency) and, if progressive IR delivery is needed to meet them, open the
follow-up implementation issue against the reserved `partial` protocol slot.

## 6. Errors & failure behavior
- Malformed lines are **never fatal**: unparseable content becomes a batched `Warning` (`code`, `srcByte`,
  aggregated `count`) and parsing continues — matching master plan §9.1 (preserve as warnings, don't invent
  meaning).
- **Limit-exceeded is a bounded result, not a failure** (amended; see the §4.3 terminal-message contract):
  the parse ends with a single terminal `done` whose `ir.header.complete === false`,
  `ir.header.truncatedAtByte` set, and `stats.stopReason` carrying the structured error — the `parse()`
  promise **resolves** so callers can render what was parsed and say so honestly. This includes allocation
  failures mapped to `E_LIMIT_BUFFER_BYTES` (§7.2).
- True failures — input read failure, protocol/version mismatch, worker crash, internal fault — produce no
  usable IR: terminal `error`, promise **rejects**. Cancel: terminal `cancelled`, promise rejects with
  `E_CANCELLED` (optional partial attached per §5.2).
- All errors are structured `{code, message, srcByte?}`; codes are part of the public API and tested.

## 7. Security & resource limits

### 7.1 Posture
Input is untrusted text. No `eval`/`Function`, no network requests from the worker, no DOM. Nothing in the
input can trigger I/O; the worker only reads the provided bytes and emits messages (architecture §7).

### 7.2 Default limits — DECIDED (provisional numerics; amended with an allocation budget)
| Limit | Default | Grounding |
|---|---|---|
| `maxInputBytes` | 512 MB | 2× the 250 MB benchmark tier; larger opts in explicitly |
| `maxSegments` | 20 M | 250 MB ≈ 11.6 M segments (RR-001); a structural sanity cap — **not a memory limit** (see below) |
| **`maxBufferBytes`** *(amendment)* | **1.5 GiB** | cumulative working-buffer budget; aligns with the §8 peak-memory target |
| `maxLineLength` | 64 KB | no legitimate G-code line approaches this; caps drain-buffer abuse |
| `maxWarnings` retained | 10 k (then count-only) | bounds memory on garbage input |
| `maxParseMillis` | none (cancellation is the mechanism) | a wall-clock default would kill slow-but-legitimate machines |

**Cumulative allocation budget (`maxBufferBytes`, amended in acceptance):** `maxSegments` alone is not a
reliable memory limit — per-segment cost varies with optional channels, and growth/compaction transiently
holds two copies of a channel. The parser therefore maintains a byte-accurate account of **all live working
allocations**: every SoA channel's current capacity, optional channels when enabled, the line-drain buffer,
warning storage, and — **checked before the allocation is made** — any projected growth step or final
compaction copy (during which old + new capacity coexist). If a projected allocation would exceed
`maxBufferBytes`, the allocation is **not performed**; the parse stops at the current command boundary and
delivers the bounded partial result per the §4.3 terminal-message contract (`done`, `complete:false`,
`stats.stopReason = {code:'E_LIMIT_BUFFER_BYTES', …}`). An engine-level allocation failure (e.g.
`RangeError` from the platform) is caught at the same boundary and mapped to the same structured result —
an out-of-budget input must never surface as an unhandled exception or a dead worker.

~~All defaults are numerically **provisional**: revisited against the E2 benchmark results (§8/§14 phase 4)
before the E2 exit, with changes recorded in this DD.~~ **Revisited 2026-07-22 (phase 4, #47): defaults
CONFIRMED as shipped.** The 250 MB tier's natural peak RSS measured 1532 MB — within 0.3 % of
`maxBufferBytes` (1536 MiB), i.e. the budget is calibrated at the working set of the largest supported
tier; materially larger inputs stop with a bounded `E_LIMIT_BUFFER_BYTES` partial by design. Evidence:
[`tools/benchmark/results/e2-worker-benchmark-2026-07-22.md`](../../tools/benchmark/results/e2-worker-benchmark-2026-07-22.md).

### 7.3 Growable buffers
SoA channels grow by doubling (amortized O(n)) with a final right-size compaction before transfer, so peak
worker memory ≈ 2× final IR size worst-case, still far under the baseline's 13× object-graph blowup.

## 8. Performance
Targets (become the E2 exit measurements, from the RR-001 §5.5 baseline; same 10/100/250 MB corpus + harness):
- **UI thread:** no parse-related main-thread task > 16 ms (the entire point).
- **Throughput:** ≥ 5 MB/s floor on the reference machine (baseline main-thread ≈ 7–8 MB/s; some
  worker/streaming overhead accepted, order-of-magnitude regressions not).
- **Memory:** peak worker RSS for the 250 MB tier **≤ 1.5 GB** (vs 3.27 GB baseline); final IR ≈
  segment-count × ~40 B core channels (~0.5 GB @ 11.6 M).
- **Transfer:** `done` delivery < 100 ms (zero-copy transfer list).
- **Cancellation latency:** < 250 ms from `cancel()` to `cancelled` on any input — **measured on the
  cooperative path** (§5.2): the yield-loop must deliver this without `terminate()`.
- **Allocation budget:** the §7.2 `maxBufferBytes` accounting is the enforcement mechanism for the peak-
  memory target above; the benchmark records accounted peak vs. actual RSS to validate the accounting.
Per governance §10.2, benchmark results are recorded as trend artifacts; deviations documented and accepted
explicitly, not silently.

**Measured (phase 4, #47, 2026-07-22) — ALL TARGETS MET** (full report:
[`tools/benchmark/results/e2-worker-benchmark-2026-07-22.md`](../../tools/benchmark/results/e2-worker-benchmark-2026-07-22.md)):
max main-thread stall **3 ms** @ 250 MB (baseline: a 32.4 s freeze); throughput 7.0–9.1 MB/s; peak RSS
**1532 MB** @ 250 MB (baseline 3272 MB); pure IR transfer **2 ms** for a 7.7 M-segment IR (zero-copy
proven); cooperative cancel **83 ms** across a real thread boundary with `terminate()` unused.

## 9. Migration — DECIDED (port the inherited interpreter, golden-equivalence gated)
The inherited `Interpreter` (main-thread, three-coupled `Job`/`Path` output) is **ported, not imported**:
`@chestnutlabs/gcode-parser` re-implements the same machine-state semantics (motion modes, abs/rel XYZ+E,
units, G92 resets, arc flattening, tool changes) writing SoA `ToolpathIR` directly, depending only on
`toolpath-core` (DD-002 boundary: parser must not import three).
- **Provenance:** adapted from the inherited MIT source — recorded in `docs/UPSTREAM_PROVENANCE.md`
  (status: *inherited semantics, re-implemented for the worker pipeline*), per policy §6.
- **Equivalence:** the #28 golden fixtures gate the port — position/kind/tool/layer channels must match the
  adapter-produced goldens (arc flattening tolerance defined in the test, exact where math is identical);
  `e`/`feedrate`/`srcByte` upgrade from `unavailable` to `known` (a *documented capability improvement*,
  asserted in new goldens).
- The inherited main-thread path stays untouched until E3 wires the facade to the new pipeline.
**Decided:** port-with-equivalence-gate as described.

## 10. Observability / diagnostics
`ParseStats`: bytes, lines, commands, segments, warnings by code, per-phase timings, peak buffer bytes,
throughput. No local paths or user identifiers in stats or warnings (redaction rule, master plan §9.3).

## 11. Testing
- **Parse-core unit tests (Node, no Worker):** motion-mode state matrix (G90/G91 × M82/M83), units, G92,
  arc flattening (G2/G3, IJ/R, full circles), tool changes, `srcByte` accuracy (`segmentAtByte` returns the
  producing command's offset).
- **Golden equivalence (#28 suite):** native parser vs committed goldens per §9.
- **Adversarial corpus (manifest `sizeTier: adversarial`):** binary garbage, 64 KB+ lines, extreme
  coordinates, deep negative/NaN params, truncated files, zero-byte input — all must yield bounded
  warnings/partial IR, never a hang or crash.
- **Worker protocol tests:** happy path, **cooperative cancel mid-parse on a large synchronous input
  (asserting no `terminate()` was needed — §5.2 amendment)**, limit-exceeded partial delivery
  (`done` + `complete:false` + `stats.stopReason` — §4.3), **allocation-budget exhaustion mapped to
  `E_LIMIT_BUFFER_BYTES` with a bounded partial (never an unhandled exception)**, double-parse rejection,
  version mismatch, crash recovery. Run against the worker glue via `node:worker_threads`-based shim or
  browser-mode vitest — the glue is thin because the core is pure.
- **Package-consumer smoke coverage (§4.4 amendment):** the packed `@chestnutlabs/gcode-parser` artifact is
  consumed by (a) a minimal **Vite browser** app and (b) a minimal **Electron renderer** — each must
  instantiate the default worker path and complete a parse. Run as part of the E2 exit evidence (release
  automation for these lives with E7).
- **Benchmarks:** extend `tools/benchmark` to drive the new pipeline on the same corpus; record vs §8
  (including cooperative-cancel latency and accounted-vs-actual peak memory).

## 12. Alternatives considered
- **Keep main-thread parsing + cooperative yielding + LOD** (the Sindarius/Mainsail approach, RR-001 §5.4):
  rejected as the primary architecture — it caps file size by memory anyway (their data stays
  render-coupled) and contradicts the founding worker-first constraint; their LOD ideas move to E3.
- **WASM parser core:** premature — no evidence JS SoA writing is the bottleneck (baseline ≈ 7–8 MB/s is
  I/O-and-allocation dominated). Re-evaluate after E2 measurements; would slot behind the same protocol.
- **SharedArrayBuffer + Atomics:** requires cross-origin isolation (COOP/COEP) many consumers can't set;
  transferable buffers suffice for a produce-once model.
- **Reuse inherited Interpreter in the worker as-is:** rejected — it drags `three` into the parser package
  (DD-002 violation) and rebuilds the object-graph memory problem the IR exists to solve.

## 13. Risks
| Risk | Mitigation |
|---|---|
| Port diverges from inherited semantics | golden-equivalence gate (#28) + state-matrix tests before wiring |
| Worker bundling friction for consumers | §4.4 default + consumer-supplied worker escape hatch + docs |
| Transferable-stream support gaps (Safari history) | Blob path is primary for files; chunk-pump fallback for streams |
| Progress chatter floods the main thread | throttled (≥100 ms) progress; batched warnings |
| Limits too tight/loose in the wild | all configurable; defaults revisited with E2 benchmark evidence |

## 14. Phased delivery (implementation issues open only after acceptance)
1. **Parse core** in `@chestnutlabs/gcode-parser` (pure; SoA writer; `srcByte`) + state-matrix tests +
   golden equivalence.
2. **Worker glue + protocol v1** (parse/progress/done/error/cancel) + protocol tests.
3. **Streaming inputs** (Blob/stream line-drain) + adversarial corpus + limits.
4. **Benchmarks** vs §8 targets on the 10/100/250 MB corpus; record results in the Epic.
5. Facade wiring deferred to E3 coordination.

## 15. Acceptance criteria (amended at acceptance)
- Protocol, input model, limits, cancellation, and error codes defined as above and tested.
- Parse core produces DD-001-conformant IR with **real** `srcByte`/`sourceIndex`; golden equivalence holds.
- **Cancellation is provably cooperative:** the parse loop takes the §5.2 bounded event-loop yield, and the
  <250 ms cancellation test passes **without** worker termination.
- **The cumulative allocation budget (`maxBufferBytes`) is enforced with pre-allocation checks** covering
  live channels, growth capacity, optional channels, and compaction copies; budget/allocation failure
  yields the structured bounded result (`done`, `complete:false`, `stats.stopReason`) — never an unhandled
  exception or dead worker.
- **Limit-exceeded delivery follows the §4.3 terminal-message contract** (resolve with partial + stopReason;
  `error`/reject reserved for no-usable-IR failures).
- **Vite/browser and Electron consumer smoke coverage passes** against the packed artifact (§11).
- §8 targets met on the reference corpus, or deviations documented and explicitly accepted; numeric limit
  defaults revisited against the phase-4 benchmarks.
- No UI-thread parse loop for supported production flows; `gcode-parser` imports only `toolpath-core`
  (boundary lint extended to the new package).
- E3/DD-004 carries the explicit obligation to evaluate time-to-first-preview and revisit progressive
  partial delivery (§5.3).
