# DD-005 — Dialect Plugin and Container Adapter Contracts

**Status:** **Accepted (2026-07-22, with maintainer amendments)** <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Chestnut Labs
**Date:** 2026-07-22 · **Last revised:** 2026-07-22
**Owning Epic:** E4 (#5) · **Milestone:** M3
**Supersedes / Superseded by:** none
**Related:** DD-001 (capability model this DD upgrades honestly), DD-002 (package boundaries §5),
DD-003 (worker pipeline the adapters run inside; limits regime extended to archives), DD-004 §6.2
(build-volume API this DD feeds), architecture doc §`gcode-dialects`/`gcode-containers`, E4 epic (#5),
issue #70 (this DD), maintainer request 2026-07-22 (per-file bed geometry; `.gcode.3mf` support)

---

> **Accepted 2026-07-22 with maintainer amendments (all five decisions approved as amended):**
> **(1)** annotator-only model + geometry-invariance gate accepted; **additionally** a read-only
> normalized **command/event hook** (§4.3) — `onComment` alone cannot support `M486`/`EXCLUDE_OBJECT`/
> tool/vendor-command coverage — and **compatible adapters compose** (slicer + firmware flavor
> together) rather than one global winner (§4.1). **(2)** `ParseResult.metadata` accepted, no
> fabricated fallback; `MachineGeometry` **expanded** to explicit bounds/polygons, origin coordinates,
> excluded regions, and provenance/evidence; file-vs-consumer **precedence and mismatch reporting**
> defined, plus the renderer/facade mechanism (`setBuildVolume`) to apply a discovered volume
> post-parse (§4.2). **(3)** native bounded in-memory `.gcode.3mf` accepted for v1; runtime
> requirement **corrected to the pinned Node 22** (Node 18 lacks `DecompressionStream('deflate-raw')`);
> **added**: per-entry CRC32 verification, central/local-header agreement checks, encrypted-entry
> rejection, duplicate-canonical-name handling, and an explicit multi-plate discovery/selection
> lifecycle (§4.4). **(4)** explicit registration + worker execution accepted with the API **revised
> around the worker boundary**: sessions select **serializable adapter IDs/config**; implementations
> are bundled and registered **inside** worker entries (batteries-included + slim); custom adapters
> use a consumer-supplied custom worker; tail-based detection behavior for non-seekable streams
> defined (§4.5). **(5)** phase order accepted with the **fixture manifest + compatibility-matrix
> skeleton created in the contracts phase** and updated throughout; the final phase publishes and
> ratifies the accumulated evidence (§14). Implementation may begin with the contracts/registry phase;
> the container phase additionally requires the §7.3 security-review sign-off.

> **Benchmark ratification (2026-07-23, issue #78 — [E4 report](../../tools/benchmark/results/e4-dialect-container-benchmark-2026-07-23.md)):**
> §7.2 container limits **ratified unchanged**. §8 measured: container open **63–100 ms** @ 250 MB
> (budget 250), inflate **146–164 MB/s** (budget ≥5), unset-hook cost architectural-zero, active
> adapter overhead within the machine's −2…+6% noise band (10% regression tripwire committed;
> reference-machine confirmation recommended — same caveat class as the E3 fps run). **One measured
> spec addition awaiting maintainer acceptance at the E4 gate:** container-extracted plate streams
> default `partialMinBytes` to **8 MiB** (explicit consumer settings win) — at the direct-input
> 25 MiB default, container TTFP measured 3,678 ms (over the 3 s budget); at 8 MiB it is **1,322 ms**
> with zero total-time cost. Direct-input defaults unchanged. The compatibility matrix is published
> as the per-phase evidence record; E4 exit additionally requires the §7.3 security-review sign-off.

## 1. Problem

The parse core is a quirk-faithful, golden-gated port of the inherited generic engine: it produces
byte-exact geometry for every vendor, but everything slicers express **outside** standard motion
commands is currently reported `unavailable` — feature roles (`;TYPE:` walls/infill/support), print
objects, filament/tool details, thumbnails, and, most user-visible, the **machine/bed geometry** that
would let the viewer show the right build plate for the file instead of a hard-coded one. Meanwhile
real-world files increasingly arrive as **containers** (`.gcode.3mf` from Bambu Studio/OrcaSlicer): a
ZIP holding per-plate G-code plus exactly that metadata. E4's mandate is cross-vendor compatibility
through **adapters — not vendor branches in the core** — plus safe container extraction.

## 2. Scope

- The **dialect adapter contract** and registry (`@chestnutlabs/gcode-dialects`): detection +
  metadata annotation that upgrades DD-001 capabilities honestly.
- The **container adapter contract** (`@chestnutlabs/gcode-containers`): input sniffing, safe
  in-memory `.gcode.3mf` extraction, plate selection, metadata surfaces.
- **Machine/bed geometry extraction** feeding `ToolpathRendererOptions.buildVolume` (maintainer
  requirement, 2026-07-22).
- The single, minimal parse-core extension the annotation path needs (§4.3).
- Compatibility matrix format and honest partial/unsupported degradation.
- Security review checklist for the extraction phase (§7.3).

## 3. Non-goals

- `.bgcode` (Prusa binary G-code) — a separate scoped DD when prioritized.
- Downloading files, printer networks, cloud APIs — AnyBridge's domain (E6).
- Re-interpreting motion semantics per vendor — G0/G1/G2/G3 and machine-state rules stay in the
  golden-gated core. **No adapter may change geometry** (§9 enforces this mechanically).
- Slicing, model (mesh) 3MF, vendor UI.

## 4. Data contracts / API

### 4.1 Dialect adapter contract — ACCEPTED (amended: composition + command events)

```ts
// @chestnutlabs/gcode-dialects
export interface DialectAdapter {
  id: string;                              // 'prusaslicer' | 'orca-bambu' | 'klipper' | ...
  displayName: string;
  /** 'slicer' and 'firmware' adapters COMPOSE (amendment 1) — e.g. PrusaSlicer + Klipper together. */
  kind: 'slicer' | 'firmware' | 'generic';
  /** Sniff the first window of source text (and container metadata when present). */
  detect(header: DetectInput): DialectDetection | null;
  /** Per-comment annotation hook (§4.3): called with comment text + srcByte during the parse. */
  onComment?(comment: string, srcByte: number, sink: AnnotationSink): void;
  /** Read-only normalized command events (§4.3, amendment 1): M486/EXCLUDE_OBJECT/Tn/vendor codes. */
  onCommand?(event: CommandEvent, sink: AnnotationSink): void;
  /** Post-parse pass: resolve accumulated state into channels/metadata. */
  finalize?(ir: ToolpathIR, sink: AnnotationSink): void;
}
```

**Composition (amendment 1):** detection selects at most one adapter per `kind`; all selected
compatible adapters run together (a slicer adapter owns feature/object/bed comment metadata while a
firmware adapter owns e.g. `EXCLUDE_OBJECT` semantics). Within a kind, highest confidence wins; ties
degrade to none. Every applied adapter is listed in `ir.header.dialects` with its own confidence.
Sink conflicts (two adapters writing the same channel range) resolve last-writer-wins **with a
`dialect-conflict` warning** — expected to be rare because kinds partition responsibilities.

```ts

export interface DetectInput {
  headText: string;          // first 64 KB decoded
  tailText: string;          // last 16 KB (Prusa/Cura put settings at the end)
  containerMeta?: ContainerMetadata; // when the input came from a container
}

export interface DialectDetection {
  dialectId: string;
  confidence: Confidence;    // DD-001 scale — never fabricated certainty
  evidence: string;          // human-readable ("found '; generated by PrusaSlicer 2.7'")
}

export interface AnnotationSink {
  /** Write FeatureRole for segments in [segStart, segEnd] (validated bounds). */
  setFeature(segStart: number, segEnd: number, role: FeatureRole): void;
  setObject(segStart: number, segEnd: number, objectId: number): void;
  defineObject(id: number, name: string): void;
  setMachine(machine: MachineGeometry): void;
  setToolInfo(tool: number, info: Partial<ToolInfo>): void;
  upgradeCapability(key: string, confidence: Confidence): void;
  warn(code: string, message: string, srcByte?: number): void;
}
```

Adapters are **annotators**: they may only write the optional channels (`feature`, `object`), the
metadata object, and capability upgrades. They cannot touch positions, kinds, layers, or counts —
the sink exposes no way to.

### 4.2 Result metadata & bed geometry — ACCEPTED (amended: richer geometry, precedence, mechanism)

No IR schema bump. `ParseResult` gains an optional sibling to the IR:

```ts
export interface DialectMetadata {
  dialects?: DialectDetection[];       // every applied adapter (amendment 1: composition)
  machine?: MachineGeometry;           // ← feeds the renderer build volume (below)
  filaments?: FilamentInfo[];
  thumbnails?: { width: number; height: number; mime: string; bytes: Uint8Array }[];
  raw?: Record<string, string>;        // whitelisted key/value settings (bounded)
}

/** Amendment 2: explicit coordinates, polygons, exclusions, provenance. */
export interface MachineGeometry {
  bed:
    | { kind: 'rect'; min: { x: number; y: number }; max: { x: number; y: number } }
    | { kind: 'circular'; center: { x: number; y: number }; diameter: number }
    | { kind: 'polygon'; points: { x: number; y: number }[] }; // e.g. Prusa bed_shape verbatim
  /** Printer-coordinate origin location, explicit — not a boolean convention. */
  origin: { x: number; y: number };
  /** Regions the toolhead must avoid (Klipper bed_exclude, Bambu excluded areas). */
  excludedRegions?: { kind: 'rect' | 'polygon'; points: { x: number; y: number }[] }[];
  heightMm?: number;
  printerName?: string;
  confidence: Confidence;              // 'known' from container config; 'inferred' from comments
  /** Provenance: which adapter, from what evidence (amendment 2). */
  source: { adapterId: string; evidence: string; srcByte?: number };
}
```

Detections also land in the existing `ir.header.dialects: DialectDecision[]` slot (reserved by
DD-001, empty until now). When no adapter matches, `metadata.machine` is absent — **the viewer never
invents a bed**; a bounds-derived plate labeled `approximated` is a consumer UI choice, not a default.

**Precedence & mismatch (amendment 2):** an explicitly consumer-configured build volume **wins** —
the host application knows which physical printer the file targets better than the file claims.
File-discovered geometry applies when the consumer opted in (`buildVolume: 'from-file'` or no
explicit volume configured with dialects enabled). When both exist and disagree beyond tolerance
(any bed dimension differing > 1 mm), the discrepancy is **reported, not silently resolved**: a
structured `machine-geometry-mismatch` warning in metadata plus a renderer event, so the UI can say
"this file targets a different printer/bed".

**Application mechanism (amendment 2):** `ToolpathRenderer.setBuildVolume(def: BuildVolumeDef |
MachineGeometry): void` — disposes and rebuilds the volume group post-construction (geometry-only;
toolpath meshes untouched), so a session flow of *parse → discover machine → apply volume → render*
needs no renderer reconstruction. The demo/facade wires `metadata.machine` through it per the
precedence above.

### 4.3 Parse-core extension: read-only comment + command hooks — ACCEPTED (amended)

Feature/object markers are comments interleaved with motion (`;TYPE:External perimeter`), but
object-exclusion and tool/vendor coverage lives in **commands** (`M486 S3`, `EXCLUDE_OBJECT_START
NAME=x`, `T1`, vendor `M`-codes) that the engine currently routes to the `unsupported-command`
warning. **Accepted (amendment 1): two optional read-only hooks** on `ParseOptions`:

```ts
onComment?(text: string, srcByte: number): void;
/** Normalized, read-only view of each lexed command BEFORE dispatch — observers cannot alter parsing. */
onCommand?(event: CommandEvent): void;

export interface CommandEvent {
  gcode: string;                       // normalized lowercase word+number, e.g. 'm486'
  params: Readonly<Record<string, number>>;
  rawLine: string;                     // for vendor syntaxes the lexer's params don't capture
  srcByte: number;
  segIndex: number;                    // writer.count at the time — maps events to segment ranges
}
```

Both hooks observe at the existing lex points; neither can alter lexing, dispatch, or state — the
golden-gated semantics are untouched, and the cost when unset is one branch per line/command
(measured in §8). Adapters map hook positions to segment ranges via `segIndex` (annotation ranges
are `[segAtEvent, segBeforeNextEvent]`, resolved in `finalize`).

### 4.4 Container adapter contract — ACCEPTED (amended: integrity checks, plate lifecycle, runtime)

```ts
// @chestnutlabs/gcode-containers
export interface ContainerAdapter {
  id: string;                                     // 'gcode-3mf'
  sniff(prefix: Uint8Array, name?: string): boolean;   // magic bytes + extension hint
  open(input: Uint8Array | BlobLike, limits: ContainerLimits): Promise<OpenedContainer>;
}

export interface OpenedContainer {
  plates: PlateEntry[];                           // ≥1; Bambu/Orca are multi-plate
  metadata: ContainerMetadata;                    // machine/filament config, slice info
  /** Stream one plate's G-code payload (drives the DD-003 streaming parser). */
  openPlate(index: number): ReadableStreamLike<Uint8Array>;
}
```

`.gcode.3mf` specifics: ZIP central-directory walk (no full inflate upfront); select
`Metadata/plate_*.gcode` as plates; read `Metadata/project_settings.config` (JSON — bed size
`printable_area`, `printable_height`, printer name, filaments) and `Metadata/slice_info.config`;
thumbnails optional and size-capped. Decompression uses the platform `DecompressionStream`
(`deflate-raw`) — **zero new dependencies**, streaming, works in workers and in the project's
**pinned Node 22 runtime** (amendment 3 correction: Node 18 does **not** support `deflate-raw`; the
documented minimum is Node ≥ 20, and this repo pins 22). Extraction is **in-memory only** — this
library never writes files, so path traversal cannot touch a filesystem; entry names are still
validated (§7) for selection sanity and defense in depth.

**ZIP integrity requirements (amendment 3) — all structured-error/warning tested:**
- **CRC32 verified** for every extracted entry (streaming accumulation; mismatch →
  `E_CONTAINER_CRC` for payload entries, `container-entry-corrupt` warning + skip for metadata).
- **Central/local header agreement**: name, sizes, and method must match; disagreement →
  the entry is treated as hostile (payload: error; metadata: skip + warning).
- **Encrypted entries rejected** (`E_CONTAINER_ENCRYPTED`) — no decryption path exists.
- **Duplicate canonical names** (after normalization: case-folding, separators, dot-segments):
  duplicates of a *selected payload* entry are an error (`E_CONTAINER_DUPLICATE`); duplicate
  metadata entries → first central-directory occurrence wins + `container-duplicate-entry` warning.

**Multi-plate discovery/selection lifecycle (amendment 3):** `open()` performs discovery only —
central directory, metadata, plate list (`{index, name?, previewThumbnail?, estimatedBytes}`) — with
**no payload inflate**. The consumer selects; `openPlate(i)` streams exactly one plate through the
DD-003 pipeline. Session convenience: `session.parse(containerInput, { plate?: number })` — when the
container is multi-plate and `plate` is omitted, plate 0 parses with a `container-multiple-plates`
warning carrying the discovered plate list, so UIs learn to offer selection without a failed parse.

### 4.5 Registry & wiring — ACCEPTED (amended: serializable selection across the worker boundary)

Adapters execute **inside the worker** — but adapter *objects* hold functions and cannot cross the
message boundary. **Amendment 4 revises the API accordingly:**

- **Main-thread sessions select by serializable ID + config**, not by object:

  ```ts
  const session = new GcodeParseSession();                      // batteries-included worker
  await session.parse(input, {
    dialects: ['prusaslicer', 'klipper'],                       // or 'auto' (default) | false
    dialectConfig: { prusaslicer: { thumbnails: false } },      // structured-cloneable per-adapter config
    containers: 'auto'                                          // or ['gcode-3mf'] | false
  });
  ```

- **Implementations are bundled and registered inside worker entries.** Two shipped entries:
  - `worker.js` (default, **batteries-included**): the built-in adapter set registered; `'auto'`
    runs detection over all of them.
  - `worker-slim.js`: zero adapters bundled — smallest payload; dialect options no-op with a
    `dialects-unavailable` warning so the degradation is visible, never silent.
- **Custom adapters = consumer-supplied custom worker** (the existing DD-003 §4.4 escape hatch):
  `createWorkerHandler(post, { dialects: [...myAdapters], containers: [...] })` — consumers bundle
  their own entry registering first-party + custom adapters, and pass it via `SessionOptions.worker`.
  No dynamic code ever crosses the boundary.
- Registration inside an entry stays **explicit and tree-shakeable** (an array passed to
  `createWorkerHandler`) — no global side-effect registry (§12).

**Tail-based detection on non-seekable streams (amendment 4):** `DetectInput.tailText` is naturally
available for `string`/`Uint8Array`/`Blob` inputs (sliceable). For a non-seekable `ReadableStream`,
detection runs **head-first**; adapters whose evidence lives in the tail (Prusa/Cura settings blocks)
receive a bounded rolling tail buffer (last 16 KB, maintained by the existing line-drain) at
`finalize` and may upgrade detection/metadata then. Consequences are explicit: tail-derived
annotations land only in the final IR (never in #60 partial previews — already capability-honest),
and a stream whose dialect is only tail-detectable reports head detection `confidence: 'inferred'`
at best until finalize. Boundary rules (DD-002 §5, lint-enforced) unchanged: `gcode-dialects` and
`gcode-containers` depend only on `toolpath-core` (+ parser types); the parser core keeps **zero**
imports from either — worker entries compose them.

## 5. Lifecycle

Container open → plate select → stream parse (DD-003 unchanged) with dialect detection on the first
decoded window → `onComment` annotations accumulate → engine `finish()` → adapter `finalize` writes
channels/metadata → `done {ir, stats, metadata}`. Cancellation, limits, partial previews (#60), and
the terminal-message contract are untouched; partials do not carry annotations (capability-honest:
slices already say `featureRoles: 'unavailable'`).

## 6. Errors & failure behavior

- Unsupported/corrupt container → structured `E_CONTAINER_*` error (REJECTS, like `E_LIMIT_*` per
  DD-003 §6 semantics when no usable payload exists); a readable payload with bad metadata degrades:
  parse proceeds, metadata omitted, warning recorded.
- Adapter exceptions are **contained**: a throwing adapter is disabled for the session with an
  `adapter-failed` warning — never a failed parse. Detection ambiguity → highest-confidence match
  wins; ties → generic (no adapter), never a guess presented as `known`.
- Degradation is honest per DD-001: unknown dialect leaves capabilities exactly as today.

## 7. Security & resource limits

### 7.1 Threat model
Hostile archives (bombs, huge entry counts, malformed central directories, misleading entry names),
hostile metadata (oversized JSON/config, lying sizes), and hostile comments (adapter parsing of
attacker text). No code execution paths: adapters are first-party code; no eval, no dynamic import
from file content, no network.

### 7.2 Limits (extends DD-003 §7 — same configurable+budgeted philosophy)
| Limit | Default (provisional; ratified by E4 benchmarks) |
|---|---|
| `maxEntries` | 4,096 |
| `maxEntryNameBytes` | 1,024 |
| Compressed input | existing `maxInputBytes` (512 MB) |
| `maxExpandedBytesPerEntry` | 512 MB (a plate is one input) |
| `maxExpandedBytesTotal` | 1 GiB |
| `maxMetadataBytes` (configs, per file) | 8 MB |
| `maxThumbnailBytes` (each / total) | 8 MB / 32 MB |
| Inflate | streaming with incremental caps — a lying local header cannot balloon memory (mirror of DD-003's rolling-buffer discipline) |

### 7.3 Security review checklist (gate requirement — E4 exit needs this signed off)
- [ ] Zip parsing fuzzed against the adversarial archive corpus (truncated CD, overlapping entries,
      zip64 edge cases, bomb ratios, 10⁵ entries, hostile names incl. `../`, absolute, NUL, UTF-8 tricks)
- [ ] §4.4 integrity checks tested: per-entry CRC32, central/local header agreement,
      encrypted-entry rejection, duplicate-canonical-name handling (amendment 3)
- [ ] Every limit above enforced incrementally with a structured warning/error test
- [ ] Entry-name validation (no traversal tokens honored anywhere, even though extraction is in-memory)
- [ ] No filesystem writes anywhere in `gcode-containers` (lint + review)
- [ ] Metadata parsers (JSON/config) bounded and exception-contained
- [ ] Thumbnail bytes surfaced as opaque data only (no decode in our packages)

## 8. Performance

Provisional budgets, measured in the E4 benchmark phase like DD-003 §8 / DD-004 §8 were:
- `onComment` hook overhead with no adapters: **≤ 1%** parse-time delta on the E2 corpus (it is one
  branch per line); with the Prusa/Orca adapter active: **≤ 5%**.
- Container open (central directory + metadata, no plate inflate): **≤ 250 ms** for a 250 MB archive.
- Plate inflate streams at **≥ the DD-003 parse throughput floor** (5 MB/s) so extraction never
  becomes the bottleneck; TTFP budgets (#60) hold measured end-to-end from the container input.

## 9. Testing

- **Geometry invariance (the core guarantee):** for every fixture, IR geometry channels with adapters
  enabled are **byte-identical** to adapters disabled (digest compare) — adapters annotate, never
  reshape. This is the E4 equivalent of the golden gate and runs in CI.
- Per-slicer fixtures with manifest entries (redistributable or contributor-donated per governance
  §11): Orca/Bambu `.gcode.3mf` (multi-plate, AMS), PrusaSlicer (`;TYPE:`, bed_shape, thumbnails),
  Cura (`;TYPE:`/settings tail), Klipper/Marlin/RepRap-style minimal markers.
- Capability assertions per fixture (expected `featureRoles`/`objects`/machine confidence).
- Adversarial archive corpus (§7.3) with expected structured outcomes.
- Bed-geometry: renderer-level test that `metadata.machine` drives `buildVolume` (corner vs centered).

## 10. Migration

Purely additive: new packages, optional session options, optional `metadata` on results, populated
`ir.header.dialects`. No IR schema bump, no protocol version bump (the `done` payload gains an
optional field — v1-compatible per DD-003's additive rule). Inherited upstream code: none consumed;
provenance ledger untouched until an implementation borrows something.

## 11. Observability / diagnostics

Detection decision + evidence surfaced in `ir.header.dialects` and stats; per-adapter warning codes
(`adapter-failed`, `container-entry-skipped`, `metadata-truncated`, …) with counts; the demo displays
dialect + bed source. Redaction: `raw` settings are whitelisted keys only — never absolute local
paths or user identifiers.

## 12. Alternatives considered

- **Vendor forks of the parser core** — rejected: combinatorial maintenance, breaks the golden gate.
- **Second-pass comment scan** instead of the `onComment` hook — rejected: re-decodes up to 512 MB,
  duplicates the line-drain logic for streams, and still needs offset bookkeeping; the hook is one
  branch. (The second pass remains possible for exotic future adapters — the contract doesn't forbid it.)
- **Side-effect global adapter registry** (`registerDialect()`) — rejected: hidden coupling,
  untree-shakeable, order-dependent detection.
- **A ZIP dependency** (jszip/fflate) — rejected for v1: `DecompressionStream` covers deflate with
  zero supply-chain surface; revisit only if zip64/zstd demands arrive with `.bgcode`.
- **Bed geometry inside `ToolpathIR` header** — rejected: it is machine context, not toolpath truth;
  a schema bump would ripple through golden fixtures for a non-geometric datum.

## 13. Risks

| Risk | Mitigation |
|---|---|
| "Dialect support" leaks into scattered core conditionals | adapter-only writes via `AnnotationSink`; boundary lint; geometry-invariance CI gate |
| Container parsing as attack surface | §7 limits + checklist + adversarial corpus before any release |
| Vendor comment formats drift across slicer versions | per-fixture evidence + versioned detection notes in the compatibility matrix (`docs/compatibility/`, dated) |
| Metadata bloat in the `done` message | bounded (`maxMetadataBytes`, thumbnail caps); thumbnails transferred, not copied |
| Adapter cost erodes DD-003 budgets | §8 overhead budgets measured per phase; adapters droppable per session |

## 14. Phased delivery (amendment 5: evidence artifacts start in phase 1)

1. **Contracts + registry + detection** (`gcode-dialects` scaffold, hooks, session/worker wiring,
   renderer `setBuildVolume`, generic fallback) **including the cross-dialect fixture-manifest
   entries and the compatibility-matrix skeleton** (`docs/compatibility/`), both updated by every
   subsequent phase as evidence accumulates.
2. **`gcode-containers` + `.gcode.3mf`** (safe extraction, plate lifecycle, machine metadata → bed
   geometry end-to-end incl. demo) **+ security review** (§7.3).
3. **PrusaSlicer + Orca/Bambu annotation adapters** (feature roles → capability-gated feature
   coloring goes live; objects where present; thumbnails).
4. **Cura, Klipper, Marlin, RepRap-style adapters.**
5. **Multi-tool/AMS/IDEX + object exclusion coverage** (M486/`EXCLUDE_OBJECT` via the command hook
   into the `object` channel and tool metadata).
6. **Compatibility matrix publication + benchmarks**: publish and ratify the evidence accumulated
   across phases 1–5 (`docs/compatibility/*` with evidence dates; §8 ratification).

## 15. Acceptance criteria

- Adapter and container contracts implemented per §4 with the geometry-invariance CI gate green.
- `.gcode.3mf` fixtures parse end-to-end off-thread with correct plate G-code, machine bed geometry
  driving the renderer's build volume, and every §7.2 limit enforced + tested.
- §7.3 security checklist signed off by the maintainer.
- Feature-role coloring works honestly on Prusa/Orca fixtures (`featureRoles: 'known'`) and stays
  gated off elsewhere.
- Command-hook coverage proven on object-exclusion fixtures (`M486`, `EXCLUDE_OBJECT`) with the
  `object` channel populated and capability upgraded (amendment 1).
- Geometry precedence + mismatch reporting tested (consumer-wins default, `from-file` opt-in,
  `machine-geometry-mismatch` surfaced); §4.4 ZIP integrity checks tested (amendment 2/3).
- Compatibility matrix published with per-fixture evidence; unsupported cases degrade with the exact
  documented behavior. No core package depends on AnyBridge.

---

## Decision log

Proposed 2026-07-22 with five requested decisions; **accepted 2026-07-22 by the maintainer with
amendments to every point** — full amendment text in the acceptance note at the top of this
document, incorporated throughout §4, §7, §14, and §15. Summary of the amendments over the
recommendations: (1) added the read-only normalized command/event hook and adapter composition by
kind; (2) expanded `MachineGeometry` (explicit bounds/polygons, origin, excluded regions,
provenance) with defined precedence/mismatch reporting and `ToolpathRenderer.setBuildVolume`;
(3) corrected the runtime floor to the pinned Node 22 and added ZIP CRC/header-agreement/encryption/
duplicate-name requirements plus the explicit multi-plate lifecycle; (4) revised registration to
serializable adapter IDs/config across the worker boundary with batteries-included + slim worker
entries and custom-worker escape hatch, and defined tail-based detection for non-seekable streams;
(5) fixture manifest + compatibility-matrix skeleton created in phase 1 and maintained throughout,
published/ratified in the final phase.
