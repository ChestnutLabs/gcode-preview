---
'@chestnutlabs/toolpath-core': minor
'@chestnutlabs/gcode-parser': minor
'@chestnutlabs/gcode-dialects': minor
'@chestnutlabs/gcode-containers': minor
'@chestnutlabs/gcode-renderer-three': minor
'@chestnutlabs/gcode-preview-core': minor
'@chestnutlabs/gcode-preview-vue': minor
'@chestnutlabs/gcode-preview-react': minor
'@chestnutlabs/gcode-preview-svelte': minor
---

First published line of the Chestnut Labs G-code Preview stack (`v0.1.0`, DD-008): worker-based
`.gcode` / `.gcode.3mf` parsing into a versioned `ToolpathIR`, cross-vendor dialect annotation
(PrusaSlicer, Orca/Bambu, Cura, Klipper, Marlin, RepRap-flavor), a Three.js renderer with layer
clipping, scrub, tubes, build plates and the honest live-progress overlay, a framework-neutral
preview controller, and first-class Vue/React/Svelte adapters with capability parity.
