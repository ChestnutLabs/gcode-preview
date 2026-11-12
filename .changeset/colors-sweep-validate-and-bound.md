---
'@chestnutlabs/gcode-colors': minor
'@chestnutlabs/gcode-renderer-2d': minor
'@chestnutlabs/gcode-preview-core': patch
---

Colour modes now reject options that have no meaning, and a hostile file can no longer distort or break colouring.

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
