# @chestnutlabs/gcode-containers

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
