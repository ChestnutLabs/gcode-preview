# @chestnutlabs/gcode-containers

## 0.24.0

### Patch Changes

- Updated dependencies [[`eb6b74c`](https://github.com/ChestnutLabs/gcode-preview/commit/eb6b74c0f9a8a7b0e28060d672d1021dab2a63d5), [`6b03f42`](https://github.com/ChestnutLabs/gcode-preview/commit/6b03f4221e5f0a552959fbed7f85124203d42f57)]:
  - @chestnutlabs/toolpath-core@0.24.0

## 0.23.0

### Patch Changes

- [#538](https://github.com/ChestnutLabs/gcode-preview/pull/538) [`bf3513b`](https://github.com/ChestnutLabs/gcode-preview/commit/bf3513b67566cb597d2dd366e0f28c84660768a6) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - A `.gcode.3mf` with impossible machine settings no longer gives an infinite bed or a zero or negative
  build height. Backslash plate names now get the right order and thumbnails.

  Opening the file never fails because of these values. The bad value is left out, and
  `metadata.warnings` gets a `container-metadata-invalid` warning. The parse result shows that warning
  with the other container warnings. What changed in `Metadata/project_settings.config` handling:
  - **Bed.** A `printable_area` point that overflows (for example 400 digits) gives no
    `metadata.machine`. Before, the bed edge was `Infinity`, which drew an infinite build volume. A
    `printable_area` that is present but unreadable (fewer than 3 or more than 64 points, or a
    malformed point) still gives no machine, and now also adds a warning. Before, it was dropped
    silently.
  - **Height.** A `printable_height` that is zero, below zero, empty, text, `Infinity`, or not a
    string or number leaves `machine.heightMm` undefined. The bed itself is kept. Before, `"0"` and
    `""` gave a height of `0`, `"-5"` gave `-5`, `true` gave `1`, and `["250"]` gave `250`.
  - **Not an object.** A settings file that is valid JSON but not an object (`null`, an array, a
    number) now gives the warning `project_settings.config unreadable: not a JSON object`. Before,
    `null` gave a warning with an internal `TypeError` message, and an array or number gave no warning.
  - **Plate names.** A plate stored as `Metadata\plate_2.gcode` or `Metadata//plate_2.gcode` used to
    sort as plate 0, and `thumbnailsFor()` looked for `plate_0.png`. It now sorts as plate 2 and reads
    `plate_2.png`. `plates[].name` is still the name as stored in the archive.

- Updated dependencies [[`4d08cbc`](https://github.com/ChestnutLabs/gcode-preview/commit/4d08cbc86aa1672ebea6f9d312b376699db5ecf1)]:
  - @chestnutlabs/toolpath-core@0.23.0

## 0.22.0

### Patch Changes

- [#489](https://github.com/ChestnutLabs/gcode-preview/pull/489) [`f805747`](https://github.com/ChestnutLabs/gcode-preview/commit/f8057473fdd72b906562ffe4c19f838e864a3a82) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - `.gcode.3mf` plate thumbnails now reach the parse result. Bambu Studio and OrcaSlicer store each plate's
  preview as a PNG next to its G-code, and the parser ignored them. Parsing a `.gcode.3mf` now fills
  `metadata.thumbnails` with `{ width, height, mime: 'image/png', bytes }` for the plate you parse:
  - Included: `Metadata/plate_N.png`, then `Metadata/plate_N_small.png`, where the file has them.
    `top_N.png` and `pick_N.png` are not included (`pick_` is an object-id colour map, not a preview).
  - It follows `parseOptions.plate`. With no plate selected you get the first plate's images.
  - Width and height come from the PNG header. An image that is not a PNG, is over `maxMetadataBytes`
    (8 MiB), fails its CRC, or does not fit in what is left of the archive's expanded-size budget is
    dropped with a warning. The plate's G-code always loads first and is never affected.
  - New warning code `container-thumbnail-invalid` (a plain string code; existing codes are unchanged),
    used only when the image itself is bad: not a PNG, corrupt, or failing its CRC. An image dropped for
    size reuses `metadata-truncated`, whether it was over `maxMetadataBytes` or the archive's expanded-size
    budget had run out.
  - `@chestnutlabs/gcode-containers`: `OpenedContainer` gains `thumbnailsFor(plate)`, and the types
    `PlateThumbnail` / `PlateThumbnails` are exported. `plate` is the index into `plates`, not the number
    in the file name.

- Updated dependencies [[`3fe25f4`](https://github.com/ChestnutLabs/gcode-preview/commit/3fe25f4d8d66ab1f37d23892365fb33d2c813ff6)]:
  - @chestnutlabs/toolpath-core@0.22.0

## 0.21.2

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/toolpath-core@0.21.2

## 0.21.1

### Patch Changes

- [#452](https://github.com/ChestnutLabs/gcode-preview/pull/452) [`95724d5`](https://github.com/ChestnutLabs/gcode-preview/commit/95724d5e4cd5d9b09d7598f421f693c3d096efb7) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Fix a hostile `.gcode.3mf` / 3MF file freezing the load instead of failing with an error. When a compressed entry's headers claimed a small size but the data expanded past the size limit, `streamEntry` (and `extractEntry`, `openGcode3mf` plate streaming, and 3MF model loading on top of it) stopped reading and then waited forever for the decompressor, so the load never finished. It now rejects with `E_CONTAINER_LIMIT_EXPANDED` as intended. Leaving a `streamEntry` loop early (`break` / `return()`) also releases the decompressor now, where it previously stayed pending.

- [#457](https://github.com/ChestnutLabs/gcode-preview/pull/457) [`8d4464f`](https://github.com/ChestnutLabs/gcode-preview/commit/8d4464fbf9a24f942a71752838a9c0dc186917d9) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - The archive-wide expanded-size cap (`maxExpandedBytesTotal`, default 1 GiB) is now enforced. It was
  declared but never checked, so a crafted model 3MF could expand far past 1 GiB (up to 512 MB per part,
  thousands of parts) when loaded into the model viewer. Every entry extracted from one archive now
  counts toward the total. Re-reading the same entry (for example, re-opening a plate) counts once. Going
  over fails with `E_CONTAINER_LIMIT_TOTAL`, which the model viewer reports as `E_MODEL_TOO_LARGE`. The
  model viewer's total is fixed at 1 GiB, about twice what the default 5M-triangle limit lets through.

  `ContainerLimits` values are now validated: a field that is present but not a non-negative integer
  (`NaN`, `Infinity`, negative, fractional) throws `E_CONTAINER_OPTION` before anything is extracted,
  instead of silently switching that cap off. An absent field still uses its default.

  New export: `ExpansionBudget`, plus an optional `budget` argument on `extractEntry` and `streamEntry`,
  for callers that extract several entries from one archive themselves. The `cap` argument of those two
  functions is now validated the same way: a `cap` that is not a non-negative integer throws
  `E_CONTAINER_OPTION`, so passing `Infinity` to mean "uncapped" no longer works — omit `budget`/use a
  large finite `cap` instead.

  The model 3MF loader now reports every extraction failure of its parts (corrupt data, CRC mismatch) as
  a `ModelParseError` (`E_MODEL_PARSE`); a few paths used to surface a raw `ContainerError`.

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

### Minor Changes

- [#318](https://github.com/ChestnutLabs/gcode-preview/pull/318) [`959e507`](https://github.com/ChestnutLabs/gcode-preview/commit/959e50779f3e2f84672a10e0e9ec0bfc5174f691) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model-renderer): decode Bambu/Orca 3MF `paint_color` for production multicolor

  Real designer-authored Bambu Studio / OrcaSlicer 3MF files paint per-region colour with a proprietary
  `paint_color` facet attribute and keep the palette in `project_settings.config` — not in standard 3MF
  materials. `parse3mf` / `renderModelStill` now decode that facet-paint format (clean-room from the
  observed encoding, see RR-005) and read the `filament_colour` palette themselves, so a multicolor
  source model renders in its true colours without slicing. Capability-honest: `materials: 'known'`
  (or `'approximated'` when a few multi-colour facets are flattened), and still `'unavailable'` — neutral
  default, never a fabricated colour — when no palette is present.

  `@chestnutlabs/gcode-containers` gains an exported `filamentColoursFromSettings(settings)` helper so the
  "which key is the palette" semantics live in one place, shared by the toolpath and model paths.

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

### Patch Changes

- Updated dependencies [[`1029580`](https://github.com/ChestnutLabs/gcode-preview/commit/10295803839816adaed224c48eba1f74374c0c2a), [`8fec7c3`](https://github.com/ChestnutLabs/gcode-preview/commit/8fec7c3622cd2a6d6d57b43d7866cfea1cb71e09)]:
  - @chestnutlabs/toolpath-core@0.4.0

## 0.3.0

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

- [#144](https://github.com/ChestnutLabs/gcode-preview/pull/144) [`b4d91c6`](https://github.com/ChestnutLabs/gcode-preview/commit/b4d91c62b83c3e1ecb00675c229fc69e3102d621) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Fix a process crash on corrupt deflate data in `streamEntry`: an unobserved
  `DecompressionStream` writer-side rejection surfaced as an unhandled rejection even though the
  reader path already produced `E_CONTAINER_INFLATE`. The writer promise is now captured and
  re-raised as a typed `ContainerError`. Found by the new coverage-guided container fuzzing ([#131](https://github.com/ChestnutLabs/gcode-preview/issues/131));
  a minimized regression fixture is committed.
- Updated dependencies [[`c26879f`](https://github.com/ChestnutLabs/gcode-preview/commit/c26879f4148b77e5e9070bc2ee421a265c9571d3)]:
  - @chestnutlabs/toolpath-core@0.1.0
