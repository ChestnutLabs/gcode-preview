---
"@chestnutlabs/gcode-renderer-three": patch
---

Fix `capture()` returning too-dark (linear colour-space) pixels. The interactive capture path rendered into a render target without sRGB output encoding, so `controls.capture()` and `ModelViewer.capture()` read back linear-space pixels — backgrounds and geometry colours came out darker than both the live canvas and `renderStill` (e.g. a `#6d7176` background captured as `#272a2e`). The capture render target now declares sRGB, so captured images match the on-screen view.
