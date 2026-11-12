---
'@chestnutlabs/gcode-preview-core': patch
---

`renderStill` now rejects options that would draw a blank or broken still, instead of rendering one silently.

- **It rejects with a `RangeError` before any parse or GL work** (no worker starts, no renderer is created) when:
  - the output size is not a finite number greater than 0 (`width` / `height`, or the canvas's own size when
    you omit them, so a 0×0 canvas with no explicit size now rejects);
  - `camera.fov` is outside [10, 120]. This is the rule `cameraFov` already had. Before, a pose `fov` of 0 or
    `NaN` went straight onto the camera;
  - `camera.position` or `camera.target` is not three finite numbers;
  - `scrub` or either `layerRange` bound is `NaN` or not a number. `null` and `±Infinity` are still fine, and
    `Infinity` still means "the whole model".
- No other behaviour changes. A failed geometry build still rejects with `RenderStillError`, and the internal
  renderer is still disposed on every outcome.
