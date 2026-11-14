# @chestnutlabs/toolpath-core

## 0.24.0

### Patch Changes

- [#585](https://github.com/ChestnutLabs/gcode-preview/pull/585) [`eb6b74c`](https://github.com/ChestnutLabs/gcode-preview/commit/eb6b74c0f9a8a7b0e28060d672d1021dab2a63d5) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Inch files (`G20`) now draw at their real size. **IR coordinates are always mm; `header.units` is the file's
  declaration.**
  - **Before:** after a `G20` the header said `units: 'in'`, but the coordinates stayed in inches and nothing scaled
    them, so an inch file drew 25.4× too small on a millimetre bed.
  - **Now:** the parser multiplies every length word read under `G20` by 25.4: `X`/`Y`/`Z`, arc `I`/`J`/`K` and `R`,
    canned-cycle `R`/`Z`/`Q`, `G92` and `G10` offsets, the feedrate (in/min becomes mm/min) and `E`, as Marlin does.
    `P`, `L`, `S` and `T` are not lengths and are unchanged.
  - `G20`/`G21` apply to the whole line they are on (`G0 X1 G20` is an inch move) and can switch mid-file; only the
    words read under `G20` are converted.
  - RS274NGC `#` parameters are converted where they are used. `[#5420](https://github.com/ChestnutLabs/gcode-preview/issues/5420)`–`[#5422](https://github.com/ChestnutLabs/gcode-preview/issues/5422)` return the position in the program's
    units, as LinuxCNC does.
  - A `G20` file carries one `units-converted` warning with severity `info`. A word that fits in inches but is too
    big for the IR once converted is dropped with the usual `number-out-of-range` warning.
  - Inch arcs are flattened into ~0.5 mm segments, like mm arcs. The old inch-only ×25 segment factor is gone.
  - If you labelled sizes or coordinates with `header.units`, label them mm: the numbers are millimetres for every file.
  - A `G20` or `G21` inside message text (`M117 Printing G20 part`, `M118`, `M486`, Klipper `RESPOND`) is text: it
    does not switch units.

  Millimetre files are unchanged: every file in the test corpus except the two inch files parses to the same IR.

- [#575](https://github.com/ChestnutLabs/gcode-preview/pull/575) [`6b03f42`](https://github.com/ChestnutLabs/gcode-preview/commit/6b03f4221e5f0a552959fbed7f85124203d42f57) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - CNC, laser and plotter files now frame the work instead of the bed.
  - **What changes:** for a file whose productive moves are cuts (`MoveKind.Cut`: a feed move while M3/M4 holds, with
    no extrusion), `ir.bounds` is now the cut extent instead of empty (`Infinity`/`-Infinity`). The 3D viewer and
    `renderStill` fit the camera to the cut, and the click radius and progress marker scale with it, the same as for a
    print. A labelled cut also counts toward `ir.objectBounds`, including object labels a dialect adds (Klipper
    `EXCLUDE_OBJECT`, M486, slicer object comments), so `frameContent: 'object'` frames a labelled cut-only file. A printer with a laser head gets the union of its
    extrusion and its cuts.
  - **What stays the same:** FDM files never produce `Cut` moves, so their bounds are unchanged (every FDM file in the test
    corpus, 21 of them, is byte-identical). Travel, retract and unretract moves are still excluded. `ir.modelBounds` and the
    `nonModelClassification` capability still look at extrusion only, so a cut-only file still reports
    `nonModelClassification: 'unavailable'` with an empty `modelBounds`.
  - **Not covered:** a pen plotter that never sends M3/M4 has no `Cut` moves, so its `bounds` stays empty and the 3D
    viewer still frames the bed.

## 0.23.0

### Patch Changes

- [#533](https://github.com/ChestnutLabs/gcode-preview/pull/533) [`4d08cbc`](https://github.com/ChestnutLabs/gcode-preview/commit/4d08cbc86aa1672ebea6f9d312b376699db5ecf1) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - `ToolpathIRBuilder` and `createProgressMapper` now reject out-of-range input instead of storing a different value.
  - **`ToolpathIRBuilder.addSegment` and `setTool` now throw a `RangeError`** that names the field and the value. Each integer channel must be an integer in its typed-array range: `kind` and `feature` 0–255, `tool` 0–65535, `layer`, `object` and `srcByte` 0–4294967295. Before, the value wrapped silently: tool `70000` was stored as `4464`, while `ir.tools` still listed `70000`. An `object` of `-1` became `4294967295`, and a `srcByte` above 4 GiB lost its high bits. Omitted optional fields still default as before.
  - **Sparse layer indices are renumbered densely.** If you pass layers such as `0, 5, 9` (for example after skipping empty layers), they become `0, 1, 2`, so `segments.layer` indexes `ir.layers` again. The header gets an `info` warning, `layer-indices-densified`. Before, `layers[5]` was not layer 5, and live progress could report a `layerIndex` past the end of `ir.layers`. Dense input is unchanged and gets no warning.
  - **`createProgressMapper` now throws a `RangeError` for a `staleAfterMs` or `fileSizeBytes` that is NaN, ±Infinity or negative.** Before, NaN or Infinity meant a position never went stale, and a negative value meant it was always stale. `undefined` still keeps the default. Observation content from the host is still noted and ignored, never thrown on.

## 0.22.0

### Patch Changes

- [#500](https://github.com/ChestnutLabs/gcode-preview/pull/500) [`3fe25f4`](https://github.com/ChestnutLabs/gcode-preview/commit/3fe25f4d8d66ab1f37d23892365fb33d2c813ff6) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Files with a number too large for the toolpath's 32-bit channels (for example `G1 X10 F` followed by a 40-digit value) no longer break color-by-speed, color-by-power, color-by-layer-height, or the time axis.
  - `@chestnutlabs/gcode-colors`: color-by-speed used to throw a `TypeError` on such a segment and paint every other segment the ramp start colour. The auto-ranges (`feedrateRange`, `toolPowerRange`, `layerHeightRange`) now skip infinite values, so the scale comes from the real values and an infinite value shows as the ramp end. A value that has no place on the ramp (NaN, or an infinite value on an infinite explicit `range`) shows the mode's `fallback`. `rampColor(ramp, NaN)` returns the ramp start instead of throwing.
  - `@chestnutlabs/toolpath-core`: `computeToolpathTime` used to return `NaN` for the total and for every later segment. A segment with a non-finite length now adds 0 ms and sets `hasUnknownFeedrate` (the estimate is a lower bound).
  - `@chestnutlabs/toolpath-core`: `createProgressMapper().observe(null)`, or any other value that is not an object, now returns `unavailable` with a `version-unsupported` note instead of throwing.
  - `@chestnutlabs/toolpath-core`: `ToolpathIRBuilder.addRetraction` / `addColorChange` called before the first `addSegment` now store their position in the same origin-relative frame as the segments. Before, the position was offset by the first segment's start point.

## 0.21.2

## 0.21.1

## 0.21.0

## 0.20.1

## 0.20.0

## 0.19.0

### Minor Changes

- [#423](https://github.com/ChestnutLabs/gcode-preview/pull/423) [`81690dc`](https://github.com/ChestnutLabs/gcode-preview/commit/81690dcfece21d6fd11074ad7a264bcfc9edf455) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(renderer): `setFeatureRoleVisible(role, visible)` — show/hide a single feature role

  Toggle a `FeatureRole` on or off — e.g. hide `Skirt`/`Brim` to declutter a part preview, or isolate
  `Support`. Feature roles live per-segment inside the extrusion geometry (unlike the whole-chunk move-kind
  toggle), so hidden segments are collapsed to NaN positions and the GPU discards them; showing the role
  again restores the geometry byte-for-byte. Available on `ToolpathRenderer` and via
  `GcodePreviewControls.setFeatureRoleVisible` (a no-op on the 2D renderer). Additive and capability-gated:
  gate the UI on `capabilities.featureRoles === 'known'`, like the feature colour mode; untouched geometry
  (no role hidden) is byte-identical. Also exports `FeatureRoleValue` from `@chestnutlabs/toolpath-core`.

## 0.18.0

## 0.17.0

### Minor Changes

- [#402](https://github.com/ChestnutLabs/gcode-preview/pull/402) [`214b0db`](https://github.com/ChestnutLabs/gcode-preview/commit/214b0db2dd9d8aa177d80969bdb59173d33121a3) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(core): non-model classifier + `modelBounds` + `nonModelClassification` capability (DD-026 T2)

  Adds the precedence-ordered classifier that decides which extrusion is the **printed model** and which
  is slicer housekeeping, and exposes its result as a new additive `ir.modelBounds` bounding box plus a
  `nonModelClassification` capability (`known` | `inferred` | `unavailable`).

  `classifyModelBounds(segments, origin)` (exported from `@chestnutlabs/toolpath-core`, alongside
  `HOUSEKEEPING_ROLES` / `isHousekeepingRole`) applies DD-026 D4 per extrusion segment: an explicit
  housekeeping role (skirt, brim, raft, support, prime/wipe tower, purge) or a wipe move is excluded
  first — so a Bambu prime tower emitted **inside** an open object bracket is excluded even though it
  carries a member label; then, when a membership channel exists, only members are kept (an unmarked
  prime at `object 0` is dropped); otherwise all non-housekeeping extrusion is the model (role fallback).

  Confidence is honest and never a guess: `known` when per-segment membership drove it, `inferred` when
  only role exclusion applied, `unavailable` (empty `modelBounds`) when there is neither membership nor
  anything excludable — the genuinely unclassifiable case (e.g. a Simplify3D single object with an
  unmarked prime line), which must fall back to full-extrusion framing and disclose. `objectBounds` keeps
  its existing object-channel contract unchanged; `modelBounds` is strictly additive beside it.

  The classification is derived at parse time from whatever channels exist (usually `unavailable`) and
  **refreshed authoritatively** by the dialect runner's `finalize` once adapters have settled the
  object/feature channels (lifecycle §5). Renderer framing consumes `modelBounds` in a follow-up.

  Additive capability key + additive IR field only; FDM geometry is byte-identical (native goldens
  regenerated for the new capability key alone — every `segmentCount` unchanged).

## 0.16.0

### Minor Changes

- [#386](https://github.com/ChestnutLabs/gcode-preview/pull/386) [`bf032d2`](https://github.com/ChestnutLabs/gcode-preview/commit/bf032d2b4e0ce36dcbd8020caead2a512ca3b618) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(core): first-class non-model FeatureRoles — PrimeTower, WipeTower, Raft, Purge (DD-026 T2)

  Adds four additive `FeatureRole` values (`PrimeTower = 11`, `WipeTower = 12`, `Raft = 13`,
  `Purge = 14`) so slicer housekeeping is a first-class role rather than being folded into the generic
  `Custom`. This is the foundation for the DD-026 T2 model-bounds classifier, which excludes these
  roles when framing the printed object.

  Adapters now map their tower/raft vocabulary onto the new roles: OrcaSlicer/Bambu `Prime tower` →
  `PrimeTower`; PrusaSlicer/ideaMaker `Wipe tower`/`WIPE-TOWER` → `WipeTower`; Cura `PRIME-TOWER` →
  `PrimeTower`; Simplify3D `prime pillar` → `PrimeTower`; and `raft`/`RAFT` across Cura, ideaMaker,
  OrcaSlicer, PrusaSlicer, and Simplify3D → `Raft` (previously reported as `Brim`). `Purge` is reserved
  for the explicit `FLUSH_START/END` bracket landing in a follow-up. Unmapped housekeeping (e.g.
  Simplify3D `ooze shield`) stays generic `Custom` — the safe, in-frame direction.

  Additive numeric-index values only; FDM geometry is byte-identical. The affected raft/tower segments
  report a more precise feature-channel value; no rendered geometry or default colours change.

## 0.15.0

## 0.14.0

## 0.13.0

## 0.12.0

## 0.11.0

## 0.10.0

## 0.9.0

## 0.8.1

## 0.8.0

## 0.7.0

### Minor Changes

- [#313](https://github.com/ChestnutLabs/gcode-preview/pull/313) [`39ede6e`](https://github.com/ChestnutLabs/gcode-preview/commit/39ede6ebc0a1ba594a391f1b33db2bdf3445d414) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Frame-to-content: frame the printed **object**, not the skirt/prime ([#306](https://github.com/ChestnutLabs/gcode-preview/issues/306) item 6). New
  `ToolpathIR.objectBounds` (extrusion of labeled objects only, `segments.object != 0`; empty when the
  file has no object labels) and a `frameContent: 'object' | 'all'` option threaded through the renderer
  (`setFrameContent`), `renderStill`, and all four adapters (`show-`-style `frame-content` attribute on the
  element). Default `'all'` (unchanged framing). `'object'` frames only the printed objects so a prime
  line or skirt at the bed edge no longer shrinks the object in view; when the file carries no object
  labels it discloses (an `E_FRAME_CONTENT_UNAVAILABLE` event) and frames all extrusion — never fabricated.

  Note: `frameContent: 'object'` engages only when the parser populated the `objects` capability (M486 /
  EXCLUDE_OBJECT / `; printing object`). Broadening object-label detection for more slicer/firmware
  variants is tracked separately.

- [#309](https://github.com/ChestnutLabs/gcode-preview/pull/309) [`1c15c5e`](https://github.com/ChestnutLabs/gcode-preview/commit/1c15c5ea38f69aba99478cec60e4a0af28b9cae4) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Surface a **structured multi-plate list** on `DialectMetadata.plates` ([#306](https://github.com/ChestnutLabs/gcode-preview/issues/306) item 3): `{ list: [{ index, name }], parsed }` — the plates discovered in a `.gcode.3mf` container and which one was parsed into this IR. A consumer can build a plate selector from data and re-parse with `parseOptions.plate` to select another, instead of scraping the `container-multiple-plates` warning string. One plate is parsed at a time — plates are never merged into one scene. Rides on the `metadata`-on-`ready` surface, so it reaches adapters with no further wiring. Absent for non-container / single-plate sources.

## 0.6.0

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
