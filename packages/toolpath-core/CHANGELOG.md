# @chestnutlabs/toolpath-core

## 0.1.0

### Minor Changes

- [#141](https://github.com/ChestnutLabs/gcode-preview/pull/141) [`c26879f`](https://github.com/ChestnutLabs/gcode-preview/commit/c26879f4148b77e5e9070bc2ee421a265c9571d3) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - First published line of the Chestnut Labs G-code Preview stack (`v0.1.0`, DD-008): worker-based
  `.gcode` / `.gcode.3mf` parsing into a versioned `ToolpathIR`, cross-vendor dialect annotation
  (PrusaSlicer, Orca/Bambu, Cura, Klipper, Marlin, RepRap-flavor), a Three.js renderer with layer
  clipping, scrub, tubes, build plates and the honest live-progress overlay, a framework-neutral
  preview controller, and first-class Vue/React/Svelte adapters with capability parity.
