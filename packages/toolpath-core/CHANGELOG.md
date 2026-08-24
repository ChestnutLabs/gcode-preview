# @chestnutlabs/toolpath-core

## 0.5.2

## 0.5.1

## 0.5.0

## 0.4.0

### Minor Changes

- [#248](https://github.com/ChestnutLabs/gcode-preview/pull/248) [`1029580`](https://github.com/ChestnutLabs/gcode-preview/commit/10295803839816adaed224c48eba1f74374c0c2a) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat: non-extrusion `Cut` move classification + tool-state modal (DD-012 phase 1, [#189](https://github.com/ChestnutLabs/gcode-preview/issues/189))

  Non-extrusion toolpaths (CNC / laser / plotter) no longer collapse their productive moves into
  `Travel`. The parser now tracks a tool-engaged modal state — `M3`/`M4` (spindle/laser on, incl. the
  `M03`/`M04` leading-zero form) engage it, `M5` disengages — and classifies a move with **no extrusion
  `E`** while the tool is engaged as the new **`MoveKind.Cut`** bit (a CNC/laser/plotter counterpart to
  `Extrude`, composing with `ArcSegment` like the other kinds).
  - New IR move kind `MoveKind.Cut = 1 << 7` (`@chestnutlabs/toolpath-core`).
  - New capability **`cutMoves`**: `known` once a tool-state modal is seen (a CNC/laser/plotter file),
    `unavailable` for FDM.
  - **FDM is byte-identical**: FDM slices never issue `M3`/`M4`, so `Cut` is never set and every move
    stays `Extrude`/`Travel` exactly as before (verified against the native-golden corpus; the CNC
    fixtures `demo-easel`/`demo-mach3` are documented intentional adapter-divergences).

  Modal tool-state _value_ channels (laser power / spindle RPM via `S`), canned-cycle expansion, and
  dialect families follow in later DD-012 phases.

- [#250](https://github.com/ChestnutLabs/gcode-preview/pull/250) [`8fec7c3`](https://github.com/ChestnutLabs/gcode-preview/commit/8fec7c3622cd2a6d6d57b43d7866cfea1cb71e09) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat: opt-in modal tool-power channel (DD-012 phase 1 — the `ModalChannel` mechanism, [#189](https://github.com/ChestnutLabs/gcode-preview/issues/189))

  Adds the shared, opt-in **`ModalChannel`** mechanism DD-012 D3 is built around, and its first channel:
  **`toolPower`** — the modal spindle/laser `S` value while a tool is engaged.
  - `ParseOptions.modalChannels?: readonly string[]` — request per-segment modal channels by id.
    Supported id: `'toolPower'`. Unknown ids are ignored with a `modal-channel-unsupported` warning.
  - `ToolpathSegments.modal?: Readonly<Record<string, Float32Array>>` — one Float32 column per requested
    channel, present **only** when requested. An unset value is `NaN` (an honest "no value here"), never
    a fabricated `0`. `toolPower` is the modal `S` (set on `M3`/`M4` and inline on GRBL-laser motion
    lines) while engaged, `NaN` when the tool is off (`M5`).
  - New capability **`toolPower`**: surfaced only when the channel is requested — `known` once a
    tool-state modal is seen, else `unavailable`.
  - **Default parse pays nothing**: no `modalChannels` ⇒ no `modal` on the IR, no extra columns, FDM
    output unchanged. The budget-aware SoA writer (DD-003) grows the opt-in columns in lockstep and
    accounts their bytes.

  Presentation (Watts vs RPM) is a dialect label, not a separate channel (DD-012 D4); [#180](https://github.com/ChestnutLabs/gcode-preview/issues/180)'s
  fan/temp/accel color channels reuse this same mechanism in a later phase.

## 0.3.0

### Minor Changes

- [#222](https://github.com/ChestnutLabs/gcode-preview/pull/222) [`39348de`](https://github.com/ChestnutLabs/gcode-preview/commit/39348de9ce68717e71516f9acaccd475139983ba) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Extract **filament used + the slicer's print-time estimate** into `DialectMetadata` ([#183](https://github.com/ChestnutLabs/gcode-preview/issues/183)). Two new
  optional, capability-honest fields (absent when the slicer doesn't emit them):
  - `filamentUsage` — total filament `lengthMm` / `volumeCm3` / `weightG`.
  - `printEstimate` — the slicer's own print-time `seconds` (+ `mode` label), the trustworthy figure for
    a time readout / time scrub versus a kinematic estimate.

  Parsed per-slicer from G-code comments: **PrusaSlicer** (`filament used [mm|cm3]`,
  `total filament used [g]`, `estimated printing time (normal mode)`), **Orca/Bambu** (same filament
  totals + `total estimated time:` / `model printing time:`), and **Cura** (`;Filament used: <m>m`,
  `;TIME:<seconds>`). Additive; no IR/geometry change.

- [#224](https://github.com/ChestnutLabs/gcode-preview/pull/224) [`d161e80`](https://github.com/ChestnutLabs/gcode-preview/commit/d161e802e36cc87fa27848ceef9d68cd45628760) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Source-line ↔ segment mapping ([#184](https://github.com/ChestnutLabs/gcode-preview/issues/184)) — the "G-code debugger" surface. Additive; no IR/geometry change.
  - `toolpath-core`: framework-free primitives over `segments.srcByte` + `sourceIndex`: build a line
    index (`buildSourceLineIndex`), then `lineAtByte` / `byteRangeOfLine` / `sourceLineOfSegment`
    (segment → its 1-based source line) / `segmentAtSourceLine` (line → segment, -1 when the line
    produced none). Both directions, O(log n).
  - `gcode-renderer-three`: `ToolpathRenderer.pickSegment(ndcX, ndcY, threshold?)` raycasts the
    toolpath and returns the IR segment under a pointer (or null) — click a segment → its source line.
    The pure index-mapping helper `resolveHitSegment(mesh, vertexIndex)` is exported and unit-tested.
  - `gcode-preview-core`: `PreviewRenderer.pickSegment` (the 2D renderer returns null — no picking yet),
    reachable via `raw.renderer()`.

- [#223](https://github.com/ChestnutLabs/gcode-preview/pull/223) [`82bd7ae`](https://github.com/ChestnutLabs/gcode-preview/commit/82bd7ae7f76e742767719d8efa11173a6548fc03) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Time-based scrub + a print-time estimate ([#181](https://github.com/ChestnutLabs/gcode-preview/issues/181)). Additive; no IR/geometry change.
  - `toolpath-core`: `computeToolpathTime(ir)` builds a cumulative **kinematic** time axis (per-segment
    length ÷ feedrate; constant-velocity, not accel-aware — a slight *under*estimate) plus
    `segmentsCompletedAtTime(cumulativeMs, ms)`. Unknown feedrates contribute 0 and flag the estimate
    approximate (`hasUnknownFeedrate`) — never a fabricated duration.
  - `gcode-preview-core`: state gains `totalTimeMs` + `timeEstimateSource` — **prefers the slicer's own
    estimate** (`DialectMetadata.printEstimate`, [#183](https://github.com/ChestnutLabs/gcode-preview/issues/183)) when present (`'slicer'`), else the kinematic
    total (`'kinematic'`). New `controls.setScrubTime(ms)` cuts the toolpath at a print time (resolves to
    a segment-index scrub).
  - Adapters (Vue/React/Svelte/Element): a `scrubTime` prop → `setScrubTime`.

## 0.2.0

### Minor Changes

- [#171](https://github.com/ChestnutLabs/gcode-preview/pull/171) [`1c2e5b0`](https://github.com/ChestnutLabs/gcode-preview/commit/1c2e5b031845630a6f82501de51e1ae902d52559) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add M600 filament-swap color-change annotation (E9 phase 3, [#147](https://github.com/ChestnutLabs/gcode-preview/issues/147), DD-009 D2).

  The parser now records a sparse `colorChanges` events channel on `ToolpathIR`
  (`{ x, y, z, segIndex, srcByte, tool }`, capability `colorChanges`) — `M600` is a marker with a
  position but no motion segment, captured in a side channel that leaves segment indices, scrub, and
  layer ranges untouched (mirrors the `retractions` channel from [#148](https://github.com/ChestnutLabs/gcode-preview/issues/148)). Detection lives in the parser
  (where `M600` was previously discarded as `unsupported-command`), so a bare `M600` is honored even
  when no dialect is detected. A new `colorChange` renderer color mode shades segments by **swap slot**
  (the count of color changes at or before a segment) using the existing palette-index path — not the
  `tool` channel — so multi-material prints color by active filament across manual swaps. Capability-
  gated: offered only when the IR actually carries an `M600`. Exposed through the existing `colorMode`
  option, so all adapters and `renderStill` support it with no new prop.

  DD-009 D2 was amended (maintainer-approved) to move detection from the dialect layer to the parser
  and realize the "dedicated color-change channel" as this sparse events channel.

- [#168](https://github.com/ChestnutLabs/gcode-preview/pull/168) [`11c75bd`](https://github.com/ChestnutLabs/gcode-preview/commit/11c75bd540c1490f888ec9ecee64814cafb25156) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add opt-in retraction/deretraction markers (E9 phase 1, [#148](https://github.com/ChestnutLabs/gcode-preview/issues/148), DD-009 D1).

  The parser now records a sparse `retractions` events channel on `ToolpathIR`
  (`{ x, y, z, kind, srcByte, segIndex }`, capability `retractions`) — E-only retraction moves emit no
  segment, so they are captured positionally in a side channel that leaves segment indices, scrub, and
  layer ranges untouched. The renderer draws them as opt-in always-on-top markers (warm = retract, cool
  = unretract) via `setShowRetractions`, clipped by the current layer/scrub window and shown only when
  the IR actually carries events. Exposed as a `showRetractions` prop across the Vue, React, and Svelte
  adapters (default off).

## 0.1.0

### Minor Changes

- [#141](https://github.com/ChestnutLabs/gcode-preview/pull/141) [`c26879f`](https://github.com/ChestnutLabs/gcode-preview/commit/c26879f4148b77e5e9070bc2ee421a265c9571d3) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - First published line of the Chestnut Labs G-code Preview stack (`v0.1.0`, DD-008): worker-based
  `.gcode` / `.gcode.3mf` parsing into a versioned `ToolpathIR`, cross-vendor dialect annotation
  (PrusaSlicer, Orca/Bambu, Cura, Klipper, Marlin, RepRap-flavor), a Three.js renderer with layer
  clipping, scrub, tubes, build plates and the honest live-progress overlay, a framework-neutral
  preview controller, and first-class Vue/React/Svelte adapters with capability parity.
