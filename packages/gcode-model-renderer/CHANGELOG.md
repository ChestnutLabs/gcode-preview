# @chestnutlabs/gcode-model-renderer

## 0.24.0

### Minor Changes

- [#593](https://github.com/ChestnutLabs/gcode-preview/pull/593) [`7b459c8`](https://github.com/ChestnutLabs/gcode-preview/commit/7b459c8e0ec13fd9bed21c88b9fe2026fbb1cffb) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Portable behavioural suites: new parity guards every adapter inherits.
  - **`@chestnutlabs/gcode-preview-core/testing`:** `runBehavioralSuite` now checks the parse event contract on
    every case (each `parse-started` gets exactly one terminal event, and `state.parsing` is false at dispose),
    through the newly exported `withParseLifecycleGuard` and `parseLifecycleViolation`. New cases cover a null
    input, an input whose `getReader` getter throws, a renderer-checked bad control (a `RangeError`, or
    `E_CONTROL_REJECTED` when it was queued, never both), bad control values after bind, and a 3D renderer that
    fails to load (`E_RENDERER_LOAD` in state and on the `error` event), through the new
    `AdapterHarness.create({ createGL })` seam. The component suite adds a re-parse case (the same source again,
    or a `parseOptions` change alone, does not re-parse), which needs the new `MountedComponent.setParseOptions`
    seam.
  - **If you run these suites against your own adapter:** both seams are typed as optional, but the new cases need
    them. A harness without `setParseOptions` fails the re-parse case ("harness must implement…"). A harness that
    ignores `createGL` reaches a real WebGL context and fails the renderer-load case. A harness that passed on
    0.23 can go red on this release until it implements both.
  - **`@chestnutlabs/gcode-model-renderer/testing`:** `runModelBehavioralSuite` adds render-scope validation,
    last-wins overlapping `setSource`, and `setSource` after dispose rejecting `E_MODEL_PREVIEW_DISPOSED`. New
    `MODEL_VIEWER_PROP_KEYS`, `MODEL_VIEWER_EVENT_KEYS` and `modelViewerSurfaceGaps` let each `/model` adapter
    check that its component surface matches the others.

### Patch Changes

- [#564](https://github.com/ChestnutLabs/gcode-preview/pull/564) [`5a72612`](https://github.com/ChestnutLabs/gcode-preview/commit/5a72612a17dbcfa26c29b25c92fc683b8ab2326b) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Mutation sweep of the React, Vue and Svelte `/model` adapters.
  - **Svelte:** `<ModelViewer renderScope={null}>` now means "the whole source", as documented and as React and Vue
    already behave. Before, it threw `RangeError: renderScope must be an object` while the component was created.
  - **Testing seam:** `@chestnutlabs/gcode-model-renderer/testing` adds `makeModelRecordingGL().drawn()`,
    `makeTwoObjectModelSource()` and an opt-in guard (`ModelAdapterInstance.rebind` + `drawn`) that a runtime render
    scope and background survive a canvas rebind. Adapters that do not provide them are unaffected.

- [#574](https://github.com/ChestnutLabs/gcode-preview/pull/574) [`2a8854d`](https://github.com/ChestnutLabs/gcode-preview/commit/2a8854d8ff7fdf9187dfb705d12fd3b5a04ec0d9) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - A 3MF that holds an absurd number of vertices or triangles is now rejected before its arrays are allocated, instead of
  being read up to the container's expanded-size cap. Vertices are bounded at three per allowed triangle (15,000,000 at the
  default `maxTriangles` of 5,000,000) and fail with the new `E_MODEL_TOO_MANY_VERTICES`; triangles are now bounded at
  `maxTriangles` across the whole file while it is read (`E_MODEL_TOO_MANY_TRIANGLES`), where before only each object was
  checked at read time. Both counts cover every object and part in the file, placed or not; a part reached by several
  build items counts once. Raising `maxTriangles` raises both limits and the error message names the numbers. Meshes that
  fit the triangle limit are unaffected, including unindexed exports that use exactly three vertices per triangle. A file
  whose unplaced objects add up to more than `maxTriangles` triangles, or that carries more than three vertices per
  allowed triangle, will now reject; raise `maxTriangles` to load it.

- [#556](https://github.com/ChestnutLabs/gcode-preview/pull/556) [`25e3de1`](https://github.com/ChestnutLabs/gcode-preview/commit/25e3de1a5881d9e2170fa53c22c386c846131dc8) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - A model-viewer capture with `includeBuildVolume: false` no longer hides the plate from live frames while the image
  encodes. The plate is hidden only for the off-screen render and restored before the encode starts, so a frame drawn
  during the encode, or a second capture started meanwhile, still shows it. The same holds when the capture fails.

- [#548](https://github.com/ChestnutLabs/gcode-preview/pull/548) [`6fb7153`](https://github.com/ChestnutLabs/gcode-preview/commit/6fb7153c483c44cbf73af636e2d0bef9af455d2c) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Model viewer fixes from a mutation sweep of `createModelPreviewController`, `createModelViewer`, `renderModelStill` and the render scope.
  - The controller now remembers `setRenderScope`, `setBackground` and `setInteractionQuality`, so a canvas rebind (a StrictMode remount, a replaced canvas) keeps the consumer's latest values instead of the initial options.
  - `controls.setSource()` after `dispose()` rejects with `E_MODEL_PREVIEW_DISPOSED` instead of never settling. `controls.capture()` before a canvas binds rejects with `CaptureUnsupportedError` (`code: 'E_CAPTURE_UNSUPPORTED'`) instead of a plain `Error`.
  - A superseded or disposed `setSource` that fails no longer emits an `error` event after the newer load's `ready`; its own promise still rejects.
  - An invalid render scope (not exactly one of `objectIds` (string array), `plateId` (integer), `instanceFilter` (function)) throws `RangeError` before anything is stored, in `setRenderScope`, the constructor options and `renderModelStill`. Previously `{}` threw a `TypeError` and `{ objectIds: 'a' }` matched by substring.
  - A render scope whose only kept object has empty geometry now has empty bounds `[0,0,0]`..`[0,0,0]` instead of ±Infinity.
  - **Cache keys change for pre-built `ModelScene` inputs.** `renderModelStill` used to key them on the object count, bounds and capabilities only, so two scenes with different geometry or colours shared a key (a false thumbnail cache hit). The key now covers the geometry content, transforms, instances, plate membership, materials, plates and the source's plate claim. A stored key for a pre-built scene will not match; regenerate it. Keys for STL and 3MF byte sources are unchanged.

- [#608](https://github.com/ChestnutLabs/gcode-preview/pull/608) [`53d2d47`](https://github.com/ChestnutLabs/gcode-preview/commit/53d2d47f04fe782dbf1dee232d34788f0122cb67) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - The `pixelRatio` option no longer stops the 3D view from starting. Since 0.22.0, a `pixelRatio` that changed the
  ratio at start-up (`2`, or `'device'` on a high-DPI screen) drew a frame before the cameras existed: the preview
  reported `E_RENDERER_LOAD` and drew nothing, and the model viewer stayed blank. `setPixelRatio()` after start-up was
  not affected.

  The testing helpers now catch this: the stub GLs in `@chestnutlabs/gcode-preview-core/testing` (`makeSuiteStubGL`)
  and `@chestnutlabs/gcode-model-renderer/testing` (`MODEL_STUB_GL`, `makeModelRecordingGL`) read the camera the way
  three does, and `ModelAdapterHarness.create` takes an optional `{ pixelRatio }` that your harness passes to the
  viewer at mount.

- [#559](https://github.com/ChestnutLabs/gcode-preview/pull/559) [`e7e5bd4`](https://github.com/ChestnutLabs/gcode-preview/commit/e7e5bd432dd601a780f1f3809888e1f5aef5fb21) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - A theme value the viewer can't draw now throws a `RangeError` that names the field, instead of quietly
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

- [#572](https://github.com/ChestnutLabs/gcode-preview/pull/572) [`74e217d`](https://github.com/ChestnutLabs/gcode-preview/commit/74e217da4f3c3f6b5dfc8de276e51841929d2e5e) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - A tiny STL whose header overstates its triangle count no longer allocates memory in proportion to the claim
  before failing.

  A binary STL header says how many triangles follow, and the parser sized its buffers from that number before
  checking it against the file or against `maxTriangles`. A 134-byte file claiming 5,000,000 triangles made the
  loader allocate about 360 MB before failing; a larger claim cost gigabytes. The claim is now checked first, in
  this order:
  - a claim that the file cannot hold fails with `E_MODEL_PARSE` ("declares N triangles but holds M"), whatever
    the claim is, so a corrupt short file still reads as "could not read", not "too large";
  - a claim the file does hold, but that is over `maxTriangles`, fails with `E_MODEL_TOO_MANY_TRIANGLES`,
    including when the file has trailing bytes.

  The "holds" check keeps three's tolerance: a binary STL up to 2 bytes short of its last facet's trailing
  attribute word passes this check, as before. (A file with a `COLOR=` header still fails at the loader, as it
  always did, because three reads that word as a colour.)

  Valid files are unaffected, including binary STLs with trailing bytes and ASCII STLs. Files that failed before
  fail with the same error code; they now fail without the allocation.

- Updated dependencies [[`7a95b00`](https://github.com/ChestnutLabs/gcode-preview/commit/7a95b00ce7ad65ae8f8d4090070d0ea583310446), [`01d9d9f`](https://github.com/ChestnutLabs/gcode-preview/commit/01d9d9f9911eee0042d939d871fd10fc47a2932c), [`51145d8`](https://github.com/ChestnutLabs/gcode-preview/commit/51145d8dce4934c4f048bc33831161de5404210f), [`e6ca4e8`](https://github.com/ChestnutLabs/gcode-preview/commit/e6ca4e857a1ee599ffc516562b022ece6bbebe8b), [`d895700`](https://github.com/ChestnutLabs/gcode-preview/commit/d895700aeb702dbf5a5e1e00479881220ae97856), [`eb6b74c`](https://github.com/ChestnutLabs/gcode-preview/commit/eb6b74c0f9a8a7b0e28060d672d1021dab2a63d5), [`53d2d47`](https://github.com/ChestnutLabs/gcode-preview/commit/53d2d47f04fe782dbf1dee232d34788f0122cb67), [`6ac0492`](https://github.com/ChestnutLabs/gcode-preview/commit/6ac04923113acae681366f5b64b86f1976fc1759), [`e7e5bd4`](https://github.com/ChestnutLabs/gcode-preview/commit/e7e5bd432dd601a780f1f3809888e1f5aef5fb21), [`6b03f42`](https://github.com/ChestnutLabs/gcode-preview/commit/6b03f4221e5f0a552959fbed7f85124203d42f57)]:
  - @chestnutlabs/gcode-renderer-three@0.24.0
  - @chestnutlabs/toolpath-core@0.24.0
  - @chestnutlabs/gcode-containers@0.24.0

## 0.23.0

### Patch Changes

- [#527](https://github.com/ChestnutLabs/gcode-preview/pull/527) [`d93de83`](https://github.com/ChestnutLabs/gcode-preview/commit/d93de834d6dc860701111f9588ea7beb0af2df2c) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Hostile 3MF files can no longer hang the parser, and model `limits` are now validated and enforced.
  - **A small 3MF could hang the load forever.** Components that list the next object twice (a 3 KB file
    with 50 levels is 2^50 steps), or an object that lists itself, were walked without a bound. Every node
    of the assembly now counts against `maxInstances` (default 50,000) and fails with
    `E_MODEL_TOO_MANY_INSTANCES`, including nodes inside production-extension parts. An object that contains
    itself, directly or through others, throws the new `E_MODEL_CYCLE`. A part shared by several parents is
    valid 3MF and still loads.
  - **`maxObjects` is now enforced.** It was documented (default 10,000) but never checked. A 3MF with more
    `<object>` elements than the limit, counted across the main and any external parts, now throws the new
    `E_MODEL_TOO_MANY_OBJECTS`. **Files with more than 10,000 objects that used to load now reject**; raise
    `maxObjects` if you load such files on purpose.
  - **Invalid limits throw instead of switching the bound off.** `maxTriangles`, `maxObjects`,
    `maxSourceBytes` and `maxInstances` must be non-negative integers. Before, `NaN` disabled the bound and a
    negative value rejected every file. Now they throw `ModelParseError` with `code: 'E_MODEL_OPTION'`. As with
    the container and parser caps, `Infinity` is not accepted as "unlimited"; pass a large integer. A field
    that is left out or `undefined` keeps its default, and `0` is allowed.
  - **A 3MF whose components fan out past `maxInstances` also counts mesh-free containers.** An assembly
    that was within the cap by placements alone, but had more than `maxInstances` nodes in total, now rejects.

- [#528](https://github.com/ChestnutLabs/gcode-preview/pull/528) [`9a2c1fb`](https://github.com/ChestnutLabs/gcode-preview/commit/9a2c1fb3ae9d90c7c7940d5bf53aa3d58e3c9528) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Model files with non-finite geometry now fail the load with `E_MODEL_PARSE` instead of rendering as `NaN`/`Infinity` positions and bounds.
  - **3MF.** A vertex coordinate that is `NaN`, `Infinity`, `1e999` or beyond float32 range (`1e300`) rejects, as does
    a `transform` (build item or component) with such an entry. A coordinate that only overflows after the
    `unit` scale (meters to mm), component transforms whose product overflows, and a transformed box that
    overflows also reject. A triangle index that is negative, fractional, not a number, missing, or points past
    the mesh's last vertex rejects (it used to be truncated or read as a `NaN` position). The message names the
    vertex, transform entry or triangle. A `transform` that does not have 12 entries is still read as identity, and an
    absent vertex coordinate is still 0.
  - **STL.** A binary or ASCII STL with a `NaN`, infinite or float32-overflowing vertex rejects, naming the vertex.
    Before, an all-`NaN` STL loaded with `NaN` bounds. There is no partial load: dropping triangles silently
    would show a different model, and the model renderer has no warnings channel.
  - **Scene bounds.** `bounds` that are not finite float32 numbers reject at the one place every source passes
    through: a pre-built `ModelScene`, a registered custom loader's result, and `renderModelStill`. Fit and
    plate placement therefore never see a `NaN` box.

  **Files that used to load and now reject (`E_MODEL_PARSE`):** 3MFs with a missing, negative, fractional or
  out-of-range triangle index (it was truncated or read past the mesh); 3MFs with a vertex coordinate that is not
  a number (it was read as 0) or is beyond float32 range; 3MFs with a 12-value `transform` that has a non-numeric
  or out-of-range entry (a non-numeric one used to be ignored, the transform treated as identity); and STLs with
  `NaN`/`Infinity` coordinates. A pre-built `ModelScene` or a custom loader whose `bounds` are not finite also
  rejects now.

- Updated dependencies [[`3ae53e9`](https://github.com/ChestnutLabs/gcode-preview/commit/3ae53e9cf687e62f0a4c2bfeee0900fb5a56d76c), [`bf3513b`](https://github.com/ChestnutLabs/gcode-preview/commit/bf3513b67566cb597d2dd366e0f28c84660768a6), [`3e1a11e`](https://github.com/ChestnutLabs/gcode-preview/commit/3e1a11ed171de55b4cf852aa3e5b94ddf69ac1ca), [`e6f159d`](https://github.com/ChestnutLabs/gcode-preview/commit/e6f159d605969ffe65c33ffe32767b2d61c43aac), [`4d08cbc`](https://github.com/ChestnutLabs/gcode-preview/commit/4d08cbc86aa1672ebea6f9d312b376699db5ecf1)]:
  - @chestnutlabs/gcode-renderer-three@0.23.0
  - @chestnutlabs/gcode-containers@0.23.0
  - @chestnutlabs/toolpath-core@0.23.0

## 0.22.0

### Minor Changes

- [#484](https://github.com/ChestnutLabs/gcode-preview/pull/484) [`7912c65`](https://github.com/ChestnutLabs/gcode-preview/commit/7912c65b63cab190e33b95fad68c69332432d662) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - The source-model viewer can draw a build plate. It is opt-in: with no `buildVolume` the viewer and
  the stills render exactly as before.
  - **Plate.** `createModelViewer`, `createModelPreviewController` and `renderModelStill` take `buildVolume`
    (the full `BuildVolumeDef`: shape, `min`, excluded regions), `theme` and `cameraFov`; the controller and
    viewer gain `setBuildVolume`, `setTheme` and `setCameraFov`. `studioTheme` and `STUDIO_CAMERA_FOV` are
    re-exported. Stills draw the plate too, so a saved thumbnail matches the live view.
  - **Honest placement.** A source file's transforms do not prove where its parts sit on a plate, so
    `ModelPreviewState` (and `ModelReadyInfo` and the still result) report `placement`: `'known'` (a
    Bambu/Orca project made for your bed whose parts lie on your plate, within 1 mm), `'inferred'` (such a
    project shifted by whole multi-plate workspace cells), `'approximated'` (anything else, centred on your
    plate at z = 0; a project made for a different printer's bed is shown centred on your plate and labelled
    approximated), or `null` (no plate drawn: no `buildVolume`, nothing shown, or the render scope spans more
    than one declared plate).
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

- [#498](https://github.com/ChestnutLabs/gcode-preview/pull/498) [`2ad2a75`](https://github.com/ChestnutLabs/gcode-preview/commit/2ad2a75948b2092831638a5980412cad03bf9a72) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - The model viewer can now hide the build-volume cage, like the toolpath viewer. Call
  `controls.setBuildVolumeCage(false)`, pass `showVolumeCage: false` when you create it, or set
  `showVolumeCage={false}` on the `/model` components (`show-volume-cage="false"` on `<gcode-model-viewer>`).
  The plate, its grid and the contact shadow stay, and the model does not move. The setting is kept when
  you change the bed, theme or plate scope. If you don't set it, nothing changes: the cage is drawn.

- [#495](https://github.com/ChestnutLabs/gcode-preview/pull/495) [`3b15da8`](https://github.com/ChestnutLabs/gcode-preview/commit/3b15da8ef9d0ea79766008f3f4b210d084979d62) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - New opt-in `pixelRatio` for sharper interactive views on HiDPI screens. If you don't set it, nothing
  changes: the renderer keeps its own ratio (1 for the built-in renderer, whatever a custom
  `createRenderer` was set to).
  - **What it takes.** A number in (0, 4], or `'device'`. `'device'` uses the screen's `devicePixelRatio`,
    capped at 2, and follows it live when it changes, for example when the window moves to another monitor
    or the browser zoom changes. Anything else throws `RangeError`. Values are never clamped, and
    `'device'` must be that exact lowercase string.
  - **Cost.** A higher ratio shades more pixels: ratio 2 fills 4× the fragments of ratio 1. That is fine
    for a single viewer. On pages with many viewers, or on weak GPUs, leave it unset or use a number.
  - **Orbiting.** `interactionQuality: 'auto'` still lowers detail while the camera moves and settles back
    on your ratio. A change made mid-gesture applies at once, still reduced, and the gesture settles on
    the new ratio.
  - **`capture()`.** With no `width`/`height`: unset, the default image is the resting drawing-buffer size,
    as before, whatever renderer you use (with the built-in renderer that is the CSS size). With a
    `pixelRatio` set, it is the canvas's CSS size whatever the ratio. So with the built-in renderer, setting
    a ratio never changes the default image size. Pass `width`/`height` for a crisper image. This also fixes
    an unsized `capture()` taken during an orbit with `interactionQuality: 'auto'`: it used to return the
    reduced-detail size, and now returns the resting size.
  - **Where to set it.**
    - Toolpath viewer: the `renderer.pixelRatio` controller option and `controls.setPixelRatio(ratio)`. It
      is validated synchronously, even before the 3D renderer loads, and kept across canvas rebinds.
    - Model viewer: the `pixelRatio` option and `controls.setPixelRatio(ratio)` on
      `createModelPreviewController` and `createModelViewer`.
    - Vue, React and Svelte: a declarative `pixelRatio` prop on `GcodePreview` and on the `/model`
      `ModelViewer`. Leaving it unset keeps the current ratio.
    - `<gcode-preview>` and `<gcode-model-viewer>`: a `pixel-ratio` attribute and a `pixelRatio` property.
      Setting the property to an invalid value throws `RangeError`. A bad attribute value is ignored, and
      the element keeps the last valid ratio.
  - **2D renderer.** `setPixelRatio` reports `renderer-unsupported` (feature `quality`), and the 2D view
    keeps its own resolution.
  - **Stills.** `renderStill` and `renderModelStill` have no pixel-ratio option; size a still with
    `width`/`height`.
  - **Lower-level API.** `ToolpathRenderer` and `InteractiveStage` gain a `pixelRatio` option and
    `setPixelRatio`. `InteractionQualityController` gains `rebase(ratio)`, `currentRatio` and
    `reduction`. `PreviewRenderer`
    gains an optional `setPixelRatio`, so an existing custom renderer still type-checks. New exports:
    the `PixelRatioOption` type (also from `gcode-preview-core`), `DEVICE_PIXEL_RATIO_CAP`, and the
    `DisplayEnv` / `MediaQueryListLike` types (an injectable display for tests).

### Patch Changes

- Updated dependencies [[`f805747`](https://github.com/ChestnutLabs/gcode-preview/commit/f8057473fdd72b906562ffe4c19f838e864a3a82), [`815f095`](https://github.com/ChestnutLabs/gcode-preview/commit/815f0954ba3687b9a96bb35cd0813de2d63ec281), [`7912c65`](https://github.com/ChestnutLabs/gcode-preview/commit/7912c65b63cab190e33b95fad68c69332432d662), [`84e664a`](https://github.com/ChestnutLabs/gcode-preview/commit/84e664a4794cc80e8ea5377f53448995522bef2c), [`7469a64`](https://github.com/ChestnutLabs/gcode-preview/commit/7469a643f1398d6ef9e4fbb39b89b4aa092a80d9), [`38fa875`](https://github.com/ChestnutLabs/gcode-preview/commit/38fa8751de9cb874a51038b4adfb69088270aa19), [`3fe25f4`](https://github.com/ChestnutLabs/gcode-preview/commit/3fe25f4d8d66ab1f37d23892365fb33d2c813ff6), [`3b15da8`](https://github.com/ChestnutLabs/gcode-preview/commit/3b15da8ef9d0ea79766008f3f4b210d084979d62)]:
  - @chestnutlabs/gcode-containers@0.22.0
  - @chestnutlabs/gcode-renderer-three@0.22.0
  - @chestnutlabs/toolpath-core@0.22.0

## 0.21.2

### Patch Changes

- [#464](https://github.com/ChestnutLabs/gcode-preview/pull/464) [`be7a9dc`](https://github.com/ChestnutLabs/gcode-preview/commit/be7a9dcbce055ec4424059d0952058b6f99e2be9) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - A model 3MF with a single part over the per-entry size cap (`maxExpandedBytesPerEntry`, 512 MiB) is now
  reported as `E_MODEL_TOO_LARGE`, the same as an archive over the total cap. It used to surface as
  `E_MODEL_PARSE` with the container library's raw text. Corrupt or CRC-failing parts still report
  `E_MODEL_PARSE`.

- [#475](https://github.com/ChestnutLabs/gcode-preview/pull/475) [`35b7381`](https://github.com/ChestnutLabs/gcode-preview/commit/35b73813d61a08a88db38a018a0aac5dce71b861) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Hostile-input hardening, no behaviour change ([#468](https://github.com/ChestnutLabs/gcode-preview/issues/468) follow-up). The 3MF model-XML tokenizer was quadratic
  three ways: a lazy tag body re-scanned to the end of the input from every `<` with no terminating `>` (120 KB
  of `<a ` froze the load for 12 s), a long tag name backtracked (one 20k-character name took 1 s), and the
  attribute reader restarted inside every word without an `=` (one 80 KB word took 8.6 s). Both are now linear
  (each of those inputs takes a few milliseconds). The new tokenizer returns exactly what the old regex did,
  including for garbled and truncated files; this is verified differentially against the old implementation
  (corpus 3MFs, hand cases and a million seeded random strings).

- [#473](https://github.com/ChestnutLabs/gcode-preview/pull/473) [`6bfe00a`](https://github.com/ChestnutLabs/gcode-preview/commit/6bfe00a73b0b01c5372238f9d73c5eb8adca9001) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Fix hangs when loading a crafted Bambu/Orca `.3mf`. Reading `Metadata/model_settings.config` took time
  quadratic in the config size in three places: the plate layout (many `<plate` tags with no closing tag),
  each plate's `<model_instance>` list, and the per-object/part extruder colours (many `<object id="…"`
  headers with no closing `>`). A few hundred KiB froze the load for seconds and a few MiB for minutes. All
  three scans are now linear. Well-formed configs parse exactly as before.
- Updated dependencies [[`3075656`](https://github.com/ChestnutLabs/gcode-preview/commit/3075656ec105773869bea720c54a4d792bfd51c7)]:
  - @chestnutlabs/gcode-renderer-three@0.21.2
  - @chestnutlabs/gcode-containers@0.21.2
  - @chestnutlabs/toolpath-core@0.21.2

## 0.21.1

### Patch Changes

- [#457](https://github.com/ChestnutLabs/gcode-preview/pull/457) [`8d4464f`](https://github.com/ChestnutLabs/gcode-preview/commit/8d4464fbf9a24f942a71752838a9c0dc186917d9) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - The archive-wide expanded-size cap (`maxExpandedBytesTotal`, default 1 GiB) is now enforced. It was
  declared but never checked, so a crafted model 3MF could expand far past 1 GiB (up to 512 MB per part,
  thousands of parts) when loaded into the model viewer. Every entry extracted from one archive now
  counts toward the total. Re-reading the same entry (for example, re-opening a plate) counts once. Going
  over fails with `E_CONTAINER_LIMIT_TOTAL`, which the model viewer reports as `E_MODEL_TOO_LARGE`. The
  model viewer's total is fixed at 1 GiB, about twice what the default 5M-triangle limit lets through.

  `ContainerLimits` values are now validated: a field that is present but not a non-negative integer
  (`NaN`, `Infinity`, negative, fractional) throws `E_CONTAINER_OPTION` before anything is extracted,
  instead of silently switching that cap off. An absent field still uses its default.

  New export: `ExpansionBudget`, plus an optional `budget` argument on `extractEntry` and `streamEntry`,
  for callers that extract several entries from one archive themselves. The `cap` argument of those two
  functions is now validated the same way: a `cap` that is not a non-negative integer throws
  `E_CONTAINER_OPTION`, so passing `Infinity` to mean "uncapped" no longer works — omit `budget`/use a
  large finite `cap` instead.

  The model 3MF loader now reports every extraction failure of its parts (corrupt data, CRC mismatch) as
  a `ModelParseError` (`E_MODEL_PARSE`); a few paths used to surface a raw `ContainerError`.

- Updated dependencies [[`95724d5`](https://github.com/ChestnutLabs/gcode-preview/commit/95724d5e4cd5d9b09d7598f421f693c3d096efb7), [`8d4464f`](https://github.com/ChestnutLabs/gcode-preview/commit/8d4464fbf9a24f942a71752838a9c0dc186917d9)]:
  - @chestnutlabs/gcode-containers@0.21.1
  - @chestnutlabs/gcode-renderer-three@0.21.1
  - @chestnutlabs/toolpath-core@0.21.1

## 0.21.0

### Minor Changes

- [#439](https://github.com/ChestnutLabs/gcode-preview/pull/439) [`ae84362`](https://github.com/ChestnutLabs/gcode-preview/commit/ae8436236d1fbf94520ab70777d6325e75d8fb21) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Model viewer framing and STL lighting fixes (AnyBridge Customizer):
  - **Aspect-aware fit.** The first frame and `frame()` (Reset view) now fit the model's bounding box to the canvas aspect and field of view, centred with a small margin. Previously the camera used a fixed bounding-sphere offset, so a wide or flat model could overflow a narrow canvas and sit off-centre.
  - **Re-frame on resize.** `resize(w, h)` re-fits the model until the user orbits, zooms, or pans (by pointer, wheel, touch or keyboard) or calls `setCameraState`; after that the user's view is kept, and `frame()` resumes auto-framing. New option `autoFrameOnResize` (default `true`) on `createModelViewer` / `createModelPreviewController` turns this off.
  - **Framework `/model` adapters now size their canvas.** `createModelPreviewController` keeps the viewer sized to the bound canvas (initial fit, ResizeObserver, window-resize fallback), like the toolpath controller. Previously `<ModelViewer>` / `<gcode-model-viewer>` never called `resize()` and rendered at a stretched default 300×150 buffer.
  - **Zero STL normals.** STL facets whose normals are zero or non-finite (common from third-party exporters) rendered solid black; they are now recomputed from the facet winding. Valid file normals are kept.
  - `InteractiveStage` gains `fitBox(min, max, { direction?, margin? })`, `viewDirection()`, and an `onInteractionStart` option. The toolpath renderer's framing is unchanged.

### Patch Changes

- Updated dependencies [[`ae84362`](https://github.com/ChestnutLabs/gcode-preview/commit/ae8436236d1fbf94520ab70777d6325e75d8fb21)]:
  - @chestnutlabs/gcode-renderer-three@0.21.0
  - @chestnutlabs/gcode-containers@0.21.0
  - @chestnutlabs/toolpath-core@0.21.0

## 0.20.1

### Patch Changes

- Updated dependencies [[`672fe42`](https://github.com/ChestnutLabs/gcode-preview/commit/672fe42c9391608adb3b816a6369d86b9f34307e), [`672fe42`](https://github.com/ChestnutLabs/gcode-preview/commit/672fe42c9391608adb3b816a6369d86b9f34307e)]:
  - @chestnutlabs/gcode-renderer-three@0.20.1
  - @chestnutlabs/gcode-containers@0.20.1
  - @chestnutlabs/toolpath-core@0.20.1

## 0.20.0

### Minor Changes

- [#427](https://github.com/ChestnutLabs/gcode-preview/pull/427) [`b25ddb6`](https://github.com/ChestnutLabs/gcode-preview/commit/b25ddb68fdf4a5b12689c67f411e7d8c316086bb) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Make interactive **source-model viewing** (STL / 3MF) a first-class, declarative half of the SDK —
  the Prepare side alongside the toolpath Preview side — so consumers no longer have to drop to the
  imperative `createModelViewer` engine to show a model in a framework (DD-031).

  **New framework-neutral controller** (`@chestnutlabs/gcode-model-renderer`):
  - `createModelPreviewController(options)` — the Prepare-side analogue of `gcode-preview-core`'s toolpath
    controller. It wraps the existing `createModelViewer` engine unchanged and adds what a framework
    binding needs: canvas-deferred construction with `bindCanvas` (rebuilding on a canvas swap and
    replaying the last source), a reactive `getState()`/`onStateChange()` snapshot derived from the
    engine's events (`ModelPreviewState`: `loading`/`ready`/`rendererSupported`/`objectCount`/`materials`/
    `instancedCount`/`decimationApplied`/`bounds`/`plates`/`hasPlates`/`cameraState`/`progress`/`error`),
    and an op queue for calls made before the canvas binds. `ModelPreviewControls` exposes `setSource`,
    `setView`, get/`setCameraState`, `setBackground`, `setInteractionQuality`, `setRenderScope`, `frame`,
    `resize`, and `capture`.
  - A portable model behavioral suite ships via the `@chestnutlabs/gcode-model-renderer/testing` subpath
    (`runModelBehavioralSuite`) with controls/state completeness parity guards.

  **New `/model` adapter subpath on every framework** — thin shells over the one controller, mirroring
  each framework's toolpath idiom:
  - `@chestnutlabs/gcode-preview-react/model` — `useModelViewer` hook + `<ModelViewer>` component.
  - `@chestnutlabs/gcode-preview-vue/model` — `useModelViewer` composable + `<ModelViewer>` component.
  - `@chestnutlabs/gcode-preview-svelte/model` — `createModelViewer` store/action + the raw
    `@chestnutlabs/gcode-preview-svelte/model/ModelViewer.svelte` component.
  - `@chestnutlabs/gcode-preview-element/model` (+ `/model/define`) — the `<gcode-model-viewer>` custom
    element (tag chosen to avoid the reserved `<model-viewer>`).

  All additive — the toolpath surface is unchanged, and toolpath-only consumers don't pull the model
  renderer (it lives behind the opt-in `/model` subpath). Every adapter passes the portable model
  behavioral suite; each package gains `@chestnutlabs/gcode-model-renderer` as a dependency.

### Patch Changes

- Updated dependencies [[`718d1bd`](https://github.com/ChestnutLabs/gcode-preview/commit/718d1bde45856b58c37580d629da6d177f9f2004)]:
  - @chestnutlabs/gcode-renderer-three@0.20.0
  - @chestnutlabs/gcode-containers@0.20.0
  - @chestnutlabs/toolpath-core@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [[`81690dc`](https://github.com/ChestnutLabs/gcode-preview/commit/81690dcfece21d6fd11074ad7a264bcfc9edf455)]:
  - @chestnutlabs/gcode-renderer-three@0.19.0
  - @chestnutlabs/toolpath-core@0.19.0
  - @chestnutlabs/gcode-containers@0.19.0

## 0.18.0

### Minor Changes

- [#418](https://github.com/ChestnutLabs/gcode-preview/pull/418) [`c950339`](https://github.com/ChestnutLabs/gcode-preview/commit/c95033908e3ebaeb07b6f7e6f2487672dcc463f0) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(renderer): interactive view capture() → Blob (DD-030 D1)

  The interactive viewer can now hand back **what is on screen right now** as an image `Blob` — for a
  user-selected thumbnail, a large-file thumbnail fallback, or a screenshot. New `capture(opts?)` where
  `opts` is `{ width?, height?, format?, quality?, background? }` (all optional; defaults match the live
  view).

  Available on every interactive surface: `GcodePreviewControls.capture()` (so the Vue, React, Svelte, and
  Web-Component adapters all inherit it — the Web Component also exposes an imperative `capture()` method),
  and `ModelViewer.capture()` on the model-viewer handle. The toolpath `ToolpathRenderer` and the shared
  `InteractiveStage` carry the implementation.

  **Mechanism (render-to-target).** Capture renders the current scene + active camera into an off-screen
  `WebGLRenderTarget` at the requested size and reads it back, rather than flipping the interactive
  context's `preserveDrawingBuffer` (which would tax every interactive frame). That gives an arbitrary
  output size and an independent/transparent background **without** disturbing the live view, and reuses the
  headless still path's "single render, then read pixels" recipe. The thumbnail is framed at its own aspect
  so it isn't distorted; the live view is repainted afterward. The library returns the `Blob` and **never**
  triggers a download — the caller owns the pixels (same contract as `renderStill`).

  **Honest.** When the renderer cannot render-to-target (the 2D renderer, a stub GL / no WebGL) or the stage
  is disposed / its context is lost, `capture()` rejects with a typed `CaptureUnsupportedError`
  (`code: 'E_CAPTURE_UNSUPPORTED'`) — never fabricated output. Purely additive (a new optional method on the
  renderer contract; no existing signature changed). Final increment of the DD-030 renderer/viewer
  interoperability batch (bed + per-plate scope + capture).

- [#417](https://github.com/ChestnutLabs/gcode-preview/pull/417) [`5dc8079`](https://github.com/ChestnutLabs/gcode-preview/commit/5dc80794444742beddafe1c37322db751af50020) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model-renderer): per-plate / object-subset render scope (DD-030 D2)

  A caller can now render just **one plate** (or any object/placement subset) of a multi-plate / multi-object
  source, instead of always the whole project — so a single-plate variant thumbnail looks like _that_ plate.

  New `RenderScope` selector — `{ plateId }`, `{ objectIds }`, or `{ instanceFilter }` — with a pure,
  three-free `applyRenderScope(scene, scope)` that returns a filtered `ModelScene` (dropping non-matching
  objects/placements) with `bounds` recomputed from the kept placements, so framing follows the subset.
  `{ plateId }` is sugar over the placement-level `plateIds` (DD-025); it's generic (a plate is just one way
  to derive the subset) and vendor-neutral.

  Wired into both surfaces:
  - `renderModelStill` gains a `renderScope?` option; it also folds the scope into the still `cacheKey` so a
    plate-1 and a plate-2 thumbnail of the same source key distinctly (an opaque `instanceFilter` is marked
    non-cacheable).
  - `createModelViewer` gains an initial `renderScope?` and a `setRenderScope(scope | null)` handle method
    that rebuilds and reframes to the subset (`null` restores the whole source).

  Honest and additive: omitting `renderScope` renders the whole project exactly as before. A `{ plateId }`
  that matches nothing (e.g. a source with no declared plate structure, `capabilities.plates !== 'known'`)
  renders an **empty** scene by design — the honest result of selecting a plate that isn't declared;
  consumers gate `{ plateId }` on `plates: 'known'`. The source's declared `plates`/`capabilities` are
  preserved (only what is _rendered_ is narrowed). Second increment of the DD-030 renderer/viewer interop
  batch.

### Patch Changes

- Updated dependencies [[`0ebeadf`](https://github.com/ChestnutLabs/gcode-preview/commit/0ebeadfa839e52baf243ef07b5807f3974bbac7e), [`c950339`](https://github.com/ChestnutLabs/gcode-preview/commit/c95033908e3ebaeb07b6f7e6f2487672dcc463f0)]:
  - @chestnutlabs/gcode-renderer-three@0.18.0
  - @chestnutlabs/gcode-containers@0.18.0
  - @chestnutlabs/toolpath-core@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies [[`d1de1b4`](https://github.com/ChestnutLabs/gcode-preview/commit/d1de1b407389321442289a5be5d3104c60b68060), [`214b0db`](https://github.com/ChestnutLabs/gcode-preview/commit/214b0db2dd9d8aa177d80969bdb59173d33121a3), [`b362f9a`](https://github.com/ChestnutLabs/gcode-preview/commit/b362f9a81232a21ff35a4a23d84c6300db83f28f)]:
  - @chestnutlabs/gcode-renderer-three@0.17.0
  - @chestnutlabs/toolpath-core@0.17.0
  - @chestnutlabs/gcode-containers@0.17.0

## 0.16.0

### Patch Changes

- Updated dependencies [[`6587d99`](https://github.com/ChestnutLabs/gcode-preview/commit/6587d9994dde77dd5488136e9b46257661c16c2e), [`1c54132`](https://github.com/ChestnutLabs/gcode-preview/commit/1c54132a39713c3c6d582e0b6820b411eff40d20), [`fdc9111`](https://github.com/ChestnutLabs/gcode-preview/commit/fdc9111c0917af55e41fff9d20464ebbc3444589), [`ecfa56b`](https://github.com/ChestnutLabs/gcode-preview/commit/ecfa56b098d721cd5d636f594d07eda9ac2be067), [`808dc56`](https://github.com/ChestnutLabs/gcode-preview/commit/808dc56bf377a435bc457d16fc51e195734e2bb5), [`f3ce24f`](https://github.com/ChestnutLabs/gcode-preview/commit/f3ce24ff5439ef44ca4bac8a12eda91d187f410f), [`de453cb`](https://github.com/ChestnutLabs/gcode-preview/commit/de453cb3a84275dc27c89c20381c7f91289a6a83), [`9cd66b2`](https://github.com/ChestnutLabs/gcode-preview/commit/9cd66b2f23aa32c8832d9e9da13c025cf86278b1), [`bf032d2`](https://github.com/ChestnutLabs/gcode-preview/commit/bf032d2b4e0ce36dcbd8020caead2a512ca3b618)]:
  - @chestnutlabs/gcode-renderer-three@0.16.0
  - @chestnutlabs/toolpath-core@0.16.0
  - @chestnutlabs/gcode-containers@0.16.0

## 0.15.0

### Patch Changes

- Updated dependencies [[`8229075`](https://github.com/ChestnutLabs/gcode-preview/commit/8229075e2737c360c5d255e438ce140f4fbb13da)]:
  - @chestnutlabs/gcode-renderer-three@0.15.0
  - @chestnutlabs/gcode-containers@0.15.0
  - @chestnutlabs/toolpath-core@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [[`60e24e1`](https://github.com/ChestnutLabs/gcode-preview/commit/60e24e15b6b72e9aa097f4d2fd22b0c91a480cea), [`c99b221`](https://github.com/ChestnutLabs/gcode-preview/commit/c99b2219566b6427c3d11d37be04876415db3bea)]:
  - @chestnutlabs/gcode-renderer-three@0.14.0
  - @chestnutlabs/gcode-containers@0.14.0
  - @chestnutlabs/toolpath-core@0.14.0

## 0.13.0

### Minor Changes

- [#363](https://github.com/ChestnutLabs/gcode-preview/pull/363) [`56ed874`](https://github.com/ChestnutLabs/gcode-preview/commit/56ed874f20ef590908f03229f5a40f53f8956da9) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model): decode Bambu/Orca per-object extruder colours (source-model colour convention)

  `parse3mf` now renders the colour a Bambu/Orca source `.3mf` carries via its **project convention**:
  per-object / per-part `<metadata key="extruder">` in `Metadata/model_settings.config` (1-based) indexing the
  `filament_colour` palette in `Metadata/project_settings.config`. Each object/part with no
  basematerials/colorgroup/`paint_color` colour of its own is solid-coloured by its assigned filament, and
  `capabilities.materials` becomes `'known'`. A part's own extruder overrides its parent object's default.

  Honesty preserved: colour is applied **only** when the source actually declares the extruder mapping AND the
  palette resolves the slot — otherwise the object stays neutral (`materials: 'unavailable'`); nothing is
  guessed. This fixes the "No colour data / neutral render" result on multi-part Bambu source models (e.g. the
  Baby_Opossum sheet) whose colour lives in the project metadata rather than in basematerials or `paint_color`.
  Validated against a real production multi-part Bambu `.3mf` (per-part extruder colours resolved correctly,
  alongside parts that carry their own basematerials).

- [#360](https://github.com/ChestnutLabs/gcode-preview/pull/360) [`a75e5cd`](https://github.com/ChestnutLabs/gcode-preview/commit/a75e5cdd075676924eb65ae20df50b1ad39c1264) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model): multi-plate model structure — plate identity as first-class API (DD-025 Phase A)

  `parse3mf` now reads Bambu/Orca `Metadata/model_settings.config` and exposes declared plate structure on
  `ModelScene`: a new `plates: { list: ModelPlateSummary[]; active? }`, a placement-level `plateIds` on each
  `ModelObject` (aligned with `instances` — a reused master can appear on multiple plates, so membership lives
  on the placement, not the master), and a `capabilities.plates` confidence tier (`'known'` only when the
  source **explicitly** declares plates, incl. an explicit single plate; `'unavailable'` for
  undeclared/implicit). `ModelReadyInfo` and `RenderModelStillResult` surface `plates` too, so a consumer can
  build a plate selector. Plate grouping is derived from the source's own declaration (never geometric
  guessing); a plate-less file is honestly one implicit plate. No render change yet — per-plate / all-plates
  presentation is a later phase.

- [#361](https://github.com/ChestnutLabs/gcode-preview/pull/361) [`b8dd6a7`](https://github.com/ChestnutLabs/gcode-preview/commit/b8dd6a7ce05add28f922a7f71641eebe0778a146) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model): staged loading progress on createModelViewer (DD-024 Phase A)

  Adds the shared, typed, consumer-neutral loading-progress contract (`LoadStage` / `LoadUnit` / `LoadProgress`
  in `gcode-renderer-three`) and wires it into `createModelViewer` via a new `onProgress` option — closing the
  gap where the model renderer emitted no progress at all (large models "felt hung"). Events carry typed
  `stage` / `done` / `total` / `unit` (or an honest `indeterminate`) and **no human-facing copy** — the
  consumer owns all wording/i18n. `setSource` emits `parsing` (indeterminate) → `building-geometry` with real
  per-object counts → `ready`. Every event is **generation-scoped**: a superseded/cancelled `setSource` can
  never advance the next load's progress. No render behavior changes.

### Patch Changes

- Updated dependencies [[`377fc70`](https://github.com/ChestnutLabs/gcode-preview/commit/377fc7076e42a6044a9e10f2d4b27bd99fa133f3), [`b8dd6a7`](https://github.com/ChestnutLabs/gcode-preview/commit/b8dd6a7ce05add28f922a7f71641eebe0778a146), [`3be5312`](https://github.com/ChestnutLabs/gcode-preview/commit/3be531219cede19168ddf042ee7954c14d73d74c)]:
  - @chestnutlabs/gcode-renderer-three@0.13.0
  - @chestnutlabs/gcode-containers@0.13.0
  - @chestnutlabs/toolpath-core@0.13.0

## 0.12.0

### Patch Changes

- [#353](https://github.com/ChestnutLabs/gcode-preview/pull/353) [`b710fa1`](https://github.com/ChestnutLabs/gcode-preview/commit/b710fa15b42be22277af4b733bf90bccdc2e1413) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - fix(model-renderer): the fast-reject estimate counts UNIQUE triangles, not baked-per-placement (DD-022)

  The Phase 0 structural estimate summed an external master's triangle estimate **once per placement**, so a
  full-sheet instanced plate (e.g. Baby_Opossum, ~40 reused copies) estimated ~26 M "baked" triangles and was
  **wrongly rejected** with `E_MODEL_TOO_MANY_TRIANGLES` — even though Phase 1 instancing renders it from its
  ~1.5 M **unique** triangles. The still path only escaped it by running with raised limits; the interactive
  `createModelViewer` used defaults and rejected.

  The estimate now counts each unique master (by objectid / external path) **once**, matching the instanced
  render. The placement count still guards an instance bomb via `maxInstances`. So an instanced plate parses
  and renders (interactive and headless) at default limits instead of falsely rejecting; a genuinely huge
  _unique_ mesh is still bounded by the triangle limit. Fixes the "too large to show interactively" regression
  on instanced source `.3mf` plates.

- Updated dependencies [[`8bd6bbd`](https://github.com/ChestnutLabs/gcode-preview/commit/8bd6bbd1dfe7539ee4e3357f84de74c2eb703462)]:
  - @chestnutlabs/gcode-renderer-three@0.12.0
  - @chestnutlabs/gcode-containers@0.12.0
  - @chestnutlabs/toolpath-core@0.12.0

## 0.11.0

### Minor Changes

- [#346](https://github.com/ChestnutLabs/gcode-preview/pull/346) [`c5bfae9`](https://github.com/ChestnutLabs/gcode-preview/commit/c5bfae9254c85519a439e200303cde5b859bfae5) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model-renderer): fast structural reject for oversize / instance-bomb source 3MFs (DD-022 Phase 0)

  Before decompressing any large external geometry part, `parse3mf` now runs a cheap structural estimate from
  the main part's build-item/component tree plus the ZIP directory's uncompressed sizes, and rejects a clear
  instance-bomb or oversize plate in **sub-second** time instead of ~10 s of decompress-and-bake. New
  `ModelLimits.maxInstances` (default 50,000) bounds total instance placements → `E_MODEL_TOO_MANY_INSTANCES`;
  an over-budget triangle estimate → `E_MODEL_TOO_MANY_TRIANGLES` from the estimate rather than mid-bake. The
  estimate under-counts external geometry and applies a ×2 safety margin, so it never false-rejects a file
  that would actually fit — borderline files fall through to the exact per-triangle parse.

  First phase of the instance-aware source-model work ([DD-022](../docs/design/DD-022-model-instancing-and-lod.md)):
  a standalone latency/DoS win. Phase 1 (GPU instancing) will make these plates _render_ instead of reject.
  Additive; existing files and limits are unchanged.

- [#347](https://github.com/ChestnutLabs/gcode-preview/pull/347) [`c7002a6`](https://github.com/ChestnutLabs/gcode-preview/commit/c7002a64ad07f817773d70bba1a7b5a0aafebfcd) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model-renderer): render reused 3MF geometry via GPU instancing instead of baking copies (DD-022 Phase 1a)

  A source `.3mf` that reuses a master mesh via production-extension `<component>` references or repeated
  `<build>` items no longer **bakes** a full world-space copy per placement. `parse3mf` now folds the
  transform chain into per-placement matrices and keeps each master's geometry **once** in local space, and
  `ModelContent` draws it as a single three `InstancedMesh` (one geometry upload, one draw call across all
  placements). So memory and the triangle budget scale with **unique** geometry, not copy count — a
  full-sheet plate of ~40 instanced copies measures as its ~1 master, not ~40× baked.

  New: `ModelObject.instances?: Mat4[]` (present only when a master is reused, length ≥ 2; a single-placement
  object keeps its `transform`) and `ModelScene.capabilities.instanced` (`'known'` when instancing was
  preserved). Additive and render-equivalent for existing files (STL and single-placement 3MF are unchanged;
  the existing suite passes). This is the farm-scale fix behind DD-022; the consumption-boundary disclosure
  (`instancedCount` on `ready`/result) follows in Phase 1b.

- [#348](https://github.com/ChestnutLabs/gcode-preview/pull/348) [`4755198`](https://github.com/ChestnutLabs/gcode-preview/commit/4755198e1bf924690067f37143bc58539e503839) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model-renderer): disclose `instancedCount` + `decimationApplied` on the model ready/still result (DD-022 Phase 1b)

  `RenderModelStillResult` and `createModelViewer`'s `ready.info` (`ModelReadyInfo`) now report
  `instancedCount` (total placements drawn — greater than `objectCount` when the source reused geometry, for
  an "N copies" badge) and a flat `decimationApplied` (1 = none), named identically to the toolpath
  `RenderStillResult.decimationApplied` so a consumer badges "simplified for size" the same way for model and
  toolpath cards. `decimationApplied` is always 1 until model LOD lands (DD-022 Phase 2); it is reserved now
  so the field is stable for consumers wiring the badge against the instancing boundary. Additive.

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-containers@0.11.0
  - @chestnutlabs/gcode-renderer-three@0.11.0
  - @chestnutlabs/toolpath-core@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies [[`a6ae736`](https://github.com/ChestnutLabs/gcode-preview/commit/a6ae736dab468960939b477964790c6ce9130572)]:
  - @chestnutlabs/gcode-renderer-three@0.10.0
  - @chestnutlabs/gcode-containers@0.10.0
  - @chestnutlabs/toolpath-core@0.10.0

## 0.9.0

### Minor Changes

- [#330](https://github.com/ChestnutLabs/gcode-preview/pull/330) [`7b7541d`](https://github.com/ChestnutLabs/gcode-preview/commit/7b7541d52c506af040130604d0fb628d3af94b58) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model-renderer): add the generic open-`kind` model-source loader registry (DD-021 Phase 1)

  Adds a loader registry so the model-source input is a **generic** `{ kind: string; bytes } | ModelScene`
  rather than a baked-in `STL | 3MF` union — new formats (OBJ/STEP/PLY/…) become loadable by registering a
  `ModelLoader`, with no change to the public input type. New exports: `ModelLoader`, `ModelLoadOptions`,
  `ModelSourceInput`, `stlLoader`, `threeMfLoader`, `DEFAULT_MODEL_LOADERS`, `isModelScene`, and
  `resolveModelScene` (which throws `E_MODEL_UNSUPPORTED_KIND` for an unregistered `kind`). The 3MF
  `filament_colour` palette override flows through as a format-agnostic option that non-consuming loaders
  ignore.

  `renderModelStill` is unchanged in signature and output — its internal source dispatch now flows through
  this shared registry (the existing `{kind:'stl'} | {kind:'3mf'} | ModelScene` input stays valid). This is
  the seam the interactive `createModelViewer` (next PR) consumes.

- [#331](https://github.com/ChestnutLabs/gcode-preview/pull/331) [`81f3fc9`](https://github.com/ChestnutLabs/gcode-preview/commit/81f3fc907fedc991fde21664a8726cf706b3ae95) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model-renderer): add `createModelViewer` — the interactive source-model viewer (DD-021 Phase 1)

  Adds `createModelViewer(canvas, options?)` → `ModelViewer`, the **interactive** analogue of
  `renderModelStill`: orbit / zoom / pan a source model (STL / 3MF, including production `paint_color`
  multicolor) in the browser. It composes the pieces that already exist rather than duplicating a renderer —
  the shared `InteractiveStage` (GL + dual camera + orbit/zoom/pan + context-loss recovery + DD-020
  interaction quality) from `@chestnutlabs/gcode-renderer-three`, the shared `ModelContent` scene core, and
  the open-`kind` loader registry.

  Handle: `setSource` (async parse→build→frame, last-wins on overlap), `setView`, `get/setCameraState`,
  `setBackground`, `setInteractionQuality`, `resize`, `frame`, `onEvent`, `dispose`. Events: `ready`
  (`objectCount` / `materials` tier / `bounds`), `camera-changed`, `error` (structured code — e.g.
  `E_MODEL_UNSUPPORTED_KIND`), `renderer-unsupported` (WebGL missing → the consumer can fall back to a
  `renderModelStill` image), and `context-lost` / `context-restored`.

  Capability honesty is passed through from the parsed `ModelScene`, never recomputed (neutral render +
  `materials:'unavailable'` when the source carries no colour). It is a **distinct surface** from
  `ToolpathRenderer` / `<GcodePreview>` — no toolpath concepts (layers/travel/scrub/IR). `renderModelStill`
  is unchanged. New source formats become viewable by registering a `ModelLoader`, with no change to the
  `ModelViewer` / `createModelViewer` signatures.

### Patch Changes

- [#329](https://github.com/ChestnutLabs/gcode-preview/pull/329) [`9c461ef`](https://github.com/ChestnutLabs/gcode-preview/commit/9c461efe6b49ab516724110e84bd9b4b3789a29c) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - refactor(model-renderer): extract the shared presentation scene core into `ModelContent` (DD-021 Phase 1)

  Pulls the model root, studio-light rig, and capability-honest mesh building (including per-triangle
  `paint_color` vertex colours) out of `ModelRenderer` into a new `ModelContent` class that fills a
  provided three.js `Scene`. `ModelRenderer` (and therefore `renderModelStill`) keeps its own headless GL
  - camera and now composes `ModelContent` for scene content — output is unchanged (the renderer suite
    passes byte-for-byte). This gives the upcoming interactive `createModelViewer` (DD-021 Phase 1) one
    shared mesh/lighting/paint path instead of a parallel copy.

- Updated dependencies [[`cc6e1f6`](https://github.com/ChestnutLabs/gcode-preview/commit/cc6e1f6b48e531bc991cb1c7c53846ccbf7ca522), [`dd535d6`](https://github.com/ChestnutLabs/gcode-preview/commit/dd535d64ac71bbd876e83e81dccc6dbb046bf689), [`3299760`](https://github.com/ChestnutLabs/gcode-preview/commit/32997607dbd30db79c91d14d2d8383d99be933af)]:
  - @chestnutlabs/gcode-renderer-three@0.9.0
  - @chestnutlabs/gcode-containers@0.9.0
  - @chestnutlabs/toolpath-core@0.9.0

## 0.8.1

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-containers@0.8.1
  - @chestnutlabs/gcode-renderer-three@0.8.1
  - @chestnutlabs/toolpath-core@0.8.1

## 0.8.0

### Minor Changes

- [#318](https://github.com/ChestnutLabs/gcode-preview/pull/318) [`959e507`](https://github.com/ChestnutLabs/gcode-preview/commit/959e50779f3e2f84672a10e0e9ec0bfc5174f691) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model-renderer): decode Bambu/Orca 3MF `paint_color` for production multicolor

  Real designer-authored Bambu Studio / OrcaSlicer 3MF files paint per-region colour with a proprietary
  `paint_color` facet attribute and keep the palette in `project_settings.config` — not in standard 3MF
  materials. `parse3mf` / `renderModelStill` now decode that facet-paint format (clean-room from the
  observed encoding, see RR-005) and read the `filament_colour` palette themselves, so a multicolor
  source model renders in its true colours without slicing. Capability-honest: `materials: 'known'`
  (or `'approximated'` when a few multi-colour facets are flattened), and still `'unavailable'` — neutral
  default, never a fabricated colour — when no palette is present.

  `@chestnutlabs/gcode-containers` gains an exported `filamentColoursFromSettings(settings)` helper so the
  "which key is the palette" semantics live in one place, shared by the toolpath and model paths.

- [#320](https://github.com/ChestnutLabs/gcode-preview/pull/320) [`2c9cdcb`](https://github.com/ChestnutLabs/gcode-preview/commit/2c9cdcb84f9fc8d5b80024a1f8da9e1f61137b8d) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model-renderer): optional `filamentPalette` override on `renderModelStill` / `parse3mf`

  Consumers that already hold a corrected or richer filament palette (e.g. re-rendering a sliced
  `.gcode.3mf`) can pass `filamentPalette` (hex `#RRGGBB` per 0-based slot) to override the palette read
  from the file's `project_settings.config` when colouring `paint_color` facets. Additive and optional —
  the renderer stays self-sufficient and reads the file's own palette without it. Mirrors the toolpath
  renderer's `mode: 'tool'` colour seam.

### Patch Changes

- Updated dependencies [[`959e507`](https://github.com/ChestnutLabs/gcode-preview/commit/959e50779f3e2f84672a10e0e9ec0bfc5174f691)]:
  - @chestnutlabs/gcode-containers@0.8.0
  - @chestnutlabs/gcode-renderer-three@0.8.0
  - @chestnutlabs/toolpath-core@0.8.0

## 0.7.0

### Minor Changes

- [#311](https://github.com/ChestnutLabs/gcode-preview/pull/311) [`5e156ec`](https://github.com/ChestnutLabs/gcode-preview/commit/5e156ec62d813691cbca2a939c97fb695c7ccd5f) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - 3MF **Production Extension** support in `parse3mf` (the Bambu Studio / MakerWorld default layout). A
  production-extension file has a small `3D/3dmodel.model` shell whose `<build><item>` points at a
  `<components>` object that references the real mesh in an **external** part (`<component
p:path="/3D/Objects/*.model" objectid=… transform=…/>`). Previously this parsed as "no renderable
  geometry"; now the parser follows `p:path` into the referenced part, resolves the object, and composes
  the component transform with the build-item transform — resolving nested components across parts (depth-
  guarded). The inline-mesh case is unchanged; materials resolve from whichever part defines the mesh's
  colors.

  Note: some vendors (e.g. Bambu) encode multicolor via a proprietary per-triangle `paint_color` attribute
  plus filament colors in `project_settings.config`, not standard 3MF materials. Those still render with
  correct geometry and honest `materials: 'unavailable'` (a neutral model, never a fabricated color) —
  decoding vendor paint into true colors is a separate follow-up.

### Patch Changes

- Updated dependencies [[`bbdef97`](https://github.com/ChestnutLabs/gcode-preview/commit/bbdef97d8a1eb77a3864291918f7f5aace559ff2), [`39ede6e`](https://github.com/ChestnutLabs/gcode-preview/commit/39ede6ebc0a1ba594a391f1b33db2bdf3445d414), [`caaa0fa`](https://github.com/ChestnutLabs/gcode-preview/commit/caaa0fad0938bfa3ac1cd9f312f9cd2355c722d1), [`1c15c5e`](https://github.com/ChestnutLabs/gcode-preview/commit/1c15c5ea38f69aba99478cec60e4a0af28b9cae4)]:
  - @chestnutlabs/gcode-renderer-three@0.7.0
  - @chestnutlabs/toolpath-core@0.7.0
  - @chestnutlabs/gcode-containers@0.7.0

## 0.6.0

### Minor Changes

- [#304](https://github.com/ChestnutLabs/gcode-preview/pull/304) [`380b96e`](https://github.com/ChestnutLabs/gcode-preview/commit/380b96e5e4434e0e7d974cf8853fb6fd21d4dd0b) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - ModelRenderer **Phase 2 — 3MF multi-object / material / color** (DD-018), completing the v1 renderer.
  - `parse3mf(bytes)` and `renderModelStill({ kind: '3mf', bytes }, …)` — a multicolor 3MF renders to a
    **multicolor thumbnail without slicing**. Multiple objects, per-object build-item transforms, and
    **per-object or per-triangle solid colors** (`<basematerials displaycolor>` / `<m:colorgroup>`); sRGB
    → linear. Capability-honest: `materials`/`transforms`/`multiObject` report `'known'` only when the
    source actually carried them, else `'unavailable'` (neutral render, never fabricated).
  - The 3MF ZIP is opened with the hardened, zero-dep reader from `@chestnutlabs/gcode-containers`
    (zip-bomb / traversal / size caps reused, DD-005 §7); the model XML is parsed with a minimal,
    worker-safe scan (no `DOMParser`). Textures / non-color material properties are ignored, never fetched.
  - **`renderModelStill` is now async** (`Promise<RenderModelStillResult>`), because 3MF unzip uses
    `DecompressionStream` — matching the async `renderStill` on the toolpath side.
  - `MeshGeometry` gains an optional per-vertex `colors` buffer (for a single mesh carrying multiple
    colors); the renderer uses vertex colors when present.

- [#303](https://github.com/ChestnutLabs/gcode-preview/pull/303) [`7b8a29d`](https://github.com/ChestnutLabs/gcode-preview/commit/7b8a29d738d696e397a9f23e5f2bd3a8625ed29e) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - New package **`@chestnutlabs/gcode-model-renderer`** — a Three.js **presentation** renderer for source
  models, distinct from toolpath inspection (DD-018, Phase 1: the STL proving slice).
  - `renderModelStill(source, options)` — headless single-frame thumbnail preset (OffscreenCanvas /
    ANGLE→SwiftShader), mirroring `renderStill`; **transparent** or themed-solid background; deterministic
    export + a stable `(sourceHash, options, envId)` cache key.
  - `ModelRenderer` — sits on the shared render "stage" from `gcode-renderer-three` (framing pose, GL
    builder with `alpha`, GL type contracts); its own presentation studio lighting.
  - Three-free, **multi-object + material-capable** `ModelScene` from day one (STL is the degenerate
    single-object/no-material case; 3MF multi-object/material lands next). Capability-honest color: a model
    with no declared material renders neutral and reports `materials: 'unavailable'` — never fabricated.
  - STL binary + ASCII via three's `STLLoader`; bounded (`maxTriangles`/`maxSourceBytes`) with structured
    `ModelParseError`s. `three` is a peer dependency.

### Patch Changes

- Updated dependencies [[`277e148`](https://github.com/ChestnutLabs/gcode-preview/commit/277e1481ba015d6d0fa8d5b4e5ff6c7e014d494b), [`ac1e1f9`](https://github.com/ChestnutLabs/gcode-preview/commit/ac1e1f984305071db1a16fd8bbd7f1166b877d9d)]:
  - @chestnutlabs/gcode-renderer-three@0.6.0
  - @chestnutlabs/gcode-containers@0.6.0
  - @chestnutlabs/toolpath-core@0.6.0
