---
'@chestnutlabs/gcode-renderer-three': patch
'@chestnutlabs/gcode-model-renderer': patch
---

A theme value the viewer can't draw now throws a `RangeError` that names the field, instead of quietly
drawing something else. This covers the toolpath viewer and the model viewer, whose plate uses the same
theme. Valid themes, the defaults and both `studioTheme()` presets look exactly as before.

- **Light intensities:** `hemisphereIntensity` and `directionalIntensity` must be finite numbers `>= 0`.
  Before, `NaN`, `Infinity` or a negative value went straight to the lights.
- **Plate:** `bedSurface.opacity` must be in `[0, 1]`. `bedSurface.thickness` must be a finite number
  `>= 0`: before, a negative or `NaN` thickness silently drew no walls, and `Infinity` produced broken
  geometry.
- **Typos now throw (behaviour change):** a `bedSurface.mode` other than `'none'` or `'solid'` used to
  draw no plate, and a `materialPreset` other than `'matte'` or `'glossy'` used to fall back to matte.
  Both now throw and list the accepted values. If you pass an untyped or user-edited theme, check these
  two fields.
- **`createContactShadow(footprint, opacity)`:** throws for an `opacity` outside `[0, 1]`. A footprint
  with an infinite or `NaN` extent (it comes from file data) now draws no shadow, as an empty one already
  did.
- **`lensScale(from, to)`:** throws for a field of view outside `[10, 120]` degrees, like `cameraFov`.
- **Renderer detection:** a GPU string ending in `"AMD "` now classifies as hardware (the trailing space
  was trimmed away before).

Colour strings are not checked yet.
