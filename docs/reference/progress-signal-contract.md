# Progress-Signal Contract Reference (DD-006, v1)

The normalized live-progress surface: how a host application tells the viewer *where the printer
is* on a parsed toolpath, and what honesty guarantees the mapping makes. Everything here ships in
`@chestnutlabs/toolpath-core` (`progress.ts`) and `@chestnutlabs/gcode-renderer-three`
(`setProgress`); no telemetry transport exists in any viewer package (AnyBridge #783 boundary:
the host owns telemetry normalization).

Authoritative design: [DD-006](../design/DD-006-normalized-live-progress-and-source-position-mapping.md)
(Accepted 2026-07-23). This page is the consumer-facing summary.

## The shape

```ts
import { createProgressMapper, type ProgressObservation } from '@chestnutlabs/toolpath-core';

const mapper = createProgressMapper(ir, { fileSizeBytes });   // once per parsed file
renderer.setProgress(mapper.observe(obs));                    // per telemetry sample
renderer.setProgress(mapper.tick(Date.now()));                // per staleness check (≥1 Hz is plenty)
mapper.reset(); renderer.setProgress(null);                   // job ended / file changed
```

## `ProgressObservation` v1

| Field | Type | Meaning |
|---|---|---|
| `v` | `1` | Contract version. Unknown versions map to `unavailable` (`version-unsupported` note), never throw. |
| `timestampMs` | number | Consumer clock; drives staleness (`staleAfterMs`, default 10 000). |
| `file.name` / `file.sizeBytes` / `file.sha256` | optional | Identity evidence for the file the *printer* is executing (see identity rules). |
| `position.byte` | optional | Exact byte offset into **the byte stream the parser consumed** (for `.gcode.3mf`: the extracted plate payload). |
| `position.line` | optional | **Reserved** (D3): carried and serialized, not mapped in v1 — falls through with a `line-unmapped` note. |
| `position.layer` / `position.totalLayers` | optional | Reported layer index and total. |
| `position.percent` | optional | Fraction `0..1`. Values > 1 are rejected as invalid (never clamped into a fake position). |
| `position.percentBasis` | `'bytes' \| 'job' \| 'unknown'` | What the percent measures (D4). Unknown future values degrade to `'unknown'`. |
| `state` | `'printing' \| 'paused' \| 'complete' \| 'cancelled' \| 'unknown'` | `complete` → final segment (`known`); `cancelled`/`unknown` with no facts keep the last position, flagged. |

All position facts are optional and validated field-by-field; malformed values are ignored with
`invalid-field` notes. Extra/unknown fields round-trip serialization untouched (forward-compat,
contract-tested).

## Fallback hierarchy → `MappedProgress`

Highest-precision usable fact wins; the confidence vocabulary is DD-001's (D2):

| Winning fact | `basis` | `confidence` | Uncertainty band |
|---|---|---|---|
| `byte` | `byte` | `known` | point |
| `layer` (trusted count) | `layer` | `inferred` | the whole layer |
| `percent` + `percentBasis:'bytes'` + known file size | `percent` | `approximated` | ±0.5 % of segments |
| `percent` (job/unknown basis) | `percent` | `approximated` | ±2 % of segments, at least the containing layer |
| none usable | `none` | `unavailable` | none — the overlay hides |

`MappedProgress` carries `segIndex` (last completed/in-progress segment; `null` = nothing
completed or unavailable), `basis`, `confidence`, `band` (inclusive `[loSeg, hiSeg]`),
`layerIndex`, `stale`, and structured `notes` (capped at 8).

## Honesty rules (what the mapper will and will not claim)

- **Cross-checks widen, never switch.** When multiple facts disagree beyond one layer
  (byte-vs-layer, layer-vs-percent), the band widens to cover both and `cross-check-disagrees`
  is noted; the winning tier and its confidence stay put.
- **Layer-count mismatch** (`totalLayers` differs from the IR's layer count by > 2): the reported
  layer is treated as a *fraction* (`approximated`, `layer-count-mismatch` note), not trusted as
  an index.
- **File identity** — `sha256` disagreement: mapping is `unavailable` (a marker on the wrong file
  is worse than none). `sizeBytes` disagreement > 0.1 %: byte and percent-of-bytes demote to
  fraction mapping of the *printer's* file (`file-mismatch` note). The parsed byte length from
  `ir.header.source.byteLength` backs promotion and identity when the host passes nothing.
- **Regression** (§4.4.2): backward moves always re-sync (pause/replay, `M600`); jumps back more
  than 2 layers add `position-regressed`. Observations are never dropped for being out of order.
- **Staleness**: `tick(now)` flips `stale` after `staleAfterMs` without a fresh observation; the
  position holds, the presentation degrades.

## Renderer presentation (`gcode-renderer-three`)

`renderer.setProgress(mapped)` presents by confidence — the epic's "exact vs. approximate must be
clearly distinguished":

| `confidence` | Presentation |
|---|---|
| `known` | Completed path normal, remaining path as a translucent lines ghost, **position marker** (always-on-top, model-relative size). |
| `inferred` / `approximated` | Completed/ghost cuts at the band edges with an **emphasis band** between — no point marker (that would be false precision). |
| stale (any) | Same cuts, marker/band switch to the gray stale style. |
| `unavailable` | Overlay fully hidden; `progress-presentation-changed` fires with the mapping's first note as `reason`. |

- Tubes quality ghosts as **lines** (preserves the E3 tube budgets).
- **User scrubbing always wins**: while `setScrubPosition` is active the scrub owns the draw cut
  (ghost drops, the band indicator stays); the overlay restores on release.
- `setIR` hides the overlay (`new-ir` reason) — mapped indices never carry across files.
- Mode changes emit `{ type: 'progress-presentation-changed', mode: 'exact'|'band'|'stale'|'hidden', reason? }`.

## Note codes (v1)

`invalid-field`, `version-unsupported`, `no-position-facts`, `empty-ir`, `before-first-segment`,
`line-unmapped`, `layer-out-of-range`, `layer-count-mismatch`, `cross-check-disagrees`,
`file-mismatch`, `position-regressed`, `job-cancelled`, `state-unknown`. Codes are additive across
minor versions; unknown codes should be logged, not treated as errors.

## Contract fixtures

[`test-data/fixtures/progress/`](../../test-data/fixtures/progress/) pins four observation
sequences shaped after the real AnyBridge telemetry surfaces surveyed in DD-006 §1.1 (Bambu
job-percent+layer, Anycubic percent, Klipper byte-fraction ± `SET_PRINT_STATS_INFO`, byte-exact),
each with exact expected `MappedProgress` outputs. They are plain JSON — a host can replay them
against its own producer without importing this repo's code.
