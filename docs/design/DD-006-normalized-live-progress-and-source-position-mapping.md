# DD-006 — Normalized Live Progress and Source-Position Mapping

**Status:** **Proposed** <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Chestnut Labs
**Date:** 2026-07-23 · **Last revised:** 2026-07-23
**Owning Epic:** E5 (#6) · **Milestone:** M4
**Supersedes / Superseded by:** none
**Related:** DD-001 (capability vocabulary reused for mapping confidence), DD-003 (worker protocol —
deliberately **unchanged** by this DD), DD-004 §4.5 (draw-range scrub machinery the overlay reuses),
DD-005 §4.2 (`ParseResult.metadata` precedent for side-band data), E5 epic (#6), issue #87 (this DD),
AnyBridge #783 (ownership boundary: AnyBridge owns telemetry normalization), master plan §18 (the
fallback-hierarchy decision this DD closes with real telemetry evidence)

---

## 1. Problem

Consumers need to show **where the printer currently is** on a parsed toolpath — the master plan's
"follow the current print position" workflow — without printer-protocol code entering the viewer.
The hard part is honesty: telemetry surfaces differ wildly in precision, and a viewer that draws a
confident nozzle marker from a coarse percent is lying. The epic's exit criterion is explicit:
*exact vs. approximate must be clearly distinguished, and degradation must be honest* (unknown /
disabled overlay — never fake precision).

The IR was built for this: every segment carries `srcByte` (byte offset of the producing command),
and `ir.sourceIndex` is a sorted `byteOffset → segmentIndex` binary-search table (capability
`known`, shipped in E1/E2 expressly as "E5/DD-006 input"). What is missing is the **contract** (what
an observation looks like), the **mapping logic** (observation → segment index + confidence), the
**degradation rules** (stale / disconnected / mismatched), and the **renderer overlay**.

### 1.1 Real telemetry evidence (gate requirement)

The epic gates DD-006 on *real AnyBridge telemetry evidence*, because the fallback hierarchy must be
decided against what printers actually report, not what we wish they reported. Surveyed 2026-07-23
from `ChestnutLabs/AnyBridge` (`src/anybridge/model/telemetry.py`, `southbound/dialects/*`,
`northbound/moonraker/objects.py`):

| Surface | Fields relevant to position | Precision class |
|---|---|---|
| AnyBridge normalized `JobProgress` (the contract consumers see) | `progress: float 0..1 \| None`, `current_layer`, `total_layers`, `elapsed_s`, `remaining_s`, `skip_parts`, `objects` | percent + layer — **no byte position** |
| Bambu dialect (`bambu/profile.py`, MQTT `push_status`) | `mc_percent` → `progress`; `layer_num`/`total_layer_num` → layers | percent (job-based) + layer |
| Anycubic families (`avata_main`, `gkapi` via `common.py` print report) | `progress` (0–100) → `progress`; `curr_layer`/`total_layers`; times in minutes | percent + layer |
| Klipper dialect (`klipper/profile.py`, Moonraker client) | `virtual_sdcard.progress` (byte fraction of file) and `display_status.progress` → `progress`; `print_stats.info.current_layer`/`total_layer` (populated only when the file/macros emit `SET_PRINT_STATS_INFO`) → layers | percent (byte-based) + layer (conditional) |
| Moonraker upstream (not yet consumed by AnyBridge) | `virtual_sdcard.file_position` — **exact byte offset** into the printed file | byte-exact, *available but unplumbed* (AnyBridge's own Moonraker northbound emulation stubs `file_position: 0`) |

Conclusions this DD is built on:

1. **The common case today is percent + layer.** A design that only shines with byte positions would
   serve zero real AnyBridge printers at launch. Percent and layer tiers are first-class.
2. **Byte-exact is real and reachable** (Moonraker `file_position`; OctoPrint `progress.filepos` and
   Marlin `M27` byte counts on other ecosystems), so the top tier must exist in the v1 contract and
   mapper, and AnyBridge can adopt it additively (a nullable field on `JobProgress`).
3. **No surveyed surface reports a source line or command number.** Line/command tiers are contract
   placeholders, not v1 mapping work (§4.3, decision D3).
4. **"Percent" is not one thing**: Klipper's is a byte fraction of the file; Bambu's `mc_percent` is
   job progress (closer to time). The contract must carry the basis (§4.3, decision D4).

## 2. Scope

- A versioned, serializable **progress observation contract** (`ProgressObservation` v1) that any
  consumer can populate from its own telemetry — byte / line / layer / percent / state — plus the
  identity evidence (file name, size, hash) needed for mismatch detection.
- A pure **mapping engine** (`ProgressMapper`) from observations to
  `MappedProgress { segIndex, basis, confidence, band, … }` over an existing `ToolpathIR`, on the
  main thread, no worker-protocol change.
- The **fallback hierarchy** and confidence states, decided against §1.1 evidence.
- **Stale / disconnected / mismatch behavior**: staleness clock, file-identity checks, regression
  handling, honest degradation to "unavailable".
- A **renderer progress overlay** in `gcode-renderer-three`: completed/remaining styling, position
  marker, uncertainty band, stale/unavailable presentation — reusing DD-004's draw-range machinery.
- **Contract fixtures**: pinned observation sequences (shaped like the real dialect streams in §1.1)
  with expected mapped outputs, consumable by AnyBridge tests without a cross-repo dependency.

## 3. Non-goals

- **No telemetry subscription or transport in the viewer** — no Moonraker/MQTT/OctoPrint/vendor API
  clients (AnyBridge #783 owns telemetry normalization). The viewer consumes observations pushed by
  its host.
- **No ETA/remaining-time estimation** — the viewer maps positions; time prediction stays with the
  host (AnyBridge's TIMING-NORMALIZATION already forbids file-progress-as-time-estimate).
- No safety/dispatch decisions; no job control.
- No Vue integration surface (E6/DD-007) and no changes to worker protocol v1 or the IR schema.

## 4. Data contracts / API

### 4.1 `ProgressObservation` v1 — PROPOSED

Lives in `@chestnutlabs/toolpath-core` (`progress.ts`), following the DD-005 §4.2 precedent that
cross-package data contracts live in core (decision D1). Serializable (structured-clone-safe), so a
host can produce it anywhere and hand it to the viewer.

```ts
/** One consumer-supplied snapshot of where the printer is. All position facts optional. */
export interface ProgressObservation {
  v: 1;
  /** Consumer clock (ms, monotonic or wall) — drives staleness. */
  timestampMs: number;
  /** Identity evidence for the file the printer is executing (mismatch detection §4.4). */
  file?: { name?: string; sizeBytes?: number; sha256?: string };
  position?: {
    /** Exact byte offset into the byte stream the parser consumed (§4.4.1 byte domain). */
    byte?: number;
    /** 0-based source line. Reserved: no surveyed surface emits it (D3). */
    line?: number;
    /** Current layer as reported (numbering caveats §4.3). */
    layer?: number;
    totalLayers?: number;
    /** Fraction 0..1. */
    percent?: number;
    /** What the percent measures — decides how it maps (D4). */
    percentBasis?: 'bytes' | 'job' | 'unknown';
  };
  state?: 'printing' | 'paused' | 'complete' | 'cancelled' | 'unknown';
}
```

### 4.2 `ProgressMapper` and `MappedProgress` — PROPOSED

```ts
export interface MappedProgress {
  /** Last segment at-or-before the observed position; null when unavailable. */
  segIndex: number | null;
  /** Which observation fact won (fallback hierarchy §4.3). */
  basis: 'byte' | 'line' | 'layer' | 'percent' | 'none';
  /** DD-001 capability vocabulary, reused (D2): byte→known, line/layer→inferred,
   *  percent→approximated, none→unavailable. */
  confidence: 'known' | 'inferred' | 'approximated' | 'unavailable';
  /** Uncertainty band [loSeg, hiSeg] inclusive — a point (lo===hi) for byte basis,
   *  the whole layer for layer basis, a widened window for percent. */
  band: [number, number] | null;
  layerIndex: number | null;
  /** True once now - timestampMs > staleAfterMs; presentation degrades (§4.4.3). */
  stale: boolean;
  /** Structured reasons when degraded below the best tier the observation offered. */
  notes: ProgressNote[]; // e.g. {code:'file-mismatch'|'layer-out-of-range'|'position-regressed'|...}
}

export function createProgressMapper(ir: ToolpathIR, opts?: {
  staleAfterMs?: number;           // default 10_000
  fileSizeBytes?: number;          // enables percent(bytes) → byte tier promotion
}): ProgressMapper;

interface ProgressMapper {
  observe(obs: ProgressObservation): MappedProgress;   // pure w.r.t. IR; keeps last-obs state
  /** Recompute staleness against `nowMs` without a new observation. */
  tick(nowMs: number): MappedProgress;
  reset(): void;
}
```

The mapper is **main-thread, allocation-light, O(log n)** per observation (binary searches over
`sourceIndex` / `layers`). No worker round-trip: the IR (including `sourceIndex`) is already
transferred to the consumer, so mapping happens where the observation arrives. Worker protocol v1
is untouched.

### 4.3 Fallback hierarchy and confidence — PROPOSED (closes master plan §18)

Highest-precision fact present in the observation wins; each tier's confidence is fixed:

| Tier | Mapping | Confidence | Band |
|---|---|---|---|
| 1. `byte` | `segmentAtByte(ir.sourceIndex, byte)` | `known` | point |
| 2. `line` | reserved in v1 — maps only if a future opt-in line index exists (D3); otherwise fall through with a note | `inferred` | point-ish |
| 3. `layer` | clamp to `ir.layers`; `segIndex = layers[L].segEnd - 1` interpreted as "somewhere in layer L" | `inferred` | `[segStart, segEnd-1]` of the layer |
| 4. `percent` + `percentBasis:'bytes'` + known file size | promote: `byte = round(percent × sizeBytes)` → tier 1 machinery | `approximated` (promotion is arithmetic, the source is still a fraction) | ±0.5% of segments, clamped |
| 5. `percent` (job/unknown basis) | `segIndex = round(percent × (count-1))` — segment-ordinal interpolation | `approximated` | ± max(2% of segments, 1 layer) |
| 6. none usable | `segIndex = null`, `basis:'none'` | `unavailable` | null |

Cross-checks when multiple facts are present: the winning tier is validated against the others
(e.g. byte-mapped segment's layer vs. reported `layer`); disagreement beyond one layer adds a
`cross-check-disagrees` note and **widens the band to cover both**, but does not silently switch
tiers — precision claims stay evidence-backed.

Layer-numbering caveats (from §1.1 fleets): reported layers may be 1-based (Bambu counts from 1),
may include priming/skirt layers differently than `deriveLayers`, and `total_layers` may disagree
with `ir.layers.length`. Rules: if `totalLayers` is present and differs from `ir.layers.length` by
> 2, add `layer-count-mismatch`, treat the reported layer as a *fraction* (`layer/totalLayers`)
through tier 5 instead of trusting the index; else clamp into range (out-of-range adds a note).

### 4.4 Stale / disconnected / mismatch — PROPOSED

**4.4.1 Byte domain.** `position.byte` (and percent-of-bytes promotion) refers to **the byte stream
the parser consumed**. For plain `.gcode` that is the file itself. For `.gcode.3mf` it is the
*extracted plate payload* (what DD-005's container flow feeds the parser) — which matches what a
Klipper-style host executes only when the host also prints the extracted G-code. The identity
fields (`file.sizeBytes` vs. parsed byte length, name, hash) exist to catch domain confusion:
a size disagreement > 0.1% ⇒ `file-mismatch` note and **demote byte/percent-bytes tiers to
`approximated` fraction mapping** (tier 5). A hash disagreement (when both sides have one) ⇒
`unavailable` — a marker on the wrong file is worse than no marker.

**4.4.2 Regression.** Positions may legitimately move backward (pause/resume replays, `M600`,
firmware retraction of queued commands). A backward move ≤ 2 layers re-syncs silently; a larger
jump backward re-syncs but adds `position-regressed` (hosts may surface it); order is never
enforced by dropping observations.

**4.4.3 Staleness & disconnect.** `stale` flips at `staleAfterMs` (default 10 s) without a fresh
observation; the overlay keeps the last position but switches to the stale presentation (§4.5).
There is no "disconnected" signal in-contract — a host that knows it lost the printer simply stops
observing (→ stale) or calls `reset()` (→ overlay hidden). `state:'complete'` maps to the final
segment with `known` confidence regardless of position facts; `cancelled`/`unknown` keep the last
mapped position but add a note.

### 4.5 Renderer progress overlay — PROPOSED

`ToolpathRenderer` (DD-004) gains one input and one event; no shader work in v1:

```ts
renderer.setProgress(p: MappedProgress | null): void;  // null hides the overlay entirely
// event: 'progress-presentation-changed' { mode: 'exact'|'band'|'stale'|'hidden', reason? }
```

Presentation by confidence (the epic's "clearly distinguish exact from approximate"):

- **`known`** — completed portion renders normally, remaining portion renders as a ghost
  (translucent, desaturated), and a **position marker** sits at the mapped segment's endpoint.
  Implementation: the completed cut reuses the §4.5 draw-range scrub math verbatim
  (`upperBoundBySegment`); the ghost is a second draw of the same geometry with draw ranges
  mirrored (`cut → end`) and a shared translucent material — no geometry duplication, chunk
  buffers are reused with a second `LineSegments`/`Mesh` per chunk.
- **`inferred` / `approximated`** — no point marker (that would be false precision): the **band**
  `[loSeg, hiSeg]` renders as a highlighted region (band segments drawn with an emphasis material
  between the completed and ghost cuts); completed/ghost cuts sit at the band edges.
- **`stale`** — last presentation retained but marker/band switch to the stale style (gray,
  reduced opacity); event fires.
- **`unavailable`** — overlay fully hidden (not a marker at 0): event fires with the mapping notes
  so hosts can explain *why*.

Interaction with existing controls: `setScrubPosition` (user scrubbing) and `setProgress` are
independent inputs; user scrub, when active, **wins** the draw-range cut and the overlay drops to
marker/band-only (no completed/ghost restyle) until scrub is released — following mode is a
host-level toggle, not renderer policy. Layer-range clipping composes as today (intersection).

Budget: a `setProgress` update is the same O(chunks × log) draw-range walk as scrub (≤ 0.5 ms
budget, DD-004) plus marker/band updates; **no per-observation allocation** after warm-up.

## 5. Lifecycle

Host flow: parse (E2/E4 pipeline, unchanged) → `createProgressMapper(ir, {fileSizeBytes})` →
telemetry callback does `renderer.setProgress(mapper.observe(obs))` → a coarse timer (≥ 1 Hz is
plenty) calls `mapper.tick(now)` to catch staleness → on job end/file change, `mapper.reset()` +
`renderer.setProgress(null)`. Mapper and overlay are independently disposable; renderer disposal
rules from DD-004 are unchanged.

## 6. Errors & failure behavior

The mapper never throws on observation content: malformed/NaN/negative facts are ignored
field-by-field with notes, degrading down the hierarchy (worst case `unavailable`). `observe()`
throws only on programmer error (called after `reset()` is fine; called with a non-v1 `v` returns
`unavailable` with a `version-unsupported` note — forward-compatible per protocol-v1 philosophy).
The renderer treats an out-of-range `segIndex` defensively (clamp + note-less hide on nonsense),
so a mapper/renderer version skew cannot draw garbage.

## 7. Security & resource limits

Observations are inert data from the host (not from files), so no new parse-time attack surface.
Bounds anyway: notes capped (last 8), observation rate is host-controlled but `observe()` is O(log
n) with no allocation growth, and the overlay adds at most one ghost + one band draw per chunk
(bounded by existing chunk counts). No new limits regime needed; DD-003 §7 untouched.

## 8. Performance

- `observe()` p95 < 0.1 ms on the 10M-segment tier (binary searches + fixed-size result reuse).
- `setProgress()` ≤ existing scrub budget (0.5 ms) + one-time ghost-material/mesh warm-up per
  quality mode; measured in the E5 exit benchmark alongside a 10 Hz simulated-telemetry soak
  (no steady-state allocation, no frame regression vs. E3 baselines).
- Ghost pass GPU cost: same vertex count drawn twice worst-case. Acceptable for lines; for tubes
  the ghost defaults to **line rendering of the remaining portion** (cheap + visually distinct) —
  keeps the E3 tubes budgets intact.

## 9. Testing

- **Unit**: hierarchy selection, each tier's mapping math, cross-check widening, layer-numbering
  edge cases, identity mismatch demotions, regression/staleness state machine, v-skew handling.
- **Contract fixtures** (`test-data/fixtures/progress/`, manifest-tracked): pinned observation
  sequences shaped exactly like §1.1's real streams — a Bambu-style `mc_percent`+`layer_num` run,
  an Anycubic-style percent run, a Klipper byte-fraction run with and without
  `SET_PRINT_STATS_INFO` layers, plus a future-tier byte-exact run — each with expected
  `MappedProgress` outputs against corpus IR. JSON in, JSON expected: AnyBridge consumes the same
  fixtures without importing this repo's code (satisfies the epic's cross-repo evidence bullet).
- **Renderer**: presentation-mode transitions (exact→band→stale→hidden) as unit tests over draw
  state; visual-regression baselines for marker/band/ghost added to the E3 vr harness.
- **Demo**: simulated-telemetry playback (scrub-bar-driven fake observations at each tier) so the
  overlay is verifiable in-browser without a printer.

## 10. Migration

Everything is additive: new `progress.ts` exports in core, one renderer method + event, no IR
schema bump (header version unchanged — `sourceIndex` already exists), no protocol change, no new
package. Consumers that never call `setProgress` see zero behavior change.

## 11. Observability / diagnostics

`MappedProgress.notes` is the diagnostic channel (structured codes, host-loggable);
`progress-presentation-changed` mirrors DD-004/DD-005 event style (`qualityFallback`,
`machine-geometry-mismatch` precedents). The demo surfaces basis/confidence/notes as text.

## 12. Alternatives considered

- **Worker-side mapping** (observation → worker → mapped result): rejected — round-trip latency
  for a sub-0.1 ms lookup, and the IR is already on the consumer side.
- **New `@chestnutlabs/toolpath-progress` package**: rejected for v1 — the mapper is ~300 lines of
  pure IR math with zero deps; core already owns `sourceIndex`/`segmentAtByte` (D1 records this).
- **Marker-always, confidence as color**: rejected — a point marker at an approximated position
  *is* false precision regardless of color; band presentation is the honest form.
- **Enforcing monotonic observations**: rejected — real printers pause/replay; dropping regressed
  observations desyncs the overlay exactly when things get interesting.
- **Time-based tier** (elapsed/total time → position): rejected for v1 — requires trusting slicer
  time estimates (AnyBridge explicitly refuses file-progress↔time conversions); revisit only with
  evidence.

## 13. Risks

- **Percent semantics drift per vendor** (job vs. bytes vs. time-ish): mitigated by `percentBasis`
  + wide default bands; fixture-locked per real stream. Residual: a vendor lying about basis shows
  a mildly wrong band — never a false-exact marker.
- **Layer numbering off-by-N across slicers/firmwares**: mitigated by clamp + count-mismatch
  fraction fallback + fixtures; residual risk is a band one layer off, visible and honest.
- **Ghost pass on huge tubes scenes**: mitigated by lines-ghost default (§8); worst case the host
  disables the ghost (`known` still shows completed cut + marker).
- **Container byte-domain confusion** (§4.4.1): mitigated by identity demotion rules; fixture
  covers the size-mismatch path.

## 14. Phased delivery

1. **Contracts + mapper core** — `progress.ts` types, `createProgressMapper` with byte/layer/
   percent tiers, unit tests, fixture manifest skeleton (evidence artifacts start in phase 1, per
   the DD-005 amendment-5 precedent).
2. **Honesty machinery** — cross-checks, identity/regression/staleness, notes, layer-caveat rules;
   record the four real-stream contract fixtures.
3. **Renderer overlay** — `setProgress`, completed/ghost/band/marker presentation, event, vr
   baselines, demo simulated playback.
4. **Docs + consumer surface** — progress-signal contract reference (`docs/reference/`), consumer
   integration notes (AnyBridge-facing), compatibility notes in the matrix.
5. **E5 exit** — mapping/overlay benchmarks vs. §8, evidence review against AnyBridge streams,
   epic checklist, ratification.

## 15. Acceptance criteria

- [ ] Observation contract + mapper land in core; hierarchy behaves per §4.3 on all fixtures.
- [ ] All four real-stream contract fixtures pass, including degradation paths (mismatch, stale,
      count-mismatch, regression).
- [ ] Renderer distinguishes exact (marker) from approximate (band) presentations; stale and
      unavailable states verifiably honest; vr baselines added.
- [ ] No worker-protocol or IR schema change; no telemetry transport code in any package
      (lint-verifiable: no network imports).
- [ ] §8 budgets measured and met (or deviations flagged for ratification).
- [ ] Docs published (contract reference + consumer notes).

## Decision log

- **2026-07-23 — Proposed.** Open maintainer decisions:
  - **D1** Contract + mapper home: `toolpath-core` (proposed) vs. a new `toolpath-progress`
    package.
  - **D2** Confidence vocabulary: reuse DD-001 `known|inferred|approximated|unavailable`
    (proposed) vs. epic-worded `exact|derived|approximate`.
  - **D3** Line/command tiers: contract fields reserved now, mapping deferred until a real surface
    emits them (proposed — §1.1 found none; an opt-in parser line-index table is the future path,
    ~4 B/line when enabled) vs. implementing a line index in v1.
  - **D4** Percent interpretation: explicit `percentBasis` hint with bytes-promotion when file
    size is known, ordinal interpolation otherwise (proposed) vs. a single fixed interpretation.
  - **D5** Overlay v1 form: draw-range completed cut + ghost remaining + marker/band, lines-ghost
    for tubes, user-scrub-wins composition (proposed) vs. marker-only v1.
