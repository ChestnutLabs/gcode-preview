# @chestnutlabs/gcode-dialects

## 0.20.1

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.20.1

## 0.20.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [[`81690dc`](https://github.com/ChestnutLabs/gcode-preview/commit/81690dcfece21d6fd11074ad7a264bcfc9edf455)]:
  - @chestnutlabs/toolpath-core@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.18.0

## 0.17.0

### Minor Changes

- [#405](https://github.com/ChestnutLabs/gcode-preview/pull/405) [`a2f3d56`](https://github.com/ChestnutLabs/gcode-preview/commit/a2f3d56613ac27c3eed26cafcf913c9d8f23cec2) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(orca-bambu): FLUSH/WIPE_TOWER housekeeping brackets (DD-026 D3)

  The OrcaSlicer/Bambu adapter now recognises Bambu's bare `FLUSH_START/END` (multi-material purge) and
  `WIPE_TOWER_START/END` comment brackets and maps the enclosed range to `FeatureRole.Purge` /
  `FeatureRole.WipeTower` (RR-007 §5). The brackets are applied **after** the `;TYPE:` / `; FEATURE:`
  markers so the explicit bracket wins over the surrounding role, and the non-model classifier (DD-026 D4)
  then excludes them from `modelBounds` — so a plate whose flush/wipe-tower sits far from the parts frames
  the model rather than the purge column, even without an object channel.

  Shares the wipe bracket's balancing logic via a new internal `forEachBracketRange` helper (a stray END
  is ignored, a second START folds in, an unclosed START closes at EOF) — `applyWipeRanges` is refactored
  onto it with byte-identical behaviour. `matchBracketComment` / `applyFeatureBracketRanges` /
  `BracketMark` are internal annotate helpers (not re-exported), mirroring the existing wipe bracket.

  Additive feature-channel coverage only; FDM geometry unchanged (the golden corpus carries no
  flush/wipe-tower brackets, so no goldens move).

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

### Patch Changes

- Updated dependencies [[`214b0db`](https://github.com/ChestnutLabs/gcode-preview/commit/214b0db2dd9d8aa177d80969bdb59173d33121a3)]:
  - @chestnutlabs/toolpath-core@0.17.0

## 0.16.0

### Minor Changes

- [#383](https://github.com/ChestnutLabs/gcode-preview/pull/383) [`affc879`](https://github.com/ChestnutLabs/gcode-preview/commit/affc8796583be309ce469969f2777a833253549a) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(dialects): ideaMaker adapter — `;TYPE:` roles + `PRINTING_ID` object membership (DD-026 T1)

  New `ideaMaker()` dialect adapter (RR-007 §5.6), registered in the built-in worker set. It captures
  ideaMaker's UPPERCASE `;TYPE:` feature roles and — crucially for `frameContent:'object'` — object
  membership from ideaMaker's `;PRINTING: <name>` + `;PRINTING_ID: <n>` STATE channel: `PRINTING_ID:
-1` (with `;PRINTING: NON-OBJECT`) is housekeeping, `n≥0` is the printed object. Housekeeping (raft,
  wipe tower) emitted under NON-OBJECT is correctly excluded from the object channel, so ideaMaker files
  frame the model rather than the raft/tower. FDM geometry unchanged.

- [#384](https://github.com/ChestnutLabs/gcode-preview/pull/384) [`41d2dcf`](https://github.com/ChestnutLabs/gcode-preview/commit/41d2dcf49d28268c13d4d1dbaf4604a9efaacfaf) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(dialects): Simplify3D adapter — `; feature <lowercase>` roles (DD-026 T1)

  New `simplify3d()` dialect adapter (RR-007 §5.5), registered in the built-in worker set. It captures
  Simplify3D's lowercase `; feature <token>` vocabulary (`skirt`, `outer perimeter`, `inner perimeter`,
  `infill`, `solid layer`, `support`, `raft`, `prime pillar`, `ooze shield`, …) as feature roles.
  Simplify3D output has **no** object-membership channel, so `objects` stays honestly `unavailable`
  rather than a fabricated membership — object framing falls back to feature-role classification
  (DD-026 T2). Prime pillar / ooze shield map to the generic `Custom` role, never treated as model.
  FDM geometry unchanged.

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

### Patch Changes

- [#381](https://github.com/ChestnutLabs/gcode-preview/pull/381) [`3905178`](https://github.com/ChestnutLabs/gcode-preview/commit/39051787497610c9aec1c5950fe1d52bcd375582) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - fix(orca-bambu): capture real OrcaSlicer `;TYPE:` features and `; printing object` labels (DD-026 T1)

  The Orca/Bambu adapter only matched Bambu Studio's `; FEATURE:` comments and a `; start printing
object, id:<n>` object marker. Real OrcaSlicer / AnycubicSlicerNext output (RR-007 §5.8) uses
  `;TYPE:<vocab>` for features and `; printing object <name> id:<id>` (no "start", and the id can
  exceed Uint32) — so those files got **no** feature roles and **no** object channel, which left
  `frameContent:'object'` with an empty `objectBounds` (it framed all extrusion, including a bed-edge
  prime line).

  The adapter now accepts `;TYPE:` in addition to `; FEATURE:` (same Orca vocabulary), and matches the
  object-start marker across all lineage formats (Bambu `start printing object, unique label id:` with a
  trailing `name:`; OrcaSlicer `printing object <name> id:<big id>`; AnycubicSlicer/Prusa-lineage
  `printing object "<name>" id:<n> copy <m>`). Each distinct object id maps to a sequential 1-based
  channel value (raw ids can exceed Uint32), reused across per-layer re-bracketing. Real OrcaSlicer
  files without `EXCLUDE_OBJECT` now resolve `featureRoles:'known'` + `objects:'known'`, restoring
  object-aware framing. FDM geometry unchanged.

- [#382](https://github.com/ChestnutLabs/gcode-preview/pull/382) [`0ef33fe`](https://github.com/ChestnutLabs/gcode-preview/commit/0ef33fecfc08dcf5db2d3ce5c84bbe86fbb867fa) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - fix(prusaslicer): capture `; printing object` labels; share the object-marker parser (DD-026 T1)

  The PrusaSlicer adapter captured feature roles but **no** object channel, so a Prusa file sliced with
  _Label objects_ on (RR-007 §5.1 — `; printing object <name> id:<n> copy <m>`) left
  `frameContent:'object'` with an empty `objectBounds`. It now tracks object membership.

  The object-start parsing (across all Prusa/Orca/Bambu lineage formats) is extracted into a shared
  `PrintingObjectTracker` (`object-markers.ts`); the OrcaSlicer/Bambu adapter is refactored onto it, so
  the two adapters can't drift. Each distinct slicer id maps to a sequential 1-based channel value (raw
  ids can exceed Uint32). FDM geometry unchanged.

- Updated dependencies [[`bf032d2`](https://github.com/ChestnutLabs/gcode-preview/commit/bf032d2b4e0ce36dcbd8020caead2a512ca3b618)]:
  - @chestnutlabs/toolpath-core@0.16.0

## 0.15.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.11.0

## 0.10.0

### Patch Changes

- [#336](https://github.com/ChestnutLabs/gcode-preview/pull/336) [`77a42f3`](https://github.com/ChestnutLabs/gcode-preview/commit/77a42f384f76272a9ee6f55e967fc89c3cadd4d5) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - fix(dialects): refresh `objectBounds` after object labels are annotated (frame-to-content on AnycubicSlicerNext & all labeled files)

  `ir.objectBounds` (the extrude bounds of labeled objects, excluding skirt/prime/purge — used by
  `frameContent: 'object'`, [#306](https://github.com/ChestnutLabs/gcode-preview/issues/306)/[#6](https://github.com/ChestnutLabs/gcode-preview/issues/6)) was computed by the parse core **before** dialects assign the object
  channel, so it stayed empty (Infinity) even when objects were present, and `frameContent: 'object'`
  silently fell back to `'all'`. On files with a large prime/purge column (e.g. AnycubicSlicerNext
  multi-object prints) that framed the part small and off-center.

  The dialect annotation pass now refreshes `objectBounds` after it fills the object channel, so
  `frameContent: 'object'` frames the printed object rather than the whole build volume. This fixes it for
  **every** dialect that labels objects (Klipper `EXCLUDE_OBJECT`, Marlin `M486`, Orca/Bambu `printing
object`), not just AnycubicSlicerNext. Object-label parsing itself was already correct — this was stale
  derived bounds. Empty-when-no-labels behavior is unchanged (the honest "no object info" default).

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.9.0

## 0.8.1

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [[`39ede6e`](https://github.com/ChestnutLabs/gcode-preview/commit/39ede6ebc0a1ba594a391f1b33db2bdf3445d414), [`1c15c5e`](https://github.com/ChestnutLabs/gcode-preview/commit/1c15c5ea38f69aba99478cec60e4a0af28b9cae4)]:
  - @chestnutlabs/toolpath-core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.6.0

## 0.5.2

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.5.0

## 0.4.0

### Minor Changes

- [#258](https://github.com/ChestnutLabs/gcode-preview/pull/258) [`3f06e5b`](https://github.com/ChestnutLabs/gcode-preview/commit/3f06e5b7b6926daaad4290b29c577a380c9e10df) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat: evidence-based non-extrusion detection — recognize header-less real CNC/laser files ([#189](https://github.com/ChestnutLabs/gcode-preview/issues/189))

  The phase-3 CNC/laser detectors were tuned on synthetic fixtures and matched **none** of the real
  public samples (LaserGRBL, LinuxCNC, GRBL CAM output) — real controller output usually has **no
  generator header** and writes commands **mid-line** and **concatenated** (`s3400 m3`, `g1z-.1`).

  Detection is now **evidence-scored**, not banner-only:
  - A shared `scoreEvidence` extractor strips comments (so `(M3)` / `; LinuxCNC` in a comment can't
    create a false marker) and matches commands as words anywhere on a line.
  - **GRBL laser** — LightBurn / `$32=1`, **or** the header-less form: a tool-on command (`M3`/`M4`) with
    `S` power and **no Z-plunge** (lasers are planar).
  - **GRBL / generic mill** — `M3` spindle that **plunges into negative Z** with no extrusion (a milling
    fingerprint that separates it from a planar laser); banner optional.
  - **LinuxCNC** — explicit header, **or** RS274NGC **O-word** subroutines/flow (`o100 sub`).
  - Extrusion detection tightened to `E` on a **motion line**, so LinuxCNC `M67 E0 Q…` analog laser power
    is no longer mistaken for FDM.

  Real-file result: **0/6 → 3/6 detected, each with the correct machine class** (laser→laser, mill→mill,
  LinuxCNC→linuxcnc); the misses are honest — files with a commented-out or absent spindle carry no
  tool-state to infer. Still **experimental tier** (claims reported `inferred`) — detection working on
  real files is one input; semantic ground truth (does our `Cut` = actual cutting, `S` scale) still wants
  a real machine or a trusted reference.

- [#253](https://github.com/ChestnutLabs/gcode-preview/pull/253) [`13fd5c6`](https://github.com/ChestnutLabs/gcode-preview/commit/13fd5c61d730428a7f7e73c28cf3cc9c48e68c19) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat: non-extrusion dialect families + validation tiers (DD-012 phase 3, [#189](https://github.com/ChestnutLabs/gcode-preview/issues/189))

  Adds controller detection and the **validation-tier honesty mechanism** for CNC/laser toolpaths:
  - New dialects (`@chestnutlabs/gcode-dialects`): **GRBL laser** (LightBurn / `$32` laser mode / `M4`+`S`),
    **GRBL mill** and **LinuxCNC** (`M3` spindle, `%`/banner envelopes). Registered in the batteries worker.
  - Each dialect adds provenance (`cnc.controller`, `cnc.machineClass`, `cnc.toolPowerLabel`) and a
    **validation tier** (`cnc.validationTier`). Per DD-012 D6: an **experimental** dialect reports its
    non-extrusion claims (`cutMoves` / `toolPower` / `cannedCycles`) as **`inferred`** (never `known`),
    with a `cnc-dialect-experimental` disclosure — and only for claims the file actually made (an unused
    feature is never fabricated).
  - **All launch dialects ship `experimental`** (synthetic fixtures only). A single `tier: 'validated'`
    flip per controller promotes its claims to `known` once confirmed on real hardware (DD-012 §8/§15).

  Geometry is untouched (dialects only annotate/label). FDM detection is unaffected — CNC dialects do
  not match FDM output.

- [#262](https://github.com/ChestnutLabs/gcode-preview/pull/262) [`3e244ae`](https://github.com/ChestnutLabs/gcode-preview/commit/3e244aee86463f2a8c030b3793d3bb2dd462e3a9) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(dialects): promote grbl-laser experimental → validated on hardware evidence ([#189](https://github.com/ChestnutLabs/gcode-preview/issues/189))

  First hardware-validation pass (DD-012 D8): a real GRBL/LightBurn diode-laser run — 6161 moves incl.
  fill + offset-fill, full 0–1000 `S` power ramp — confirmed machine-class detection, the Cut-vs-rapid
  split, and the `toolPower` channel against the physical cut (all claims ✓). `grbl-laser` is flipped
  `experimental → validated`: for laser files its `cutMoves`/`toolPower` claims now report **`known`**
  instead of `inferred`, and the `cnc-dialect-experimental` warning is no longer emitted.

  Scope is per-controller: `grbl-mill` and `linuxcnc` remain `experimental` (claims stay `inferred`)
  until a run on real CNC hardware. Evidence recorded in `docs/design/DD-012-hardware-validation-log.md`.

### Patch Changes

- Updated dependencies [[`1029580`](https://github.com/ChestnutLabs/gcode-preview/commit/10295803839816adaed224c48eba1f74374c0c2a), [`8fec7c3`](https://github.com/ChestnutLabs/gcode-preview/commit/8fec7c3622cd2a6d6d57b43d7866cfea1cb71e09)]:
  - @chestnutlabs/toolpath-core@0.4.0

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

- [#228](https://github.com/ChestnutLabs/gcode-preview/pull/228) [`2d2b32b`](https://github.com/ChestnutLabs/gcode-preview/commit/2d2b32b836b296f2fac460073df10a7796596e9f) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Populate the `MoveKind.Wipe` bit from slicer wipe brackets (DD-016 phase 1, [#182](https://github.com/ChestnutLabs/gcode-preview/issues/182)).

  The `Wipe`/`Seam` kind bits were reserved but never set. Wipe's only reliable signal is a
  slicer comment (`;WIPE_START`/`;WIPE_END`), which the DD-005 sink invariant bars the annotation
  layer from turning into `kind`. DD-016 resolves this with a **narrow, additive** sink amendment:
  - `AnnotationSink.addMoveKind(segStart, segEnd, kindBits)` — allow-listed to `Wipe`/`Seam` only,
    additive (ORs the bit, never clears or reclassifies a move); non-allow-listed bits are dropped
    with a bounded warning.
  - The PrusaSlicer and Orca/Bambu adapters detect `;WIPE_START`/`;WIPE_END` and mark the bracketed
    segments as `Wipe`.
  - New capabilities: `wipeMoves` (`known` when a bracket was parsed, else `unavailable` — never
    fabricated) and `seamMoves` (always `unavailable`; seam has no per-move G-code signal).

  Golden-safe: the base Extrude/Travel classification is unchanged, so the golden-equivalence gate
  (kind masked to `Extrude|Travel`) is byte-identical; only the additive `wipeMoves`/`seamMoves`
  capability lines were regenerated in the native goldens. No IR schema change, no new dependency.
  Renderer visibility for wipe moves lands in phase 2.

### Patch Changes

- Updated dependencies [[`39348de`](https://github.com/ChestnutLabs/gcode-preview/commit/39348de9ce68717e71516f9acaccd475139983ba), [`d161e80`](https://github.com/ChestnutLabs/gcode-preview/commit/d161e802e36cc87fa27848ceef9d68cd45628760), [`82bd7ae`](https://github.com/ChestnutLabs/gcode-preview/commit/82bd7ae7f76e742767719d8efa11173a6548fc03)]:
  - @chestnutlabs/toolpath-core@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`1c2e5b0`](https://github.com/ChestnutLabs/gcode-preview/commit/1c2e5b031845630a6f82501de51e1ae902d52559), [`11c75bd`](https://github.com/ChestnutLabs/gcode-preview/commit/11c75bd540c1490f888ec9ecee64814cafb25156)]:
  - @chestnutlabs/toolpath-core@0.2.0

## 0.1.0

### Minor Changes

- [#141](https://github.com/ChestnutLabs/gcode-preview/pull/141) [`c26879f`](https://github.com/ChestnutLabs/gcode-preview/commit/c26879f4148b77e5e9070bc2ee421a265c9571d3) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - First published line of the Chestnut Labs G-code Preview stack (`v0.1.0`, DD-008): worker-based
  `.gcode` / `.gcode.3mf` parsing into a versioned `ToolpathIR`, cross-vendor dialect annotation
  (PrusaSlicer, Orca/Bambu, Cura, Klipper, Marlin, RepRap-flavor), a Three.js renderer with layer
  clipping, scrub, tubes, build plates and the honest live-progress overlay, a framework-neutral
  preview controller, and first-class Vue/React/Svelte adapters with capability parity.

### Patch Changes

- Updated dependencies [[`c26879f`](https://github.com/ChestnutLabs/gcode-preview/commit/c26879f4148b77e5e9070bc2ee421a265c9571d3)]:
  - @chestnutlabs/toolpath-core@0.1.0
