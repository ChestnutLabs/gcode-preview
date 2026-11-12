---
'@chestnutlabs/gcode-renderer-three': patch
---

Bad camera, capture, colour-mode and progressive-preview input now throws a clear `RangeError` instead of
blanking the view or silently doing the wrong thing, and a capture without the build volume no longer
leaves it hidden.

- **Invalid input is rejected up front and changes nothing.** `setCameraState` (non-finite position or
  target, a `zoom` that is not a finite number above 0, an unknown `cameraMode`), `setCameraMode` and the
  `cameraMode` option, capture `width` / `height` (non-finite, over 16384 px a side, or
  over about 67 megapixels), the `colorMode` option and `setColorMode` (inverted or negative range, bad
  object index), and `progressivePreview` / `setProgressivePreview` all throw a `RangeError` before any
  state is touched. `setCameraState` previously accepted a NaN pose that blanked the view for good.
- **A capture without the build volume hides it only for the render.** It is no longer hidden across the
  async encode, so an overlapping capture or a live frame can no longer see the volume hidden or "restore"
  it to hidden. A volume you had already hidden stays hidden.
- **A bare click no longer disturbs the render quality.** A pointer click with no movement used to write a
  stale resolution ratio back over the renderer's own when interaction quality was `auto`.
- **`handleGeometryMessage` and the `GeometryBuildError` type are now exported** beside
  `handleGeometryRequest`. If you build your own geometry worker, call `handleGeometryMessage` so a failed
  build comes back tagged with its request id and the pool fails only that request.
