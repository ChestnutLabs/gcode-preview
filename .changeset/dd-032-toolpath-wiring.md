---
'@chestnutlabs/gcode-renderer-three': minor
'@chestnutlabs/gcode-preview-core': minor
'@chestnutlabs/gcode-preview-vue': minor
'@chestnutlabs/gcode-preview-react': minor
'@chestnutlabs/gcode-preview-svelte': minor
'@chestnutlabs/gcode-preview-element': minor
---

The toolpath viewer now draws the Studio look and has a camera lens control. With no theme set
and the default lens, it renders exactly as before.

- **Studio look in the toolpath viewer.** `setTheme(studioTheme('dark' | 'light'))`, or the `theme` prop,
  now draws the theme's vertical-gradient `background` and its `contactShadow`: a soft footprint shadow under
  the toolpath, part of the plate. The shadow needs a build volume and loaded content, and
  `capture({ includeBuildVolume: false })` hides it with the plate. A gradient background used to fall back
  to no background.
- **Camera lens.**
  - New `renderer.cameraFov` controller option and `controls.setCameraFov(degrees)`: a vertical field of
    view in [10, 120], default 50 (`STUDIO_CAMERA_FOV` is 32). Out of range throws `RangeError`; it is never
    clamped. The throw is synchronous, even before the 3D renderer has loaded.
  - Framing reads the lens, so the model fits at any value. A live change keeps the framing without a
    re-fit and emits no `camera-changed`. The lens is kept across canvas rebinds.
  - The 2D renderer reports `setCameraFov` as `renderer-unsupported`, the same as `setCameraMode`.
- **Stills.** `renderStill` gains a top-level `cameraFov`. An explicit `camera.fov` still wins.
- **Adapters.** Vue, React and Svelte gain a declarative `cameraFov` prop; leaving it unset keeps the
  current lens. `<gcode-preview>` gains a `camera-fov` attribute and a `cameraFov` property. Setting the
  property out of range throws `RangeError`; a bad attribute value is ignored, and the element keeps the
  last valid lens.
- `gcode-preview-core` re-exports `studioTheme` and `STUDIO_CAMERA_FOV`, so you don't need to import from
  the renderer package.
- `ToolpathRenderer` gains `cameraFov` (option and getter) and `setCameraFov`. `PreviewRenderer` gains an
  optional `setCameraFov`, so an existing custom renderer still type-checks.
