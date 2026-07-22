# DD-001 — ToolpathIR and Capability Model

**Status:** **Accepted (2026-07-22)** <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Chestnut Labs
**Date:** 2026-07-22 · **Last revised:** 2026-07-22
**Owning Epic:** E1 (#2) · **Milestone:** M1
**Supersedes / Superseded by:** none
**Related:** RR-001 (#18, accepted), DD-002 (#27), issues #26 (this DD), #28 (golden fixtures), #29 (migration),
architecture doc §5, master plan §8.2

> **Accepted 2026-07-22.** Implementation of `ToolpathIR` may proceed (as an internal `toolpath-core` module,
> then extracted per DD-002 §7). **Decisions log:**
> - **§4.6 Coordinate precision → floating origin:** `Float32` positions relative to a `Float64` `originOffset`.
> - **§4.2/§12 Memory layout → SoA typed buffers**, with the proposed core/optional channel split accepted.

---

## 1. Problem
The project needs a **versioned, neutral intermediate representation** that the parser writes and every
renderer/analyzer reads, so inherited implementation can be replaced without breaking consumers (master plan
§4.8, §17). Two forces from **RR-001** make the *shape* of that IR decisive:

1. **Memory (§5.5):** the inherited render-coupled object model reaches **~3.27 GB RSS for a 250 MB file
   (11.6 M command objects, 6.9 M points)** and would OOM in a browser/Electron renderer at default caps.
2. **Threading (§5.5):** parsing is a **14–32 s main-thread freeze** at 100–250 MB, so the IR must be cheap to
   **transfer** across the worker boundary (E2/DD-003) — i.e., backed by `ArrayBuffer`s, not object graphs.

Reference evidence (RR-001 §5.4): Fluidd proves a renderer-agnostic `moves/layers/parts/tools/bounds` model
fed from a worker is viable; live progress is keyed off a **byte offset** resolved to a move index.

## 2. Scope
- The **in-memory `ToolpathIR` contract**: types, semantics, and invariants.
- The **capability / warning / confidence model** (known / inferred / approximated / unavailable).
- The **source-position index** (byte/line/command → segment) required for scrubbing (E3) and live progress (E5).
- The **IR schema version** marker and its change policy.
- The neutral package that owns these types: `@chestnutlabs/toolpath-core` (boundary owned by DD-002).

## 3. Non-goals
- The parser/worker protocol, streaming, chunking (E2 / DD-003).
- Renderer geometry, GPU buffers, clipping (E3 / DD-004).
- Dialect/container adapters (E4 / DD-005) — DD-001 only defines the *slots* their metadata fills.
- Live-progress mapping semantics (E5 / DD-006) — DD-001 only defines the *index* it consumes.
- A **serialized/persisted** IR format (deferred; §11). DD-001 defines only the in-memory contract + a schema
  version so a future persistence DD can version it.

## 4. Data contract

`ToolpathIR` is a plain, transferable value: a small header of scalars/metadata plus **typed-array buffers**
(structure-of-arrays). It must be constructible in a worker and returned to the main thread by transferring
its backing `ArrayBuffer`s (zero-copy). No class instances, DOM, `three`, or consumer types appear in the
canonical IR.

### 4.1 Document & provenance (header)
- `irSchemaVersion: number` — bumped on any breaking layout/semantic change (separate from package version).
- `source`: `{ id?: string; byteLength: number; sha256?: string }` — identity/hash of the parsed input.
- `parserVersion: string`, `generatedAtTag?: string`.
- `dialect`: `{ id: string; version?: string; confidence: Confidence }[]` — what was detected/decided.
- `units: 'mm' | 'in'` + `unitsSource: Capability`.
- `coordinateSummary`: absolute/relative XYZ & E mode transitions observed (counts), `originOffset: Vec3`.
- `warnings: Warning[]` (see §5).

### 4.2 Segments (the hot path — typed SoA)
Ordered motion segments, one entry per emitted move, stored as parallel typed arrays of length `N`:

| Buffer | Type | Meaning |
|---|---|---|
| `x0,y0,z0 / x1,y1,z1` | `Float32Array` (see [DECISION] §4.6) | segment start/end in model space (relative to `originOffset`) |
| `e` | `Float32Array` | extrusion delta (or absolute→delta normalized) |
| `feedrate` | `Float32Array` | mm/min (NaN where unknown) |
| `kind` | `Uint8Array` | bitflags: `EXTRUDE | TRAVEL | RETRACT | UNRETRACT | WIPE | ARC_SEGMENT | SEAM` |
| `tool` | `Uint16Array` | index into `tools` palette |
| `layer` | `Uint32Array` | index into `layers` |
| `feature` | `Uint8Array` | index into `featureRoles` enum (0 = unknown) |
| `object` | `Uint32Array` | index into `objects` (+1; 0 = none/unknown) |
| `srcByte` | `Uint32Array` | byte offset in source of the command that produced this segment |

Arcs (G2/G3) are **pre-flattened** into `ARC_SEGMENT`-flagged line segments at parse time (matching the
inherited behavior), with the arc's source command recorded via `srcByte` so scrubbing maps back to one line.
Optional per-segment channels (`width`, `height`, `fanPercent`, `tempTool`, `tempBed`) are **present only when
declared/inferred**, each with a companion capability (§4.5) — absent buffers mean "unavailable", never 0.

### 4.3 Layers, tools, objects, features
- `layers`: `{ z: Float32Array; segStart: Uint32Array; segEnd: Uint32Array }` — Z and segment index range per
  layer. Layer detection quality carried as a capability.
- `tools`: `{ id: number; color?: RGBA; material?: string }[]` — small palette; segments reference by index.
- `objects`: `{ id: string; name?: string }[]` when object/exclude metadata exists (E4).
- `featureRoles`: enum table (`perimeter, external-perimeter, infill, solid-infill, support, skirt, brim,
  bridge, travel, custom, unknown`), extensible; `feature` buffer indexes it.

### 4.4 Bounds & source index
- `bounds`: `{ min: Vec3; max: Vec3 }` (over extruding moves; travel-inclusive bounds also provided).
- `sourceIndex`: a **sorted `Uint32Array` of `srcByte`** (parallel to a `Uint32Array` of segment indices)
  enabling `byteOffset → segmentIndex` via binary search. This is the contract E5/DD-006 consumes for
  live-progress (RR-001 §5.4: byte-offset is the field both Fluidd and Mainsail key on). Line/command indexes
  are derivable and provided as optional companion arrays.

### 4.5 Capability model
```ts
type Confidence = 'known' | 'inferred' | 'approximated' | 'unavailable';
```
Every optional/derived datum has an associated `Confidence`. A `capabilities` map summarizes per field
(`units`, `layers`, `featureRoles`, `objects`, `width`, `height`, `temps`, `flow`, `arcs`, `thumbnails`,
`estimatedTime`, …). **Rules (architecture §5):** *unknown is a valid state and must never be represented as a
fabricated 0/default*; *inferred/approximate values are distinguishable from declared values*; consumers must be
able to tell users when data is approximated or missing (master plan §9.5).

### 4.6 Coordinate precision — DECIDED (floating origin)
`Float32` positions (relative to `originOffset`) keep the IR compact and GPU-friendly, but lose precision on
large absolute coordinates (belt printers, big beds). **Decided (2026-07-22): floating origin** — store one
`Float64` `originOffset` in the header and each position as a `Float32` delta relative to it, giving ~sub-µm
precision within any realistic build volume while staying transfer/GPU friendly. Renderer-side precision
handling is DD-004's concern. (*Rejected alternative:* full `Float64` positions — 2× memory, no GPU benefit.)

## 5. Errors & failure behavior
The IR never throws for missing/odd data — it **degrades honestly** via capabilities + `warnings`:
```ts
type Warning = { code: string; message: string; srcByte?: number; severity: 'info'|'warn'|'error'; count?: number };
```
Unsupported commands are preserved as warnings/metadata rather than silently asserting false meaning (master
plan §9.1). Hard failures (truncated input, limit exceeded) are the parser's concern (DD-003) and surface as a
structured result, not a partial IR masquerading as complete (a `complete: boolean` + `truncatedAtByte?` header
field records partial parses).

## 6. Security & resource limits
- The IR contains **no executable content and initiates no I/O**; it is inert data.
- No local file paths, user names, or network identifiers enter the IR unless a field is explicitly opt-in;
  provenance strings are redacted by default (master plan §9.3).
- Entry/segment counts are bounded by the parser's limits (DD-003); the IR simply carries whatever the parser
  produced within those limits.

## 7. Performance
Budgets are set against the **RR-001 baseline** (object model: 250 MB → ~3.27 GB RSS, 11.6 M objects):
- **Design intent:** IR memory is proportional to **segment count × bytes-per-channel**, not JS object count.
  A back-of-envelope for the 250 MB tier (~11.6 M segments): the core channels (3×2 `Float32` positions + `e` +
  `feedrate` + `kind` + `tool` + `layer` + `srcByte`) ≈ ~40 bytes/segment ≈ **~0.5 GB** of `ArrayBuffer` — an
  order-of-magnitude reduction vs. the object model, and **transferable** (zero-copy) to the main thread.
- The **concrete, measured** memory/time budgets are ratified in **DD-003 (E2)** once the worker produces the
  IR; DD-001's job is to make those budgets *achievable* by choosing typed SoA now.
- Bounds/sourceIndex construction is O(N); layer segmentation is single-pass.

## 8. Testing
- **Golden IR fixtures (#28):** for each MIT `demo/gcodes/*` fixture, snapshot a **stable digest** of the IR
  (per-buffer hash + header) plus small human-readable summaries (segment/layer/point counts, bounds,
  capabilities). Snapshots let the parser or renderer change while proving the IR is unchanged.
- **Property tests:** layer `z` monotonic non-decreasing; `bounds` contains all extrude endpoints; `sourceIndex`
  strictly sorted and total; every `tool`/`layer`/`object` index in range; `kind` flags consistent
  (e.g., `RETRACT ⇒ e<0`).
- **Capability assertions:** fixtures with/without object or feature metadata assert the right `Confidence`.
- **No-dependency test:** `@chestnutlabs/toolpath-core` must not import `three`, DOM, Vue, or AnyBridge
  (DD-002 CI guardrail).

## 9. Migration (from inherited structures) — see #29
Inherited `Interpreter` accumulates into `Job`/`Layer`/`Path` (object arrays of points). Migration path:
1. Add an **IR writer** that the interpreter feeds (append to typed buffers) instead of building `Path` objects,
   *or* a **compatibility adapter** `job → ToolpathIR` for a transitional period.
2. Preserve current observable outputs (point counts, extrusion distance) — the golden fixtures pin them
   (RR-001: 3DBenchy = 97,574 points).
3. Update `docs/UPSTREAM_PROVENANCE.md` (`ToolpathIR` = Chestnut-original; interpreter = modified).

## 10. Observability / diagnostics
Header carries `parserVersion`, `irSchemaVersion`, `dialect` decisions, warning counts, and the `capabilities`
summary — enough to diagnose a bad preview without shipping the source or private metadata.

## 11. Serialized/persisted IR (deferred)
Only the **in-memory** contract + `irSchemaVersion` are defined here. A future **persistence DD** may define a
wire format (e.g., a flat buffer) and a migration/invalidation policy; it must bump `irSchemaVersion` and honor
governance §13 (schema version separate from package version).

## 12. Alternatives considered
- **Memory-layout family — DECIDED: SoA typed buffers** (above), with the §4.2 core/optional channel split
  accepted. *Alternatives considered:*
  - **AoS objects** (inherited): rejected — RR-001 memory/GC evidence.
  - **Columnar with lazy per-channel decode**: more complex; premature without a persistence need.
  - **Serialized flatbuffer as the canonical IR**: couples in-memory to wire format prematurely; deferred (§11).
  **Decided:** SoA typed buffers as the canonical in-memory IR, with the §4.2 channel split (core vs. optional).
- **Capability model as enum vs. per-field flags:** chose a `Confidence` enum + per-field map (simple, honest).

## 13. Risks
| Risk | Mitigation |
|---|---|
| `Float32` precision on large coordinates | `originOffset` (§4.6); renderer precision in DD-004 |
| IR over-fits the current renderer | contract/golden tests; capability model; renderer builds *private* buffers |
| Schema churn breaks consumers | `irSchemaVersion` + change policy; pre-1.0 migration notes (DD-002) |
| Optional channels balloon memory | present only when declared/inferred; absent = unavailable |

## 14. Phased delivery
1. Define types + capability model + `irSchemaVersion` (this DD → `toolpath-core`).
2. Golden fixtures + property tests (#28).
3. IR writer / migration adapter from inherited interpreter (#29).
4. Contract tests wired into CI. *Implementation issues open only after this DD is Accepted.*

## 15. Acceptance criteria
- Represents the master-plan §8.2 required areas (provenance, units/coord state, ordered segments + compact
  buffers, layers, tools/materials, features/objects, per-channel optionals, bounds, source positions,
  warnings/capabilities).
- **Unknown / inferred / approximated / declared are distinguishable**; no fabricated defaults.
- Canonical IR is **transfer-friendly** and depends on **no** `three`/DOM/Vue/AnyBridge.
- Golden fixtures + property/contract tests are defined and green.
- The **[DECISION]** items (§4.6 precision, §12 channel set) are resolved and recorded.
- No IR implementation merged before this DD is **Accepted**.
