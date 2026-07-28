# @chestnutlabs/gcode-dialects

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
