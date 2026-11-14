# @chestnutlabs/gcode-colors

## 0.24.0

### Patch Changes

- [#599](https://github.com/ChestnutLabs/gcode-preview/pull/599) [`1ff1bbf`](https://github.com/ChestnutLabs/gcode-preview/commit/1ff1bbf7cc39b2faf9b21ecd25fac56d1b82b8bf) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - `fallback: null` now means "use the default" instead of throwing. In `tool` and `filament` colour modes, a
  `null` `fallback` behaves exactly like an omitted one (the neutral grey). A `null` `range` in `feedrate`,
  `layerHeight` and `power` mode now means "auto-range" like an omitted `range`, instead of throwing a
  `TypeError`. This lets a framework binding pass `x ?? null` straight through. Only `null` and `undefined` mean
  "unset": `false`, `0` and `''` are still bad values and throw. A required `fallback` (every other mode) and any
  other bad colour still throw a `RangeError`.

  A `range` that is not a two-element array (`5`, `{}`, `false`, `''`, `[]`, `[1, 2, 3]`) now throws a
  `RangeError` too, where `5`, `{}` and `false` used to throw a `TypeError` from the destructure. A three-element
  array was accepted before, with the third value ignored; it is now rejected, because the type is `[number, number]`.

- [#547](https://github.com/ChestnutLabs/gcode-preview/pull/547) [`b0b1922`](https://github.com/ChestnutLabs/gcode-preview/commit/b0b1922ce7a4f3c3f3952185d1fdd47fcc115480) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - A colour mode with a colour that has no rendering now throws a `RangeError` naming the mode, the field and
  the index, instead of painting garbage (NaN into the vertex buffer or canvas style).
  - **Every colour is checked:** `single.color`, each `palette` / `ramp` entry, `moveKind` `cut` / `travel`
    and every `fallback`. A colour is an array-like (plain array, readonly tuple, `Float32Array`) whose first
    three entries are finite numbers; extra entries (an alpha) are ignored and any finite value is accepted,
    so a 4-element or 0-255 colour that rendered before still does. NaN, ±Infinity, fewer than three entries
    or a non-array now throw, e.g. `tool color mode palette[2] must be [r, g, b] of three finite numbers, got
[0.1, NaN, 0.3]`.
  - **`fallback` is required** in `feature`, `colorChange`, `feedrate`, `layerHeight`, `power`, `object` and
    `moveKind` mode (the types already require it) and optional only in `tool` and `filament`. An empty
    palette or ramp is still valid and colours every segment with the fallback.
  - **Callers inherit it:** `createSegmentColorer`, `segmentColor`, the `colorMode` option and
    `setColorMode` of the Canvas 2D `LayerView2D` and the preview controller all call `checkColorMode`, so a
    bad mode throws at the call and is never stored.
  - A one-stop ramp now returns a fresh colour array instead of the ramp's own entry.

- Updated dependencies [[`eb6b74c`](https://github.com/ChestnutLabs/gcode-preview/commit/eb6b74c0f9a8a7b0e28060d672d1021dab2a63d5), [`6b03f42`](https://github.com/ChestnutLabs/gcode-preview/commit/6b03f4221e5f0a552959fbed7f85124203d42f57)]:
  - @chestnutlabs/toolpath-core@0.24.0

## 0.23.0

### Minor Changes

- [#539](https://github.com/ChestnutLabs/gcode-preview/pull/539) [`d0c3fcc`](https://github.com/ChestnutLabs/gcode-preview/commit/d0c3fcc59e7973bcb0d39ba2278f830daa02fedd) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Colour modes now reject options that have no meaning, and a hostile file can no longer distort or break colouring.
  - **Bad colour options throw a `RangeError` when you set them.** In `feedrate`, `layerHeight` and `power`
    mode, an explicit `range` must be two finite numbers `>= 0`, in ascending order. An inverted range such as
    `[2000, 1000]` now throws; for a reversed scale, reverse the `ramp` instead. In `object` mode, `only` must
    be a 1-based integer. Before, `range: [0, NaN]` or `only: 0` silently painted every segment one colour. A
    point range such as `[1500, 1500]` is still valid and paints every segment the ramp's first colour.
  - **Where it throws.** `controls.setColorMode(mode)` (in Vue, React, Svelte and the Web Component too) and
    the `colorMode` option throw synchronously, before anything is stored, so the previous mode stays in
    effect, even if the call comes before the viewer has loaded. The same goes for `LayerView2D`'s constructor
    and `setColorMode`, and for `createSegmentColorer`. To validate a mode built from user input yourself,
    call the new `checkColorMode(mode)`. It's exported from `@chestnutlabs/gcode-colors` and
    `@chestnutlabs/gcode-renderer-2d`.
  - **`segmentColor(ir, mode, i)` throws a `RangeError` for an index outside `[0, segments.count)`.** It used
    to return `undefined`. The per-segment function returned by `createSegmentColorer` is unchanged.
  - **A negative `F` or `S` in the file is drawn in `fallback`.** It is also left out of the auto-range, like
    NaN and Infinity already were, so one hostile `G1 F-99999` can no longer stretch the speed scale and wash
    out every other segment.
  - **`filament` colour mode ignores impossible filament slots.** A slot from file metadata that is not an
    integer from 0 to 63 is dropped. Before, a fractional slot threw while the palette was built. Gaps in the
    palette now use your `fallback`, not always the default grey.
  - **`filament` colour mode no longer borrows colours.** When a file uses a tool or a colour-change slot that
    it declared no filament colour for, those segments are drawn in `fallback`. Before, the palette wrapped,
    so `T3` in a file with two filament colours was drawn in the second filament's colour.

### Patch Changes

- Updated dependencies [[`4d08cbc`](https://github.com/ChestnutLabs/gcode-preview/commit/4d08cbc86aa1672ebea6f9d312b376699db5ecf1)]:
  - @chestnutlabs/toolpath-core@0.23.0

## 0.22.0

### Patch Changes

- [#500](https://github.com/ChestnutLabs/gcode-preview/pull/500) [`3fe25f4`](https://github.com/ChestnutLabs/gcode-preview/commit/3fe25f4d8d66ab1f37d23892365fb33d2c813ff6) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Files with a number too large for the toolpath's 32-bit channels (for example `G1 X10 F` followed by a 40-digit value) no longer break color-by-speed, color-by-power, color-by-layer-height, or the time axis.
  - `@chestnutlabs/gcode-colors`: color-by-speed used to throw a `TypeError` on such a segment and paint every other segment the ramp start colour. The auto-ranges (`feedrateRange`, `toolPowerRange`, `layerHeightRange`) now skip infinite values, so the scale comes from the real values and an infinite value shows as the ramp end. A value that has no place on the ramp (NaN, or an infinite value on an infinite explicit `range`) shows the mode's `fallback`. `rampColor(ramp, NaN)` returns the ramp start instead of throwing.
  - `@chestnutlabs/toolpath-core`: `computeToolpathTime` used to return `NaN` for the total and for every later segment. A segment with a non-finite length now adds 0 ms and sets `hasUnknownFeedrate` (the estimate is a lower bound).
  - `@chestnutlabs/toolpath-core`: `createProgressMapper().observe(null)`, or any other value that is not an object, now returns `unavailable` with a `version-unsupported` note instead of throwing.
  - `@chestnutlabs/toolpath-core`: `ToolpathIRBuilder.addRetraction` / `addColorChange` called before the first `addSegment` now store their position in the same origin-relative frame as the segments. Before, the position was offset by the first segment's start point.

- Updated dependencies [[`3fe25f4`](https://github.com/ChestnutLabs/gcode-preview/commit/3fe25f4d8d66ab1f37d23892365fb33d2c813ff6)]:
  - @chestnutlabs/toolpath-core@0.22.0

## 0.21.2

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.21.2

## 0.21.1

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.21.0

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

### Patch Changes

- Updated dependencies [[`214b0db`](https://github.com/ChestnutLabs/gcode-preview/commit/214b0db2dd9d8aa177d80969bdb59173d33121a3)]:
  - @chestnutlabs/toolpath-core@0.17.0

## 0.16.0

### Patch Changes

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

### Minor Changes

- [#364](https://github.com/ChestnutLabs/gcode-preview/pull/364) [`f14849d`](https://github.com/ChestnutLabs/gcode-preview/commit/f14849d5f88eb9957a75bccf2f14da75ebb44a4e) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(color): `filament` colour mode — render a toolpath in the file's own filament colours (DD-024)

  Adds a `{ mode: 'filament' }` colour mode: colour a toolpath by the source's OWN filament colours
  (`metadata.filaments[].color`, from the g-code header / slicer metadata), so a consumer needn't extract and
  re-supply a palette gcode-preview already knows. Because those colours live in parse **metadata** (not the
  IR), the `gcode-preview-core` controller resolves the mode against each file's metadata **before the build** —
  multi-extruder files colour by tool, colour-change (M600) files by swap slot — so the **first visible pass is
  already coloured**, eliminating the neutral-then-recolour flash on raw `.gcode`. Honesty preserved: with no
  usable filament colours the render stays neutral (never a fabricated palette); the mode reaching the IR-only
  colorer unresolved is likewise honestly neutral. Fixes the raw-g-code (e.g. Dune Striker) colour flash
  renderer-side, no consumer palette extraction required.

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

- [#254](https://github.com/ChestnutLabs/gcode-preview/pull/254) [`5f59b77`](https://github.com/ChestnutLabs/gcode-preview/commit/5f59b7788bbb14cacfe21aaf3d7134c6ba8dcd86) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat: non-extrusion color modes — color-by-power + cut-vs-rapid (DD-012 phase 4, [#189](https://github.com/ChestnutLabs/gcode-preview/issues/189))

  Two new `ColorMode`s consuming the [#189](https://github.com/ChestnutLabs/gcode-preview/issues/189) channels (DD-012 D7):
  - **`power`** — ramps each segment's modal `toolPower` (laser power / spindle RPM, the `S` value) onto
    a color ramp, the CNC/laser counterpart to color-by-speed. Auto-ranged (`toolPowerRange`) or explicit;
    `NaN` (tool off) or a file parsed without the `toolPower` channel → fallback, never a fabricated color.
    Capability-gated on `toolPower` (the Three renderer's `isColorModeAvailable` gates it).
  - **`moveKind`** — cut-vs-rapid: productive moves (`Extrude` or `Cut`) vs rapids (`Travel`) — the
    "where the tool is actually working" view. Reads the always-present `kind` channel, so it is always
    available.

  Both flow through `createSegmentColorer`, so the Three and Canvas-2D renderers get them for free. FDM
  coloring is unchanged.

### Patch Changes

- Updated dependencies [[`1029580`](https://github.com/ChestnutLabs/gcode-preview/commit/10295803839816adaed224c48eba1f74374c0c2a), [`8fec7c3`](https://github.com/ChestnutLabs/gcode-preview/commit/8fec7c3622cd2a6d6d57b43d7866cfea1cb71e09)]:
  - @chestnutlabs/toolpath-core@0.4.0

## 0.3.0

### Minor Changes

- [#230](https://github.com/ChestnutLabs/gcode-preview/pull/230) [`e8f889b`](https://github.com/ChestnutLabs/gcode-preview/commit/e8f889b576ee06da4181a048724c880ae38fedee) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add a **color-by-layer-height** mode ([#179](https://github.com/ChestnutLabs/gcode-preview/issues/179)) — the Orca/Bambu view that reveals variable-layer-height
  prints.
  - `gcode-colors`: new `ColorMode` variant `{ mode: 'layerHeight'; ramp; range?; fallback }`, plus
    `layerHeights(ir)` (per-layer Z-delta; layer 0 is its thickness from the bed; negative deltas clamp
    to 0) and `layerHeightRange(ir)` (the auto-range). Each segment is colored by its layer's height
    mapped onto the ramp. Derived purely from `ir.layers` — no new parsing.
  - `gcode-renderer-three`: re-exports `layerHeightRange`, and `isColorModeAvailable('layerHeight')` is
    **capability-gated on `layers`** — a non-planar/CNC IR (`layers: 'unavailable'`) reports the mode
    unavailable rather than collapsing every segment to one flat color.

  Additive; works through the existing rich `colorMode` prop on every adapter with no adapter change.

- [#217](https://github.com/ChestnutLabs/gcode-preview/pull/217) [`17e9951`](https://github.com/ChestnutLabs/gcode-preview/commit/17e995123fa68274d508527261161741955b0647) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - E8 phase 1 ([#212](https://github.com/ChestnutLabs/gcode-preview/issues/212), DD-014): the low-resource 2D renderer's foundation — two new lockstep packages and
  a boundary-preserving refactor. Additive; no IR/parser change, no change to the default (`'3d'`)
  behavior or any existing public API.
  - **`@chestnutlabs/gcode-colors`** (new): the renderer-agnostic home for the whole color subsystem
    (DD-014 D3). Exports the `ColorMode` union (`single`/`tool`/`feature`/`colorChange`/`feedrate`/
    `object`), `createSegmentColorer(ir, mode)` / `segmentColor`, `feedrateRange`, `rampColor`, and
    `RGB`. Depends only on `@chestnutlabs/toolpath-core` — no `three`, no framework. Every mode degrades
    unknown channel values to its fallback, never a fabricated color.
  - **`@chestnutlabs/gcode-renderer-2d`** (new): an opt-in Canvas 2D current-layer renderer over the
    existing `ToolpathIR` for low-GPU / low-memory / WebGL-blocked devices (DD-014 D1/D4). `LayerView2D`
    plus the pure `drawLayer` / `computeLayerFit` / `layerBounds2D` / `rgbToCss` core. Depends only on
    `toolpath-core` + `gcode-colors` — no `three`, no framework. Memory is bounded to the active layer.
  - **`@chestnutlabs/gcode-renderer-three`**: the per-segment color logic moved to `gcode-colors`;
    `colors.ts` now re-exports `ColorMode`/`RGB`/`feedrateRange` and `buildChunkColors` maps the shared
    colorer onto the Three.js vertex buffer. Public API and behavior unchanged (parity test).

### Patch Changes

- Updated dependencies [[`39348de`](https://github.com/ChestnutLabs/gcode-preview/commit/39348de9ce68717e71516f9acaccd475139983ba), [`d161e80`](https://github.com/ChestnutLabs/gcode-preview/commit/d161e802e36cc87fa27848ceef9d68cd45628760), [`82bd7ae`](https://github.com/ChestnutLabs/gcode-preview/commit/82bd7ae7f76e742767719d8efa11173a6548fc03)]:
  - @chestnutlabs/toolpath-core@0.3.0
