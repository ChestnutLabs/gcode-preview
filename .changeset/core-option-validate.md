---
'@chestnutlabs/gcode-preview-core': minor
'@chestnutlabs/gcode-renderer-three': minor
---

A bad viewer option now throws at once, not after the 3D renderer loads. Until now, a typo such as
`cameraMode: 'ortho'` or a theme opacity of `2` passed to `createPreviewController` (or as an adapter prop) only
failed inside the on-demand 3D load. The viewer then reported `E_RENDERER_LOAD` and showed no 3D view. The same value
passed to a setter before the load came back later as `E_CONTROL_REJECTED`.

- **Same rule, same message, earlier.** The constructor and the setters throw `RangeError` synchronously for
  `theme`, `buildVolume`, `cameraMode`, `qualityMode`, `progressivePreview`, `frameContent`,
  `interactionQuality` and `renderer.mode`, and for `setView` and `setCameraState`. Nothing is queued. Every value
  that works today still works.
- **2D viewers check too.** A bad 3D option on a `renderer: { mode: '2d' }` viewer used to be ignored. It now throws,
  as `cameraFov`, `pixelRatio` and `colorMode` already did. `frameContent`, `interactionQuality`, `setView` and
  `renderer.mode` had no check at all before, so a typo there now throws in every mode.
- **New in `@chestnutlabs/gcode-renderer-three` (and `/lite`):** the checks themselves (`checkTheme`,
  `checkBuildVolume`, `checkCameraMode`, `checkCameraView`, `checkCameraState`, `checkCameraFov`, `checkPixelRatio`,
  `checkQualityMode`, `checkProgressivePreview`, `checkFrameContent`, `checkInteractionQuality`,
  `checkRendererMode`) and the allowed values as `readonly` arrays (`CAMERA_MODES`, `CAMERA_VIEWS`,
  `QUALITY_POLICIES`, `PROGRESSIVE_PREVIEW_MODES`, `FRAME_CONTENT_MODES`, `INTERACTION_QUALITY_MODES`,
  `RENDERER_MODES`), plus `MAX_GRID_LINES_PER_AXIS`. The renderer uses the same functions, so each rule exists once.
- **Web Component:** unchanged. A bad property value throws, and a bad attribute value (`camera-mode="ortho"`) is
  ignored, as before.
