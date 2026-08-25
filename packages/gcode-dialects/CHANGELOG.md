# @chestnutlabs/gcode-dialects

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
