---
'@chestnutlabs/gcode-renderer-three': minor
---

New renderer primitives for the Studio viewport look (DD-032). They are opt-in, and a scene with no theme
and the default lens renders exactly as before.

- `Theme` gains `gridOpacity`, a major grid tier (`gridMajor: { every, opacity, color? }`), a bed boundary
  loop for every bed shape (`bedOutline: { opacity, color? }`), `contactShadow: { opacity }`, and a
  vertical-gradient `background: { top, bottom }`. `BedSurface` gains `thickness` (a solid plate with side
  walls; the top face keeps its height and colour) and `edgeColor`.
  - `gridMajor.every` snaps to a whole number of grid pitches, so changing the grid pitch never fails.
  - With `bedOutline` set, the outline replaces the grid lines on the bed edge and the cage's floor edges.
- `studioTheme('dark' | 'light')` returns the Studio preset; `STUDIO_CAMERA_FOV` is 32.
- Lens support: `framingFromCenterRadius(center, radius, fov?)` frames correctly at any lens from 10° to
  120°, and `InteractiveStage.setFov(fov)` changes the lens while keeping the model's apparent size.
- `createBackdrop`, `createContactShadow` and `volumeStyle` are exported as pure builders for viewers to
  wire in, and `disposeBuildVolume` frees a plate group including its textures.
- Fixed: the bed texture is now freed when the build volume is rebuilt (`setTheme`, `setBuildVolume`) and
  on `dispose()`. It used to leak each time.
- Invalid values throw `RangeError`: an opacity outside [0,1], a non-positive `gridMajor.every`, or a lens
  outside [10, 120].

`ResolvedTheme` gains optional fields. It is an output type; constructing one by hand is not supported.

Not wired yet: `ToolpathRenderer` does not draw the gradient background or the contact shadow in this
step, and a gradient `background` reaches the scene only once that wiring lands.
