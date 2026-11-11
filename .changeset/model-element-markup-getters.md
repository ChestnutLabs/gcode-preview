---
'@chestnutlabs/gcode-preview-element': patch
---

`<gcode-model-viewer>`'s `pixelRatio`, `cameraFov` and `background` properties now return a value given
in markup or with `setAttribute`. They used to read `undefined` until the property was set, although the
value was applied. `background` has had this gap since v0.20.0.

An attribute changed while the element is disconnected now applies when it reconnects, and is what the
property reads. An invalid `pixel-ratio` or `camera-fov` attribute is still ignored, and the last valid
value is kept. These properties still do not write back to their attributes.
