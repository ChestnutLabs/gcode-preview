---
'@chestnutlabs/gcode-model-renderer': patch
'@chestnutlabs/gcode-preview-core': patch
---

Internal test hygiene, no API change: three module-level helpers that were exported only for their own tests (`hexToRgb`, `parsePlateConfig`, `parseObjectExtruders`) are no longer exported, and their tests now drive the same cases through the public API. None of them was re-exported from a package entry point.
