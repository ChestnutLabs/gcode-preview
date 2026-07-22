# DD-003 — Worker Parsing, Streaming, Transfer, and Resource Limits

**Status:** Proposed <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Chestnut Labs
**Date:** 2026-07-22 · **Last revised:** 2026-07-22
**Owning Epic:** E2 (#3) · **Milestone:** M2
**Supersedes / Superseded by:** none
**Related:** DD-001 (Accepted), DD-002 (Accepted), RR-001 (Accepted; §5.4 reference behavior, §5.5 baseline
benchmarks), issue #41 (this DD), architecture doc §7, master plan §8.3/§9.2/§9.3

> **Proposed draft for maintainer review.** No parser/worker implementation until Accepted. Decisions
> flagged **[DECISION]**: §4.4 worker instantiation/distribution, §4.2 input & streaming model,
> §5.3 progressive partial results, §7.2 default resource limits, §9 inherited-interpreter port strategy.

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

### 4.2 [DECISION] Input & streaming model
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

**Recommendation:** implement all four; document Blob/stream as the large-file path. *Sign-off requested.*

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

### 4.4 [DECISION] Worker instantiation & distribution
| Option | Pros | Cons |
|---|---|---|
| **(a) `new Worker(new URL('./worker.js', import.meta.url), {type:'module'})`** *(recommended default)* | standard; Vite/webpack/Rollup bundle the worker for consumers automatically | requires a bundler or native ESM workers |
| (b) Inline worker from a bundled Blob URL | works without bundler config | inflates bundle; blocked by strict CSP (`worker-src blob:`) |
| (c) Consumer-supplied `Worker`/URL (`SessionOptions.worker`) | escape hatch for exotic CSP/Electron setups | consumer must wire the file |
**Recommendation:** (a) as the default, (c) always available; document CSP notes. Not (b) as default.
*Sign-off requested.*

## 5. Lifecycle

### 5.1 Session lifecycle
`idle → parsing → (done | error | cancelled) → idle`. `dispose()` terminates the worker. Worker crash
(`onerror`) rejects the active parse with `E_WORKER_CRASHED`; the session recreates the worker lazily on
next use. All failure paths release buffers.

### 5.2 Cancellation (first-class)
`cancel()` posts `{type:'cancel'}`; the parse loop checks between chunks (bounded chunk size ⇒ bounded
latency, target §8). Response is `cancelled` (optionally with the partial IR, `complete:false`). If the
worker doesn't acknowledge within 2 s (pathological input), the client **terminates** the worker —
cancellation must never depend on cooperative code alone (master plan §9.3).

### 5.3 [DECISION] Progressive partial results
v1 ships **progress events + single final transfer** (Fluidd-proven; simplest correct thing). The protocol
reserves `{type:'partial'}` for batched incremental IR delivery, but implementing it is **deferred until
E3/DD-004 states a concrete time-to-first-preview need** — batching forces copies (transferred buffers
detach) and complicates layer bookkeeping, and no renderer exists yet to consume it.
**Recommendation:** defer `partial` to an E3-driven follow-up; keep the protocol slot. *Sign-off requested.*

## 6. Errors & failure behavior
- Malformed lines are **never fatal**: unparseable content becomes a batched `Warning` (`code`, `srcByte`,
  aggregated `count`) and parsing continues — matching master plan §9.1 (preserve as warnings, don't invent
  meaning).
- Fatal errors are only: limit exceeded (§7), input read failure, worker crash, cancel. Limit-exceeded
  returns the **bounded partial IR** (`complete:false`, `truncatedAtByte`) plus an `error` — callers can
  render what was parsed and say so honestly.
- All errors are structured `{code, message, srcByte?}`; codes are part of the public API and tested.

## 7. Security & resource limits

### 7.1 Posture
Input is untrusted text. No `eval`/`Function`, no network requests from the worker, no DOM. Nothing in the
input can trigger I/O; the worker only reads the provided bytes and emits messages (architecture §7).

### 7.2 [DECISION] Default limits (all configurable; safe by default)
| Limit | Default | Grounding |
|---|---|---|
| `maxInputBytes` | 512 MB | 2× the 250 MB benchmark tier; larger opts in explicitly |
| `maxSegments` | 20 M | 250 MB ≈ 11.6 M segments (RR-001); 20 M × ~40 B/seg ≈ 800 MB SoA — near the practical browser ceiling |
| `maxLineLength` | 64 KB | no legitimate G-code line approaches this; caps drain-buffer abuse |
| `maxWarnings` retained | 10 k (then count-only) | bounds memory on garbage input |
| `maxParseMillis` | none (cancellation is the mechanism) | a wall-clock default would kill slow-but-legitimate machines |
**Recommendation:** these defaults. *Sign-off requested.*

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
- **Cancellation latency:** < 250 ms from `cancel()` to `cancelled` on any input.
Per governance §10.2, benchmark results are recorded as trend artifacts; deviations documented and accepted
explicitly, not silently.

## 9. [DECISION] Migration — porting the inherited interpreter
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
**Recommendation:** port-with-equivalence-gate as described. *Sign-off requested.*

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
- **Worker protocol tests:** happy path, cancel mid-parse, limit-exceeded partial delivery, double-parse
  rejection, version mismatch, crash recovery. Run against the worker glue via `node:worker_threads`-based
  shim or browser-mode vitest — the glue is thin because the core is pure.
- **Benchmarks:** extend `tools/benchmark` to drive the new pipeline on the same corpus; record vs §8.

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

## 15. Acceptance criteria
- Protocol, input model, limits, cancellation, and error codes defined as above and tested.
- Parse core produces DD-001-conformant IR with **real** `srcByte`/`sourceIndex`; golden equivalence holds.
- §8 targets met on the reference corpus, or deviations documented and explicitly accepted.
- No UI-thread parse loop for supported production flows; `gcode-parser` imports only `toolpath-core`
  (boundary lint extended to the new package).
- All **[DECISION]** items resolved and recorded.
