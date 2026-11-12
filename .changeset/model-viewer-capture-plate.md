---
'@chestnutlabs/gcode-model-renderer': patch
---

A model-viewer capture with `includeBuildVolume: false` no longer hides the plate from live frames while the image
encodes. The plate is hidden only for the off-screen render and restored before the encode starts, so a frame drawn
during the encode, or a second capture started meanwhile, still shows it. The same holds when the capture fails.
