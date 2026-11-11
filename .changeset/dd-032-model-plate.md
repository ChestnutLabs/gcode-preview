---
'@chestnutlabs/gcode-model-renderer': minor
'@chestnutlabs/gcode-renderer-three': patch
'@chestnutlabs/gcode-preview-vue': minor
'@chestnutlabs/gcode-preview-react': minor
'@chestnutlabs/gcode-preview-svelte': minor
'@chestnutlabs/gcode-preview-element': minor
---

The source-model viewer can draw a build plate (DD-032). It is opt-in: with no `buildVolume` the viewer and
the stills render exactly as before.

- **Plate.** `createModelViewer`, `createModelPreviewController` and `renderModelStill` take `buildVolume`
  (the full `BuildVolumeDef`: shape, `min`, excluded regions), `theme` and `cameraFov`; the controller and
  viewer gain `setBuildVolume`, `setTheme` and `setCameraFov`. `studioTheme` and `STUDIO_CAMERA_FOV` are
  re-exported. Stills draw the plate too, so a saved thumbnail matches the live view.
- **Honest placement.** A source file's transforms do not prove where its parts sit on a plate, so
  `ModelPreviewState` (and `ModelReadyInfo` and the still result) report `placement`: `'known'` (a
  Bambu/Orca project whose parts lie on the bed, within 1 mm), `'inferred'` (such a project shifted by whole
  multi-plate workspace cells), `'approximated'` (anything else: centred on the bed at z = 0), or `null`
  (no plate drawn: no `buildVolume`, nothing shown, or the render scope spans more than one declared plate).
  `placementOffset` is the offset applied. It is presentation-only: `ModelScene` and `bounds` stay authored,
  picking works through it, and the camera, resize re-fit and contact shadow use the presented position.
  The `inferred` rule uses an observed workspace-cell size and is pending a real two-plate fixture.
- **Theme subset.** The model viewer honours only the plate and backdrop fields of `Theme`. Lights and
  `materialPreset` are deliberately not applicable: model lighting does not change under a theme.
- **Background.** Precedence is `capture({ background })`, then `theme.background`, then the `background`
  option / `setBackground` (now the fallback tier: it has no visible effect while the theme sets a
  background), then transparent.
- **Capture.** `capture({ includeBuildVolume: false })` now hides the plate and its shadow on the model
  viewer (it used to be a no-op there).
- **Lens.** `cameraFov` is in degrees, [10, 120]; outside it throws `RangeError` synchronously (also before a
  canvas binds), and the controller remembers it across canvas rebinds. The camera re-fits when it changes
  while the viewer is auto-framing.
- **`ModelScene.source` (public, additive).** `{ slicerProject?: 'bambu-orca', printableArea? }` records what
  a 3MF itself says: `'bambu-orca'` only when it carries a Bambu/Orca project config, and `printableArea`
  (the bed box of its `printable_area`) only when that is a valid polygon. Absence means the file did not
  say; it is never inferred from geometry. A consumer-supplied `filamentPalette` still wins for colours, and
  a malformed `project_settings.config` still just loses the palette. `ModelReadyInfo` and `RenderModelStillResult`
  gain `placement` / `placementOffset`, and `ModelViewer` gains `getPlacement()`.
- **Adapters (`/model` on all four).** `buildVolume`, `theme` and `cameraFov` as props (Vue, React, Svelte)
  and `buildVolume` / `theme` as properties plus a `camera-fov` attribute and `cameraFov` property on
  `<gcode-model-viewer>`; the three setters are on `controls`. An invalid `camera-fov` attribute is
  ignored and the last valid lens kept; an invalid property value throws.
- The shared model parity guard requires the three setters and the two state fields, and
  `@chestnutlabs/gcode-model-renderer/testing` adds `makeModelRecordingGL()`.

`@chestnutlabs/gcode-renderer-three` is a docs-only patch: the `capture()` option comment now says the model
viewer honours `includeBuildVolume`.
