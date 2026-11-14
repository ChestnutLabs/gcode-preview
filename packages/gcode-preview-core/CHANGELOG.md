# @chestnutlabs/gcode-preview-core

## 0.24.0

### Minor Changes

- [`51145d8`](https://github.com/ChestnutLabs/gcode-preview/commit/51145d8dce4934c4f048bc33831161de5404210f) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - A bad viewer option now throws at once, not after the 3D renderer loads. Until now, a typo such as
  `cameraMode: 'ortho'` or a theme opacity of `2` passed to `createPreviewController` (or as an adapter prop) only
  failed inside the on-demand 3D load. The viewer then reported `E_RENDERER_LOAD` and showed no 3D view. The same value
  passed to a setter before the load came back later as `E_CONTROL_REJECTED`.
  - **Same rule, same message, earlier.** The constructor and the setters throw `RangeError` synchronously for
    `theme`, `buildVolume`, `cameraMode`, `qualityMode`, `progressivePreview`, `frameContent`,
    `interactionQuality` and `renderer.mode`, and for `setView` and `setCameraState`. Nothing is queued. Every value
    that works today still works.
  - **`null` and `undefined` are not an error.** An option left `null` (a cleared Vue prop or Svelte binding, say) gets
    the default; before, some of them (`buildVolume`, `qualityMode`, `progressivePreview`, `cameraMode`) threw or failed
    the 3D load. A prop cleared to `null` after mount leaves the current value. `setFrameContent` and `setInteractionQuality` with `null` or `undefined` apply `'all'` and
    `'off'`. `setBuildVolume(null)` does nothing (the current plate stays; on the model viewer it still removes the
    plate), and a `buildVolume: null` option lets a bed found in the file apply. `colorMode: null` still throws.
    Before, `setBuildVolume(null)` threw a `TypeError` from inside the renderer.
  - **Vue and Svelte:** `:build-volume="null"` (Vue) and `buildVolume={null}` (Svelte) no longer throw a `TypeError` at
    mount. On Svelte, an empty `qualityMode` or `progressivePreview` means the default, at mount as after it. Clearing
    `cameraMode`, `view`, `cameraFov` or `pixelRatio` to `null` after mount (plus `qualityMode` and
    `progressivePreview` on Vue) now keeps the current value. Before, it threw `RangeError` (a 2D viewer ignored some).
  - **2D viewers check too.** A bad 3D option on a `renderer: { mode: '2d' }` viewer used to be ignored. It now throws,
    as `cameraFov`, `pixelRatio` and `colorMode` already did. `frameContent`, `interactionQuality`, `setView` and
    `renderer.mode` had no check at all before, so a typo there now throws in every mode.
  - **New in `@chestnutlabs/gcode-renderer-three` (and `/lite`):** the checks themselves (`checkTheme`,
    `checkBuildVolume`, `checkCameraMode`, `checkCameraView`, `checkCameraState`, `checkCameraFov`, `checkPixelRatio`,
    `checkQualityMode`, `checkProgressivePreview`, `checkFrameContent`, `checkInteractionQuality`,
    `checkRendererMode`) and the allowed values as `readonly` arrays (`CAMERA_MODES`, `CAMERA_VIEWS`,
    `QUALITY_POLICIES`, `PROGRESSIVE_PREVIEW_MODES`, `FRAME_CONTENT_MODES`, `INTERACTION_QUALITY_MODES`,
    `RENDERER_MODES`), plus `MAX_GRID_LINES_PER_AXIS`. The renderer uses the same functions, so each rule exists once.
  - **Web Component:** `<gcode-preview>`'s `buildVolume = null` is now no volume, before and after connect. It threw a
    `TypeError` (`'bed' in null`). Otherwise unchanged: a bad property value throws, and a bad attribute value
    (`camera-mode="ortho"`) is ignored, as before.

- [#597](https://github.com/ChestnutLabs/gcode-preview/pull/597) [`d895700`](https://github.com/ChestnutLabs/gcode-preview/commit/d895700aeb702dbf5a5e1e00479881220ae97856) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - CNC and laser Cut moves are now their own toggleable move kind (`'cut'`), no longer hidden or dropped with travel.
  - **Fixes:** a Cut segment used to land in the travel chunk. Hiding travel hid the cuts (so a CNC file looked empty),
    and under decimation the cuts were dropped along with travel.
  - **Decimation:** cuts now follow the same rule as extrusion (kept if first/last of a layer or every Nth), so a large
    CNC file thins out instead of disappearing.
  - **New toggle:** `setKindVisible('cut', visible)`, `showCut` on Vue, React, Svelte and `renderStill` (default `true`),
    and `show-cut` / `showCut` on `<gcode-preview>`.
  - **2D view:** draws Cut moves too, and honours the same toggle (see the `gcode-renderer-2d` entry).
  - FDM files have no Cut moves and render exactly as before.

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

- [#604](https://github.com/ChestnutLabs/gcode-preview/pull/604) [`ffd8ce7`](https://github.com/ChestnutLabs/gcode-preview/commit/ffd8ce785489292791ea031b16d8f591e3461e7b) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - The 2D view now draws CNC and laser Cut moves. A CNC file used to show nothing in 2D with travel hidden.
  - **Drawing:** Cut moves are drawn with the extrusion, in file order, coloured by the same colour mode (`moveKind`
    gives them the cut colour). Ghost layers and the live-progress dimming include them.
  - **New toggle:** `cut` on `drawLayer`, `drawLayers` and `LayerView2D` options (default `true`), and
    `LayerView2D.setCut(visible)`. On `GcodePreview` with `renderer="2d"`, `setKindVisible('cut', visible)` and
    `showCut` / `show-cut` now take effect.
  - **Counts:** the draw results gain `cutDrawn`. A move that is both an extrusion and a cut counts once, as
    extrusion. `summarize2DDrawable` and the 2D `build-complete` segment count include Cut moves.
  - FDM files have no Cut moves and draw exactly as before (pinned by draw-stream digests of four real files).

### Patch Changes

- [#565](https://github.com/ChestnutLabs/gcode-preview/pull/565) [`b792e0c`](https://github.com/ChestnutLabs/gcode-preview/commit/b792e0cb1b1d0680f125281b88eb03fc406390a0) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - The `scrub`, `scrubTime` and `layerRange` props now keep applying across mount and source changes.
  - **A `scrub` prop set at mount now cuts the view.** In Vue, React and Svelte, `<GcodePreview scrub={1}>` with no
    `scrubTime` showed the whole toolpath: the unset `scrubTime` was sent as a clear at mount and replaced the cut.
    An unset prop now sends nothing. Changing a prop from a number to `null` still clears the cut.
  - **A `scrub`, `scrubTime` or `layerRange` prop now also applies to the next file when `source` changes.** It used
    to show the new file uncut while the prop still held its value. This holds on all four adapters (the
    `<gcode-preview>` `source` property included). A range or cut you set from a `ready` handler for the new file
    still wins, so a consumer that resets its range to the new file's layer count on `ready` ends on that range.
  - **When both `scrub` and `scrubTime` hold a value, `scrubTime` wins** at mount, and on a source change that leaves
    both props as they were, as it already did on `<gcode-preview>`. A prop that changes in the same update as `source`
    is applied last, so it wins: changing `scrub` together with `source` cuts the new file at the new `scrub`, even
    while `scrubTime` still holds its value.
  - **A `parse()` started from a `parse-complete` (`ready`) handler now owns a cut made right after it in the
    same handler.** The cut used to reach the file that was finishing and was lost when the new one loaded.

- [#534](https://github.com/ChestnutLabs/gcode-preview/pull/534) [`eae5fda`](https://github.com/ChestnutLabs/gcode-preview/commit/eae5fdaa4ff69db94e6a30607bdeddb767863fe8) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - The toolpath components now tell you when the renderer can't honour a setting ([#520](https://github.com/ChestnutLabs/gcode-preview/issues/520)). Before, only the
  lower-level `onEvent` received it.
  - **New event:** React `onRendererUnsupported`, Vue `@renderer-unsupported`, Svelte `on:rendererunsupported`, and
    `renderer-unsupported` on `<gcode-preview>`. The payload is `{ feature, message }`; the names match the `/model`
    viewers.
  - **When it fires:** on the 2D renderer (`renderer="2d"`), for a lens, pixel ratio, quality, camera mode, preset view,
    camera state, retraction markers, or a non-planar toolpath. It fires once per request, with no dedupe.
  - **At mount:** on every adapter, `quality`, `cameraMode`, `cameraFov` or `pixelRatio` set to a non-default value
    fires it once. A default (`'auto'`, `'perspective'`, a 50-degree lens, no ratio) fires nothing, written out or not.
  - **No extra 3D work at mount:** a 3D view no longer re-applies these props at mount, since it was built with them.
    Before, React and Svelte re-applied `quality`, which rebuilt the view when the parse finished before three.js
    loaded. React now builds the 3D view with `pixelRatio` too, like the other adapters, so under StrictMode the
    ratio set at mount reaches the live view.
  - **Svelte:** `quality`, `cameraMode`, `cameraFov` and `pixelRatio` now apply only when their value changes.
  - **Core `testing.ts`:** `ComponentHarness` callbacks gain an optional `onRendererUnsupported`, `MountedComponent`
    an optional `setCameraMode`, and `ComponentMountOptions` gains `cameraFov` and `pixelRatio`. Two conformance cases
    are new. A harness that doesn't wire the callback fails them with an explicit message.

- [#576](https://github.com/ChestnutLabs/gcode-preview/pull/576) [`01d9d9f`](https://github.com/ChestnutLabs/gcode-preview/commit/01d9d9f9911eee0042d939d871fd10fc47a2932c) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - A 2D-only app no longer ships three.js. From v0.18.0 through v0.23.0, any bundle that imported
  `@chestnutlabs/gcode-preview-core` (or a framework adapter) loaded all of three.js at startup, about 600 KB minified,
  even with `renderer: { mode: '2d' }`. The 3D renderer was meant to load on demand, and now it does again. Measured on
  `createPreviewController({ renderer: { mode: '2d' } })`: the startup bundle drops from 634 KB to 35 KB with Vite and from
  641 KB to 37 KB with esbuild. Three.js moves to a chunk that loads only when a 3D view binds.
  - **No API change.** Every import keeps working. `renderStill` loads the 3D renderer when it is called, so the first
    call does one extra dynamic import.
  - **New: `@chestnutlabs/gcode-renderer-three/lite`.** A three-free entry with `CaptureUnsupportedError`, `studioTheme`,
    `STUDIO_CAMERA_FOV` and the theme, camera and capture types. Core imports only this entry statically. You normally
    don't need it, because the main entry exports the same values.
  - **Your own tests:** the first 3D view now loads the renderer module when it binds, not when core is imported. A
    test that waits a fixed number of ticks for the 3D renderer to bind may need it preloaded once in its setup:
    `await import('@chestnutlabs/gcode-renderer-three')`.
  - **If that load fails** (offline, or a stale deploy whose chunk now returns 404), the preview reports an `error`
    event with code `E_RENDERER_LOAD`, as it does for any 3D renderer that cannot start.

- [#542](https://github.com/ChestnutLabs/gcode-preview/pull/542) [`1c07e9d`](https://github.com/ChestnutLabs/gcode-preview/commit/1c07e9d05e5439319ca3095da50dd9aabb2ca6a2) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - The preview controller no longer misreports a rejected control or a throwing subscriber, and it rejects
  `NaN` layer and scrub positions. Vue, React, Svelte and the Web Component inherit every change.
  - **A rejected queued control is reported as `E_CONTROL_REJECTED`.** A control you call before the 3D
    renderer has loaded is queued and replayed once it binds. If the renderer rejected one of those calls,
    for example `setTheme({ gridOpacity: 2 })` or a `setBuildVolume` it cannot draw, the bind used to
    report `E_RENDERER_LOAD`, although the renderer was bound. Every call queued after the bad one was lost.
    Now each rejected call sets `state.error` and fires an `error` event with code `E_CONTROL_REJECTED`.
    The message names the control and quotes the renderer's error, for example
    `setTheme rejected: theme gridOpacity must be a number in [0,1] (got 2)`. The calls queued after it
    still apply, and a rebind replays nothing twice. `bindCanvas` never throws because of a queued call,
    in 2D or 3D. A call made after the renderer is bound still throws its `RangeError` to you, as before.
  - **A throwing subscriber no longer changes a parse's outcome.** If an `onStateChange` or `onEvent`
    callback threw during a parse, `parse()` resolved `{ ok: false, error: { code: 'E_UNKNOWN' } }` for a
    file that had loaded. `parse-complete` and the capability state (`availableColorModes`,
    `hasRetractions`, `hasColorChanges`) were also skipped, and a throw at the very end could reject
    `parse()`. Now each subscriber runs on its own: the others still run, and the parse outcome reflects
    only the parse. A throwing listener no longer makes `parse()` reject or report `parse-error`. The
    subscriber's error is re-thrown from a microtask, so it still shows up as an uncaught error.
    If a subscriber disposes the preview or rebinds its canvas while the renderer binds (loading the file
    or replaying queued calls), the old renderer gets no further calls, and `state.layerCount` and
    `state.segmentCount` no longer drop to 0. A rebind during replay drops the queued calls that had not run
    yet: the new view starts from the construction options, as on any rebind.
  - **These calls now throw `RangeError` for a value that is not a number, or is `NaN`:**
    `setLayerRange(startLayer, endLayer)` (either end), `setScrubPosition(segIndex)` and
    `setScrubTime(ms)`. They throw at once, before anything is queued, even before the renderer has loaded.
    `null` (clear) and `±Infinity` (an open end) are still accepted. Before, a `NaN` reached the 3D
    renderer's draw state, and `setScrubTime(NaN)` silently drew nothing.
  - **The Web Component ignores a non-numeric `scrub` or `scrub-time` attribute.** `scrub="abc"` (or
    setting the `scrub` / `scrubTime` property to `NaN`) keeps the previous cut instead of throwing, so the
    source still parses. A number, including `Infinity`, still applies, and removing the attribute clears.
  - **`<gcode-preview scrub="5">` keeps its initial cut.** Without a `scrub-time` attribute, connecting the
    element used to clear the cut that `scrub` had just set. When both are set, `scrub-time` is applied last.
  - **`setScrubTime(ms)` before a successful parse does nothing, as documented.** It used to clear an
    existing scrub cut. `setScrubTime(null)` still clears.

- [#608](https://github.com/ChestnutLabs/gcode-preview/pull/608) [`53d2d47`](https://github.com/ChestnutLabs/gcode-preview/commit/53d2d47f04fe782dbf1dee232d34788f0122cb67) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - The decimation notice in `state.disclosure` now says `Showing every 3rd drawn segment (layer boundaries kept); …`
  instead of `… extrusion segment …`. Auto-decimation also thins CNC and laser cut moves, so "extrusion" named the
  wrong move kind. If you match on the old text, match on the new one.

- [#596](https://github.com/ChestnutLabs/gcode-preview/pull/596) [`adae623`](https://github.com/ChestnutLabs/gcode-preview/commit/adae6230cda908bc20d95e9b5d3036b5298d871f) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Errors now keep the original error, and `E_RENDERER_LOAD` says whether the 3D renderer failed to load or to start.
  - **`cause`.** `state.error`, the `error` and `parse-error` events and a failed `parse()` outcome now carry
    `cause` when there is an underlying error, on every adapter's callback and event too. For example, the browser's
    `SecurityError` behind `E_WORKER_CREATE_FAILED`, the error the WebGL renderer threw behind `E_RENDERER_LOAD`, or
    the renderer's `RangeError` behind `E_CONTROL_REJECTED`. Check `error.cause?.name` instead of matching on
    `message`. `cause` is for reading, not persisting: `structuredClone(state)` throws `DataCloneError` when a cause
    can't be copied. Errors with no underlying error have no `cause` key.
  - **`reason` on `E_RENDERER_LOAD`.** `'load'` means the renderer's code could not be downloaded (offline, or a
    stale deploy): reloading can help. `'start'` means it downloaded but could not start, usually because there is no
    WebGL: fall back to `renderer: { mode: '2d' }`. The code is still `E_RENDERER_LOAD`, so existing checks keep
    working.
  - **`E_POST_FAILED`** from `GcodeParseSession` now carries the browser's error (for example `DataCloneError`) on
    `error.cause`, as `E_WORKER_CREATE_FAILED` already did.
  - New exported types: `PreviewError` and `RendererFailureReason`, re-exported by every adapter.
  - **If your tests compare errors exactly:** an assertion like `expect(state.error).toEqual({ code, message })` now
    fails whenever a `cause` or `reason` is present. Use `toMatchObject({ code, message })`, or compare `.code` and
    `.message`.

- [#593](https://github.com/ChestnutLabs/gcode-preview/pull/593) [`7b459c8`](https://github.com/ChestnutLabs/gcode-preview/commit/7b459c8e0ec13fd9bed21c88b9fe2026fbb1cffb) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - A parse whose input throws now keeps the parse event contract (every `parse-started` is followed by exactly one
  terminal event, then `parsing: false`).
  - **Core:** `controller.parse(null)` (or `undefined`, or a primitive) used to throw before any event and leave
    `state.parsing` `true` for good. It now emits `parse-started` (0 bytes) and `parse-error` with code `E_UNKNOWN`
    (`parse input must be a Uint8Array, ArrayBuffer or File (got null)`), resolves `{ ok: false, error }` and resets
    `parsing`. That includes a string: no adapter's types allow one, but from plain JavaScript a string used to be
    sent to the parse worker, and it is now refused the same way. An input whose size cannot be read reports `parse-started` with 0 bytes instead of throwing.
  - **Parser:** an input whose `getReader` getter throws used to leave `GcodeParseSession` busy, so every later
    `parse()` failed with `E_BUSY` until `dispose()`. It now rejects with `E_POST_FAILED` (as a failed `postMessage`
    does, [#453](https://github.com/ChestnutLabs/gcode-preview/issues/453)) and the session stays usable.

- [#550](https://github.com/ChestnutLabs/gcode-preview/pull/550) [`00120ff`](https://github.com/ChestnutLabs/gcode-preview/commit/00120ff15676daab70bc258741752453ed423a19) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - `renderStill` now rejects options that would draw a blank or broken still, instead of rendering one silently.
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

- [#558](https://github.com/ChestnutLabs/gcode-preview/pull/558) [`50ac885`](https://github.com/ChestnutLabs/gcode-preview/commit/50ac8851db4157061f06c93157420236a1349e25) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Scrub and layer-range calls made while a file is loading are no longer lost. Vue, React, Svelte and the
  Web Component inherit the fix.
  - **A cut or layer range set before the file is shown now applies to that file.** Loading a file resets
    the view to the whole toolpath. A `setScrubPosition`, `setScrubTime` or `setLayerRange` call made before
    the first file finished loading, or while a new file was loading, could reach the renderer first and be
    wiped by that reset, depending on whether the 3D renderer had finished loading. Such a call now applies
    to the file being loaded, whatever the order.
  - **`setScrubTime` before a file has loaded now takes effect.** There is no print-time axis until a file
    loads, so the call used to do nothing. It is now resolved on the loaded file's own time axis.
  - **The latest call wins, and a clear counts.** `setScrubPosition(5)` then `setScrubPosition(null)` before
    the load leaves no cut. A failed or cancelled load keeps the request for the next file that loads.
  - **Unchanged:** a call made once a file is shown applies to that file only, including one made from a
    `parse-complete` (Web Component `ready`) handler or a state listener. The next file you load still starts
    with the whole toolpath visible.

- [#571](https://github.com/ChestnutLabs/gcode-preview/pull/571) [`5f43b93`](https://github.com/ChestnutLabs/gcode-preview/commit/5f43b93abd7ddc5f167d9a14824d00605aed63b7) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - A worker that can't be created no longer leaves the preview stuck on "parsing".
  - **The preview recovers.** If `createWorker` (or the default worker) throws, for example `SecurityError` under a strict
    Content Security Policy, the preview used to emit `parse-started`, throw out of `parse()`, and stay at
    `parsing: true` with no `parse-error`. It now emits `parse-error` with code `E_WORKER_CREATE_FAILED`, sets
    `state.error`, and returns to `parsing: false`. The next `parse()` tries to create the worker again. All four
    adapters inherit this.
  - **Error shape change for `GcodeParseSession` and `renderStill` callers.** `session.parse()` and `renderStill()` now
    reject with a `ParseSessionError` whose `code` is `E_WORKER_CREATE_FAILED`, instead of the raw error the factory
    threw. The message keeps the original text (`could not start the parse worker: <original message>`), and the
    original error is on `error.cause`. **If you match on the original error, for example `err.name === 'SecurityError'`,
    read `err.cause.name` instead.** `session.parse()` no longer throws synchronously in this case.

- [#608](https://github.com/ChestnutLabs/gcode-preview/pull/608) [`53d2d47`](https://github.com/ChestnutLabs/gcode-preview/commit/53d2d47f04fe782dbf1dee232d34788f0122cb67) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - The `pixelRatio` option no longer stops the 3D view from starting. Since 0.22.0, a `pixelRatio` that changed the
  ratio at start-up (`2`, or `'device'` on a high-DPI screen) drew a frame before the cameras existed: the preview
  reported `E_RENDERER_LOAD` and drew nothing, and the model viewer stayed blank. `setPixelRatio()` after start-up was
  not affected.

  The testing helpers now catch this: the stub GLs in `@chestnutlabs/gcode-preview-core/testing` (`makeSuiteStubGL`)
  and `@chestnutlabs/gcode-model-renderer/testing` (`MODEL_STUB_GL`, `makeModelRecordingGL`) read the camera the way
  three does, and `ModelAdapterHarness.create` takes an optional `{ pixelRatio }` that your harness passes to the
  viewer at mount.

- [#554](https://github.com/ChestnutLabs/gcode-preview/pull/554) [`c0c799a`](https://github.com/ChestnutLabs/gcode-preview/commit/c0c799a6f5f24fd309cf9ac9a1c59da73c6f679f) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - The 2D view no longer goes blank when you clear the layer range. With `renderer: '2d'`, setting
  `layerRange` back to `null` (React, Vue, Svelte) or removing the `<gcode-preview>` layer-range attribute
  after a file had loaded left an empty canvas. It now shows the top layer, as the 3D view does.
  - **Layer requests:** `setLayerRange(start, end)` in 2D shows layer `end`, now floored (a slider value of
    `2.5` shows layer 2). An `end` past the last layer, `Infinity` included, shows the top layer, and it
    stays the top layer when you load a file with more layers. A `NaN` end is ignored. `LayerView2D.setLayer`
    behaves the same way.
  - **Option checks:** `LayerView2D` and the core `LayerView2DRenderer` now throw a `RangeError` for
    `adjacentLayers: NaN`, a `ghostOpacity` outside `[0, 1]` or `NaN`, and a `lineWidth` that isn't a finite
    number above 0. `LayerView2D` also rejects a negative or non-finite `padding`, and `setAdjacentLayers(NaN)`
    throws with the previous count kept. Before, these drew wrongly with no error (a `NaN` opacity drew the
    ghost layers at full strength). Through the core controller, a bad `adjacentLayers` or `ghostOpacity`
    throws from `bindCanvas`. On `<gcode-preview renderer="2d">` a non-numeric `adjacent-layers` attribute is
    bad markup: it is ignored (one ghost layer, the default) and the element still draws.
  - **Travel toggle:** turning travel back on in 2D keeps the travel style you gave the renderer, instead of
    switching to the default grey.
  - **After `dispose()`:** the 2D renderer no longer draws, matching the 3D renderer. A size that is `NaN`,
    infinite or below 1 is clamped to 1 pixel instead of emptying the canvas.
  - **Core `testing.ts`:** `AdapterHarness.create` accepts an optional `renderer: '2d'`. One new behavioral
    case runs the layer-range clip-and-restore check on 2D, and `installSuite2DProbe()` gives a DOM shim such
    as happy-dom a recording Canvas 2D context. A harness that ignores `renderer: '2d'` fails the case with an
    explicit message.

- Updated dependencies [[`dc4387f`](https://github.com/ChestnutLabs/gcode-preview/commit/dc4387f5361807fed66d9870294fa7400afd1079), [`7a95b00`](https://github.com/ChestnutLabs/gcode-preview/commit/7a95b00ce7ad65ae8f8d4090070d0ea583310446), [`01d9d9f`](https://github.com/ChestnutLabs/gcode-preview/commit/01d9d9f9911eee0042d939d871fd10fc47a2932c), [`adae623`](https://github.com/ChestnutLabs/gcode-preview/commit/adae6230cda908bc20d95e9b5d3036b5298d871f), [`51145d8`](https://github.com/ChestnutLabs/gcode-preview/commit/51145d8dce4934c4f048bc33831161de5404210f), [`7b459c8`](https://github.com/ChestnutLabs/gcode-preview/commit/7b459c8e0ec13fd9bed21c88b9fe2026fbb1cffb), [`e6ca4e8`](https://github.com/ChestnutLabs/gcode-preview/commit/e6ca4e857a1ee599ffc516562b022ece6bbebe8b), [`d895700`](https://github.com/ChestnutLabs/gcode-preview/commit/d895700aeb702dbf5a5e1e00479881220ae97856), [`c502ad7`](https://github.com/ChestnutLabs/gcode-preview/commit/c502ad7666684f9bb6d77df6ce34f5214ac4bafa), [`4713f01`](https://github.com/ChestnutLabs/gcode-preview/commit/4713f01671cf2487d2d85e4046c22fc3c9d2fcd1), [`eb6b74c`](https://github.com/ChestnutLabs/gcode-preview/commit/eb6b74c0f9a8a7b0e28060d672d1021dab2a63d5), [`118f0b3`](https://github.com/ChestnutLabs/gcode-preview/commit/118f0b398ee7bd1afa2160ffbb3081fe4ff194a9), [`deed06d`](https://github.com/ChestnutLabs/gcode-preview/commit/deed06daa26391b8f01e4671bf660deca1dac4a5), [`eb6b74c`](https://github.com/ChestnutLabs/gcode-preview/commit/eb6b74c0f9a8a7b0e28060d672d1021dab2a63d5), [`782f058`](https://github.com/ChestnutLabs/gcode-preview/commit/782f0587bd9ffd9eec3911b170bfd825cca8af08), [`e5c9013`](https://github.com/ChestnutLabs/gcode-preview/commit/e5c9013b62087cef3a71cb54d3f9671c44f565f1), [`5f43b93`](https://github.com/ChestnutLabs/gcode-preview/commit/5f43b93abd7ddc5f167d9a14824d00605aed63b7), [`53d2d47`](https://github.com/ChestnutLabs/gcode-preview/commit/53d2d47f04fe782dbf1dee232d34788f0122cb67), [`ffd8ce7`](https://github.com/ChestnutLabs/gcode-preview/commit/ffd8ce785489292791ea031b16d8f591e3461e7b), [`c0c799a`](https://github.com/ChestnutLabs/gcode-preview/commit/c0c799a6f5f24fd309cf9ac9a1c59da73c6f679f), [`6ac0492`](https://github.com/ChestnutLabs/gcode-preview/commit/6ac04923113acae681366f5b64b86f1976fc1759), [`e7e5bd4`](https://github.com/ChestnutLabs/gcode-preview/commit/e7e5bd432dd601a780f1f3809888e1f5aef5fb21), [`6b03f42`](https://github.com/ChestnutLabs/gcode-preview/commit/6b03f4221e5f0a552959fbed7f85124203d42f57)]:
  - @chestnutlabs/gcode-parser@0.24.0
  - @chestnutlabs/gcode-renderer-three@0.24.0
  - @chestnutlabs/toolpath-core@0.24.0
  - @chestnutlabs/gcode-renderer-2d@0.24.0

## 0.23.0

### Minor Changes

- [#523](https://github.com/ChestnutLabs/gcode-preview/pull/523) [`3ae53e9`](https://github.com/ChestnutLabs/gcode-preview/commit/3ae53e9cf687e62f0a4c2bfeee0900fb5a56d76c) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Segments skipped for an `Infinity` or `NaN` coordinate are now disclosed, in 2D and 3D ([#518](https://github.com/ChestnutLabs/gcode-preview/issues/518)).
  - **The `disclosure` text names the count.** When a toolpath you build yourself has segments with a
    non-finite coordinate, the renderer skips them. `GcodePreviewState.disclosure` and the `disclosure`
    callback in Vue, React, Svelte and the Web Component now say so, for example
    `3 segments with a non-finite coordinate were not drawn.` (`1 segment … was not drawn.` for one). When
    decimation also applies, the sentence follows the decimation sentence. The 2D view checks x and y over
    extrusion and travel. The 3D renderer checks x, y and z over every segment it builds. Both count the
    whole toolpath, travel included whether or not it is shown.
  - **2D mode now fires `build-complete`.** With `renderer: '2d'`, the 2D view emits `buildComplete` once
    each time a toolpath loads: the number of drawable segments, `decimationApplied: 1`,
    `travelHidden: false`, `quality: 'lines'`. It fires after parse-complete, as in 3D, so a
    build-complete handler reads the new file's `layerCount` and `segmentCount`. Before, it never fired in 2D, so `onBuildComplete` and
    `onDisclosure` (and their Vue, Svelte and Web Component equivalents) stayed silent. `activeQuality`
    now reads `'lines'` after a 2D load instead of `null`.
  - **`gcode-renderer-three`:** the `buildComplete` event carries an optional `skippedNonFinite` count.
  - **`gcode-renderer-2d`:** new `summarize2DDrawable(ir)` returns `{ drawable, skippedNonFinite }` for
    the whole toolpath.
  - **`gcode-preview-core/testing`:** `SuiteStubWorker` takes an optional IR factory, `makeNonFiniteTestIR()`
    is exported, and `ComponentHarness.mount` takes `{ renderer, ir }` and an `onReady` callback.
    `MountedComponent` gains `parse()`.
    The component conformance suite adds a 2D case and a 3D case.

- [#530](https://github.com/ChestnutLabs/gcode-preview/pull/530) [`73be6d5`](https://github.com/ChestnutLabs/gcode-preview/commit/73be6d5e116acc2eabf5bb8416400bad70abeda6) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - `renderStill` now accepts `qualityMode` (`'full' | 'adaptive' | 'fast'`), the same option the interactive viewer already has. Omitted, it stays `'adaptive'` and nothing changes. `'full'` skips the `tubeByteBudget` tubes-to-lines fallback; `'fast'` renders flat lines.

### Patch Changes

- [#539](https://github.com/ChestnutLabs/gcode-preview/pull/539) [`d0c3fcc`](https://github.com/ChestnutLabs/gcode-preview/commit/d0c3fcc59e7973bcb0d39ba2278f830daa02fedd) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Colour modes now reject options that have no meaning, and a hostile file can no longer distort or break colouring.
  - **Bad colour options throw a `RangeError` when you set them.** In `feedrate`, `layerHeight` and `power`
    mode, an explicit `range` must be two finite numbers `>= 0`, in ascending order. An inverted range such as
    `[2000, 1000]` now throws; for a reversed scale, reverse the `ramp` instead. In `object` mode, `only` must
    be a 1-based integer. Before, `range: [0, NaN]` or `only: 0` silently painted every segment one colour. A
    point range such as `[1500, 1500]` is still valid and paints every segment the ramp's first colour.
  - **Where it throws.** `controls.setColorMode(mode)` (in Vue, React, Svelte and the Web Component too) and
    the `colorMode` option throw synchronously, before anything is stored, so the previous mode stays in
    effect, even if the call comes before the viewer has loaded. The same goes for `LayerView2D`'s constructor
    and `setColorMode`, and for `createSegmentColorer`. To validate a mode built from user input yourself,
    call the new `checkColorMode(mode)`. It's exported from `@chestnutlabs/gcode-colors` and
    `@chestnutlabs/gcode-renderer-2d`.
  - **`segmentColor(ir, mode, i)` throws a `RangeError` for an index outside `[0, segments.count)`.** It used
    to return `undefined`. The per-segment function returned by `createSegmentColorer` is unchanged.
  - **A negative `F` or `S` in the file is drawn in `fallback`.** It is also left out of the auto-range, like
    NaN and Infinity already were, so one hostile `G1 F-99999` can no longer stretch the speed scale and wash
    out every other segment.
  - **`filament` colour mode ignores impossible filament slots.** A slot from file metadata that is not an
    integer from 0 to 63 is dropped. Before, a fractional slot threw while the palette was built. Gaps in the
    palette now use your `fallback`, not always the default grey.
  - **`filament` colour mode no longer borrows colours.** When a file uses a tool or a colour-change slot that
    it declared no filament colour for, those segments are drawn in `fallback`. Before, the palette wrapped,
    so `T3` in a file with two filament colours was drawn in the second filament's colour.

- [#514](https://github.com/ChestnutLabs/gcode-preview/pull/514) [`d51d927`](https://github.com/ChestnutLabs/gcode-preview/commit/d51d927d848b68ce87439a6f968530878a9ab4f7) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - `@chestnutlabs/gcode-preview-core/testing` adds `runComponentConformanceSuite` (with its `ComponentHarness` / `MountedComponent` types) and the `emitSuiteBuild` helper. They are a component-level conformance case that mounts each adapter's component and checks that the disclosure callback reports the current build's text, after build-complete ([#502](https://github.com/ChestnutLabs/gcode-preview/issues/502)). This is test support with the same status as `runBehavioralSuite`.

- [#531](https://github.com/ChestnutLabs/gcode-preview/pull/531) [`091b5d4`](https://github.com/ChestnutLabs/gcode-preview/commit/091b5d40e2e4a3670ccfc3615a299962914d72e5) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Replacing the source several times in one tick now applies only the last file, and a time scrub draws the right number of segments ([#529](https://github.com/ChestnutLabs/gcode-preview/issues/529), [#435](https://github.com/ChestnutLabs/gcode-preview/issues/435)).
  - **Rapid source changes.** Setting `source` (or calling `parse()`) three times in one tick used to run
    two parses at once: you got a spurious `parse-error` event, and which file ended up on screen
    depended on timing. Now only the newest call runs. The superseded calls resolve as
    `{ ok: false, cancelled: true }`. A parse that was already running reports `parse-cancelled`, and its
    result or error is dropped even if it had finished or failed first. A call that never started emits no event. This is the
    same in Vue, React, Svelte and the Web Component, which share this controller.
  - **`setScrubTime(ms)` no longer draws one segment too many.** A scrub at 0 ms drew the first segment,
    and a scrub at the end of segment 5 drew segments 0 to 5. It now draws exactly the segments finished
    by `ms`, and nothing before the first one ends. Segments with an unknown feedrate take 0 ms, so leading
    ones count as finished at 0 ms.

- [#509](https://github.com/ChestnutLabs/gcode-preview/pull/509) [`bef4857`](https://github.com/ChestnutLabs/gcode-preview/commit/bef48574b7c2fc7f20f36a5641d006fbd904c93e) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - The portable behavioral suite (`@chestnutlabs/gcode-preview-core/testing`) now checks that every
  `GcodePreviewState` field is reachable through an adapter, the way it already checks every
  `GcodePreviewControls` method. The new `REQUIRED_STATE_KEYS` and `REQUIRED_CONTROLS` exports list
  the fields and methods it checks. Both lists are derived from their types, so adding a field or a
  method without listing it fails the type check. A failure now names the missing keys. The library
  itself does not change. An adapter run through `runBehavioralSuite` now fails if its state is
  missing a field.
- Updated dependencies [[`3e133fd`](https://github.com/ChestnutLabs/gcode-preview/commit/3e133fd0e78f20d2cfdbbadd61b7fe4bb379abb1), [`d0c3fcc`](https://github.com/ChestnutLabs/gcode-preview/commit/d0c3fcc59e7973bcb0d39ba2278f830daa02fedd), [`3ae53e9`](https://github.com/ChestnutLabs/gcode-preview/commit/3ae53e9cf687e62f0a4c2bfeee0900fb5a56d76c), [`792c3e8`](https://github.com/ChestnutLabs/gcode-preview/commit/792c3e8e578f8e465ea48600871e442821e2b8de), [`d171ad4`](https://github.com/ChestnutLabs/gcode-preview/commit/d171ad4f909ed8a333b2eff67ac3c656b6f3de34), [`d171ad4`](https://github.com/ChestnutLabs/gcode-preview/commit/d171ad4f909ed8a333b2eff67ac3c656b6f3de34), [`251e57f`](https://github.com/ChestnutLabs/gcode-preview/commit/251e57f6d38c231064792606b5a4bf44e1762b0c), [`d171ad4`](https://github.com/ChestnutLabs/gcode-preview/commit/d171ad4f909ed8a333b2eff67ac3c656b6f3de34), [`b827e7f`](https://github.com/ChestnutLabs/gcode-preview/commit/b827e7fe87c2fcd5d636617090e4c58de09b57e0), [`3e1a11e`](https://github.com/ChestnutLabs/gcode-preview/commit/3e1a11ed171de55b4cf852aa3e5b94ddf69ac1ca), [`e6f159d`](https://github.com/ChestnutLabs/gcode-preview/commit/e6f159d605969ffe65c33ffe32767b2d61c43aac), [`4d08cbc`](https://github.com/ChestnutLabs/gcode-preview/commit/4d08cbc86aa1672ebea6f9d312b376699db5ecf1)]:
  - @chestnutlabs/gcode-parser@0.23.0
  - @chestnutlabs/gcode-renderer-2d@0.23.0
  - @chestnutlabs/gcode-renderer-three@0.23.0
  - @chestnutlabs/toolpath-core@0.23.0

## 0.22.0

### Minor Changes

- [#485](https://github.com/ChestnutLabs/gcode-preview/pull/485) [`7469a64`](https://github.com/ChestnutLabs/gcode-preview/commit/7469a643f1398d6ef9e4fbb39b89b4aa092a80d9) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - The toolpath viewer now draws the Studio look and has a camera lens control. With no theme set
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

- [#494](https://github.com/ChestnutLabs/gcode-preview/pull/494) [`f1544a3`](https://github.com/ChestnutLabs/gcode-preview/commit/f1544a35298ecd77ea48422c7475b6b75da0d6b4) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - `renderStill` now rejects instead of hanging when the toolpath build fails: the rejection is a `RenderStillError` (exported) with `code: 'E_GEOMETRY_BUILD'`, and the renderer is disposed. Callers that awaited without a `catch` now see a rejection (previously the promise never settled).

- Updated dependencies [[`f805747`](https://github.com/ChestnutLabs/gcode-preview/commit/f8057473fdd72b906562ffe4c19f838e864a3a82), [`3a76509`](https://github.com/ChestnutLabs/gcode-preview/commit/3a7650900ed1c07c065f614c087777e09cd07ca2), [`815f095`](https://github.com/ChestnutLabs/gcode-preview/commit/815f0954ba3687b9a96bb35cd0813de2d63ec281), [`7912c65`](https://github.com/ChestnutLabs/gcode-preview/commit/7912c65b63cab190e33b95fad68c69332432d662), [`84e664a`](https://github.com/ChestnutLabs/gcode-preview/commit/84e664a4794cc80e8ea5377f53448995522bef2c), [`7469a64`](https://github.com/ChestnutLabs/gcode-preview/commit/7469a643f1398d6ef9e4fbb39b89b4aa092a80d9), [`38fa875`](https://github.com/ChestnutLabs/gcode-preview/commit/38fa8751de9cb874a51038b4adfb69088270aa19), [`3fe25f4`](https://github.com/ChestnutLabs/gcode-preview/commit/3fe25f4d8d66ab1f37d23892365fb33d2c813ff6), [`33a6e9d`](https://github.com/ChestnutLabs/gcode-preview/commit/33a6e9d1075b97765cece7734a72bcf1c0aceb25), [`3b15da8`](https://github.com/ChestnutLabs/gcode-preview/commit/3b15da8ef9d0ea79766008f3f4b210d084979d62)]:
  - @chestnutlabs/gcode-parser@0.22.0
  - @chestnutlabs/gcode-renderer-three@0.22.0
  - @chestnutlabs/toolpath-core@0.22.0
  - @chestnutlabs/gcode-renderer-2d@0.22.0

## 0.21.2

### Patch Changes

- Updated dependencies [[`3075656`](https://github.com/ChestnutLabs/gcode-preview/commit/3075656ec105773869bea720c54a4d792bfd51c7)]:
  - @chestnutlabs/gcode-renderer-three@0.21.2
  - @chestnutlabs/gcode-parser@0.21.2
  - @chestnutlabs/gcode-renderer-2d@0.21.2
  - @chestnutlabs/toolpath-core@0.21.2

## 0.21.1

### Patch Changes

- Updated dependencies [[`a00f525`](https://github.com/ChestnutLabs/gcode-preview/commit/a00f52513f10b3afbc09ddb04dfe74f7c3885602)]:
  - @chestnutlabs/gcode-parser@0.21.1
  - @chestnutlabs/gcode-renderer-2d@0.21.1
  - @chestnutlabs/gcode-renderer-three@0.21.1
  - @chestnutlabs/toolpath-core@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies [[`ae84362`](https://github.com/ChestnutLabs/gcode-preview/commit/ae8436236d1fbf94520ab70777d6325e75d8fb21)]:
  - @chestnutlabs/gcode-renderer-three@0.21.0
  - @chestnutlabs/gcode-parser@0.21.0
  - @chestnutlabs/gcode-renderer-2d@0.21.0
  - @chestnutlabs/toolpath-core@0.21.0

## 0.20.1

### Patch Changes

- Updated dependencies [[`672fe42`](https://github.com/ChestnutLabs/gcode-preview/commit/672fe42c9391608adb3b816a6369d86b9f34307e), [`672fe42`](https://github.com/ChestnutLabs/gcode-preview/commit/672fe42c9391608adb3b816a6369d86b9f34307e), [`672fe42`](https://github.com/ChestnutLabs/gcode-preview/commit/672fe42c9391608adb3b816a6369d86b9f34307e)]:
  - @chestnutlabs/gcode-renderer-three@0.20.1
  - @chestnutlabs/gcode-parser@0.20.1
  - @chestnutlabs/gcode-renderer-2d@0.20.1
  - @chestnutlabs/toolpath-core@0.20.1

## 0.20.0

### Minor Changes

- [#427](https://github.com/ChestnutLabs/gcode-preview/pull/427) [`8810ba4`](https://github.com/ChestnutLabs/gcode-preview/commit/8810ba43f1641362e1705e713a8afe93659f740a) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Close the dark-capability gaps so no shipped capability is reachable only through the
  `raw.renderer()` escape hatch, with full parity across all four framework adapters (DD-031).

  **New on the public controller (`GcodePreviewControls`), so it flows to every adapter's `controls`:**
  - `getRenderStats()` — the DD-027 render-diagnostics snapshot (backend, GPU, geometry mode, build
    parallelism, timings), previously reachable only on the Three renderer. Returns `null` on the 2D
    renderer (which produces no GPU/geometry diagnostics — never a fabricated stats object).
  - `pickSegment(ndcX, ndcY, threshold?)` — source-mapping / segment picking, previously renderer-only.
  - `isColorModeAvailable(mode)` — the honest per-file color-mode capability gate.

  **New capability-aware state (`GcodePreviewState`):** `availableColorModes`, `hasRetractions`,
  `hasColorChanges` — refreshed after each parse, so a UI can offer and _explain_ controls instead of
  guessing (e.g. gray out feature coloring on a file with no feature roles, with a reason).

  **Adapter parity:**
  - `hiddenFeatureRoles` is now a declarative prop (Vue/React/Svelte) and a `hidden-feature-roles`
    attribute (Web Component) — the declarative form of `setFeatureRoleVisible` (hide Skirt/Brim to
    declutter a part). Gate it on `capabilities.featureRoles`.
  - `capture()` is now a top-level method on the Vue/React/Svelte handles too, matching the Web
    Component's `element.capture()`.
  - Web Component: `renderer`/`adjacentLayers` gain property accessors; the package now also re-exports
    `RendererMode` and `PreviewRenderer`.

  All additive — existing code keeps working unchanged; the 2D renderer honors the widened contract as
  documented no-ops / honest `null`. The portable behavioral suite is extended (layer-range, color-mode
  gating, diagnostics + picking reachability) and gains a controls-completeness parity guard so a
  capability can no longer ship in core and silently vanish from an adapter.

### Patch Changes

- Updated dependencies [[`718d1bd`](https://github.com/ChestnutLabs/gcode-preview/commit/718d1bde45856b58c37580d629da6d177f9f2004)]:
  - @chestnutlabs/gcode-renderer-three@0.20.0
  - @chestnutlabs/gcode-parser@0.20.0
  - @chestnutlabs/gcode-renderer-2d@0.20.0
  - @chestnutlabs/toolpath-core@0.20.0

## 0.19.0

### Minor Changes

- [#423](https://github.com/ChestnutLabs/gcode-preview/pull/423) [`81690dc`](https://github.com/ChestnutLabs/gcode-preview/commit/81690dcfece21d6fd11074ad7a264bcfc9edf455) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(renderer): `setFeatureRoleVisible(role, visible)` — show/hide a single feature role

  Toggle a `FeatureRole` on or off — e.g. hide `Skirt`/`Brim` to declutter a part preview, or isolate
  `Support`. Feature roles live per-segment inside the extrusion geometry (unlike the whole-chunk move-kind
  toggle), so hidden segments are collapsed to NaN positions and the GPU discards them; showing the role
  again restores the geometry byte-for-byte. Available on `ToolpathRenderer` and via
  `GcodePreviewControls.setFeatureRoleVisible` (a no-op on the 2D renderer). Additive and capability-gated:
  gate the UI on `capabilities.featureRoles === 'known'`, like the feature colour mode; untouched geometry
  (no role hidden) is byte-identical. Also exports `FeatureRoleValue` from `@chestnutlabs/toolpath-core`.

### Patch Changes

- Updated dependencies [[`81690dc`](https://github.com/ChestnutLabs/gcode-preview/commit/81690dcfece21d6fd11074ad7a264bcfc9edf455)]:
  - @chestnutlabs/gcode-renderer-three@0.19.0
  - @chestnutlabs/toolpath-core@0.19.0
  - @chestnutlabs/gcode-parser@0.19.0
  - @chestnutlabs/gcode-renderer-2d@0.19.0

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

### Patch Changes

- Updated dependencies [[`5144890`](https://github.com/ChestnutLabs/gcode-preview/commit/51448906f87ca09f3ed11f1286f7b79356110a83), [`bcb4b78`](https://github.com/ChestnutLabs/gcode-preview/commit/bcb4b786fcfc6a2e967d8bfff1d4fd3a06731681), [`dc89056`](https://github.com/ChestnutLabs/gcode-preview/commit/dc890568d45e59635b9994d8409ef6cdc0847f80), [`0ebeadf`](https://github.com/ChestnutLabs/gcode-preview/commit/0ebeadfa839e52baf243ef07b5807f3974bbac7e), [`c950339`](https://github.com/ChestnutLabs/gcode-preview/commit/c95033908e3ebaeb07b6f7e6f2487672dcc463f0)]:
  - @chestnutlabs/gcode-parser@0.18.0
  - @chestnutlabs/gcode-renderer-three@0.18.0
  - @chestnutlabs/gcode-renderer-2d@0.18.0
  - @chestnutlabs/toolpath-core@0.18.0

## 0.17.0

### Minor Changes

- [#408](https://github.com/ChestnutLabs/gcode-preview/pull/408) [`63e191c`](https://github.com/ChestnutLabs/gcode-preview/commit/63e191cd5e3a36f697ba660c17cf5c7d28406af0) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(render-still): expose `tubeByteBudget` on `RenderStillOptions`

  `renderStill` now accepts `tubeByteBudget?: number`, forwarded to the renderer's existing option. This is
  the **final-geometry** byte budget (RR-006) — a **different axis** from `geometryMemoryBudgetBytes` (the
  parallel build's in-flight transient cap): it bounds the whole retained tube mesh and so decides whether a
  large plate renders as full **tubes** or degrades to **lines**.

  Previously the headless still was stuck behind the conservative default (~450 MB CPU / ~900 MB peak), so a
  big full-sheet plate silently fell to lines even when the deployment had RAM to spare, with no way to opt
  in. A caller whose resource policy says the RAM is available can now raise the budget to retain tubes on
  large plates (peak RAM ≈ 2× the budget). The library never reads the container — choosing a value from the
  actual CPU/RAM grant is deployment policy, not baked into gcode-preview.

  Additive and behavior-preserving at the default. `geometryMemoryBudgetBytes` (CPU parallelism transient)
  and `tubeByteBudget` (final-geometry retention) are independent knobs, matching the two-axis
  capability-aware model the DD-028 headless characterization established.

### Patch Changes

- Updated dependencies [[`d1de1b4`](https://github.com/ChestnutLabs/gcode-preview/commit/d1de1b407389321442289a5be5d3104c60b68060), [`214b0db`](https://github.com/ChestnutLabs/gcode-preview/commit/214b0db2dd9d8aa177d80969bdb59173d33121a3), [`b362f9a`](https://github.com/ChestnutLabs/gcode-preview/commit/b362f9a81232a21ff35a4a23d84c6300db83f28f)]:
  - @chestnutlabs/gcode-renderer-three@0.17.0
  - @chestnutlabs/toolpath-core@0.17.0
  - @chestnutlabs/gcode-parser@0.17.0
  - @chestnutlabs/gcode-renderer-2d@0.17.0

## 0.16.0

### Minor Changes

- [#398](https://github.com/ChestnutLabs/gcode-preview/pull/398) [`fdc9111`](https://github.com/ChestnutLabs/gcode-preview/commit/fdc9111c0917af55e41fff9d20464ebbc3444589) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(renderer): wire the geometry worker pool into the build path (DD-028 [#1](https://github.com/ChestnutLabs/gcode-preview/issues/1)+[#2](https://github.com/ChestnutLabs/gcode-preview/issues/2))

  The renderer now builds tube geometry across the worker pool when engaged: `geometryConcurrency:
'auto'` (default) sizes a **capability- and memory-aware** pool and uses it for tube builds above a
  cost threshold; `'off'` forces the synchronous path; a number pins the worker count. Extrude chunks
  build on workers and stream back to the main thread (each wrapped + uploaded as it arrives, so peak
  transient geometry is memory-bounded); travel/wipe/lines stay inline. Output is **byte-identical** to
  the serial build — same kernel, same `positions` — with deterministic assembly.
  - **Capability sizing:** `clamp(coreBudget − 1, 1, MAX)` (browser `hardwareConcurrency`; Node/sidecar
    the cgroup quota), further capped by memory so `workers × maxChunkBytes ≤ geometryMemoryBudgetBytes`
    (proactive — a cgroup OOM is uncatchable). Never oversubscribes cores or memory.
  - **Safe fallbacks:** a worker failure degrades to continuous lines (never chopped); a newer `setIR`
    or dispose invalidates a stale in-flight build via a generation guard.
  - **Wiring:** `gcode-preview-core` defaults `createGeometryWorker` to the batteries-included browser
    Web Worker (`createBrowserGeometryWorker`) in a browser; Node/headless stays synchronous. New
    `geometryConcurrency` / `geometryMemoryBudgetBytes` options on both the renderer and the controller.
  - **Diagnostics:** RenderStats gains `buildParallelism: 'main' | 'pool'` and `workerCount`.

  FDM geometry byte-identical. The cost/capability activation estimate and the Node/sidecar worker_threads
  adapter follow in the next phase.

- [#400](https://github.com/ChestnutLabs/gcode-preview/pull/400) [`12deb4d`](https://github.com/ChestnutLabs/gcode-preview/commit/12deb4d79891cfab39b1a9c8d1f3f93665564a9e) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(core): parallel tube build for renderStill via the browser Web Worker pool (DD-028 Phase 4)

  `renderStill` now parallelizes big-plate tube geometry across the browser Web Worker pool — the same
  byte-identical kernel the interactive path uses. `renderStill` runs in a browser-class WebGL2 context
  (headless Chromium / Electron / OffscreenCanvas worker — never raw Node; "pure-Node GPU rendering is out
  of scope"), so this is Web Workers, **not** `worker_threads`, and it stays DD-007-clean (no `node:`
  imports, no filesystem).
  - New `renderStill` options: `geometryConcurrency: 'auto' | 'off' | number` (default `'auto'`),
    `coreBudget`, `geometryMemoryBudgetBytes`, `createGeometryWorker` (override). The batteries-included
    browser Web Worker is the default factory when `Worker` is available.
  - **Container-throttle-aware:** `navigator.hardwareConcurrency` over-reports a CFS-throttled container
    (e.g. 4 visible cores / 2.0-CPU quota), so a containerized caller (the sidecar) reads its cgroup
    `cpu.max` in its own Node host and passes the quota as `coreBudget`; the pool sizes to
    `min(hardwareConcurrency, coreBudget) − 1`, further bounded by `geometryMemoryBudgetBytes`. At a 2-CPU
    grant this honestly resolves to ~serial; a larger grant is used automatically.

  FDM geometry byte-identical.

- [#395](https://github.com/ChestnutLabs/gcode-preview/pull/395) [`70b1f5b`](https://github.com/ChestnutLabs/gcode-preview/commit/70b1f5bae3458f21c44950d17fc8c6e413ea8570) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(core): staged preparation progress — `parsing`/`classifying` stages (DD-029 Phase A)

  The controller now maps the parser's own phase to the DD-029 `stage` vocabulary: the `parsing` phase
  emits `stage:'parsing'` with the real byte fraction, and the `finalizing` phase (where dialect
  annotation settles) emits `stage:'classifying'`. The renderer's later `building-geometry`/`preparing-gpu`/
  `ready` stages already forward through the controller, so a consumer sees the full ordered vocabulary
  `parsing → classifying → building-geometry → preparing-gpu → ready`.

  Additive: `parse-progress`/`parse-complete`/`buildComplete` are untouched. No geometry or render-policy
  change.

- [#375](https://github.com/ChestnutLabs/gcode-preview/pull/375) [`de453cb`](https://github.com/ChestnutLabs/gcode-preview/commit/de453cb3a84275dc27c89c20381c7f91289a6a83) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - `renderStill` builds to completion and renders once — large headless stills no longer pay for dozens of discarded renders

  A `renderStill` builds its geometry across many microtask ticks, and the incremental build rendered
  the whole (growing) scene **on every tick** — for a big tube mesh in software WebGL that's
  dozens-to-hundreds of full MSAA rasterizations, all discarded except the last. A still only needs the
  final frame.

  The `ToolpathRenderer` gains a **`renderDuringBuild`** option (default `true`, preserving the
  interactive viewer's progressive-build feedback). `renderStill` now sets it `false`: it builds the
  geometry to completion and renders **once**, cutting the per-tick render waste that dominates a large
  still's time in software rendering. Output is pixel-identical; `buildComplete` and all build events
  still fire.

  Note: this is one lever; a large still still builds the full tube mesh. Defaulting thumbnails to
  `lines`, capping segments, and reusing the GL context across stills remain follow-ups.

### Patch Changes

- Updated dependencies [[`6587d99`](https://github.com/ChestnutLabs/gcode-preview/commit/6587d9994dde77dd5488136e9b46257661c16c2e), [`1c54132`](https://github.com/ChestnutLabs/gcode-preview/commit/1c54132a39713c3c6d582e0b6820b411eff40d20), [`fdc9111`](https://github.com/ChestnutLabs/gcode-preview/commit/fdc9111c0917af55e41fff9d20464ebbc3444589), [`ecfa56b`](https://github.com/ChestnutLabs/gcode-preview/commit/ecfa56b098d721cd5d636f594d07eda9ac2be067), [`808dc56`](https://github.com/ChestnutLabs/gcode-preview/commit/808dc56bf377a435bc457d16fc51e195734e2bb5), [`affc879`](https://github.com/ChestnutLabs/gcode-preview/commit/affc8796583be309ce469969f2777a833253549a), [`f3ce24f`](https://github.com/ChestnutLabs/gcode-preview/commit/f3ce24ff5439ef44ca4bac8a12eda91d187f410f), [`de453cb`](https://github.com/ChestnutLabs/gcode-preview/commit/de453cb3a84275dc27c89c20381c7f91289a6a83), [`9cd66b2`](https://github.com/ChestnutLabs/gcode-preview/commit/9cd66b2f23aa32c8832d9e9da13c025cf86278b1), [`41d2dcf`](https://github.com/ChestnutLabs/gcode-preview/commit/41d2dcf49d28268c13d4d1dbaf4604a9efaacfaf), [`bf032d2`](https://github.com/ChestnutLabs/gcode-preview/commit/bf032d2b4e0ce36dcbd8020caead2a512ca3b618)]:
  - @chestnutlabs/gcode-renderer-three@0.16.0
  - @chestnutlabs/gcode-parser@0.16.0
  - @chestnutlabs/toolpath-core@0.16.0
  - @chestnutlabs/gcode-renderer-2d@0.16.0

## 0.15.0

### Minor Changes

- [#373](https://github.com/ChestnutLabs/gcode-preview/pull/373) [`8229075`](https://github.com/ChestnutLabs/gcode-preview/commit/8229075e2737c360c5d255e438ce140f4fbb13da) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - `progressivePreview` — a during-parse preview curtain over the [#60](https://github.com/ChestnutLabs/gcode-preview/issues/60) streaming preview

  New public option/prop/attribute (renderer + core controller + all four adapters), plus a
  `setProgressivePreview` control. It governs only what shows WHILE parsing — orthogonal to
  `quality`/`qualityMode`, which govern the FINAL representation:
  - **`'lines'`** (default, backward-compatible): stream the progressive line preview as it parses,
    then replace it with the final build. Existing behaviour — unchanged for current consumers.
  - **`'hold'`**: keep parsing/building and keep emitting progress (`previewAppend`; `parse-progress`
    flows in every mode), but reveal NO incomplete/neutral line preview — the first thing shown is the
    final, correctly-coloured, policy-quality build. A single clean reveal with a live progress signal,
    removing the "renders neutral, then re-renders coloured" double-take on streamed files.
  - **`'off'`**: suppress the progressive preview entirely (no geometry, no `previewAppend`) — the
    consumer supplies its own loading/progress treatment until the final build is revealed.

  The revealed representation is always the policy-correct one (full tubes at `full`, disclosed lines
  at `adaptive` per budget) — never a silent large-file lines fallback (DD-023 alignment). 3D only;
  the 2D renderer is a no-op (it has its own low-resource progressive cut).

### Patch Changes

- Updated dependencies [[`8229075`](https://github.com/ChestnutLabs/gcode-preview/commit/8229075e2737c360c5d255e438ce140f4fbb13da)]:
  - @chestnutlabs/gcode-renderer-three@0.15.0
  - @chestnutlabs/gcode-parser@0.15.0
  - @chestnutlabs/gcode-renderer-2d@0.15.0
  - @chestnutlabs/toolpath-core@0.15.0

## 0.14.0

### Minor Changes

- [#367](https://github.com/ChestnutLabs/gcode-preview/pull/367) [`60e24e1`](https://github.com/ChestnutLabs/gcode-preview/commit/60e24e15b6b72e9aa097f4d2fd22b0c91a480cea) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(renderer): `qualityMode` fidelity policy — Full / Adaptive / Fast (DD-023 §4 D6, Phase B)

  Adds a `qualityMode` option/prop (and `setQualityMode`) across the toolpath renderer, the core controller,
  and all four adapters — the fidelity **policy**, distinct from the geometry `quality` tier (`lines`/`tubes`):
  - **`'full'`** — render the COMPLETE representation: no every-Nth decimation, full-radial continuous tubes,
    and **no budget-driven tubes→lines fallback** (only the per-chunk vertex safety net remains). So a normal
    large plate renders at full quality on capable hardware instead of being gated down by the static ceilings.
  - **`'adaptive'`** (default) — the capability-aware auto path (`auto` decimation + `tubeByteBudget`
    cross-section coarsening, disclosed). Reproduces today's behaviour exactly.
  - **`'fast'`** — explicitly trade fidelity for responsiveness (flat lines).

  This is the consumer control from the DD-023 Phase B contract: a user/admin picks the policy; `'full'` never
  silently degrades. Capability-aware **auto** budget selection (classifier-driven Adaptive) and the
  too-heavy-for-this-client signal land in a later increment. Additive — the default `'adaptive'` preserves
  current behaviour.

### Patch Changes

- Updated dependencies [[`60e24e1`](https://github.com/ChestnutLabs/gcode-preview/commit/60e24e15b6b72e9aa097f4d2fd22b0c91a480cea), [`c99b221`](https://github.com/ChestnutLabs/gcode-preview/commit/c99b2219566b6427c3d11d37be04876415db3bea)]:
  - @chestnutlabs/gcode-renderer-three@0.14.0
  - @chestnutlabs/gcode-parser@0.14.0
  - @chestnutlabs/gcode-renderer-2d@0.14.0
  - @chestnutlabs/toolpath-core@0.14.0

## 0.13.0

### Minor Changes

- [#364](https://github.com/ChestnutLabs/gcode-preview/pull/364) [`f14849d`](https://github.com/ChestnutLabs/gcode-preview/commit/f14849d5f88eb9957a75bccf2f14da75ebb44a4e) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(color): `filament` colour mode — render a toolpath in the file's own filament colours (DD-024)

  Adds a `{ mode: 'filament' }` colour mode: colour a toolpath by the source's OWN filament colours
  (`metadata.filaments[].color`, from the g-code header / slicer metadata), so a consumer needn't extract and
  re-supply a palette gcode-preview already knows. Because those colours live in parse **metadata** (not the
  IR), the `gcode-preview-core` controller resolves the mode against each file's metadata **before the build** —
  multi-extruder files colour by tool, colour-change (M600) files by swap slot — so the **first visible pass is
  already coloured**, eliminating the neutral-then-recolour flash on raw `.gcode`. Honesty preserved: with no
  usable filament colours the render stays neutral (never a fabricated palette); the mode reaching the IR-only
  colorer unresolved is likewise honestly neutral. Fixes the raw-g-code (e.g. Dune Striker) colour flash
  renderer-side, no consumer palette extraction required.

### Patch Changes

- Updated dependencies [[`377fc70`](https://github.com/ChestnutLabs/gcode-preview/commit/377fc7076e42a6044a9e10f2d4b27bd99fa133f3), [`b8dd6a7`](https://github.com/ChestnutLabs/gcode-preview/commit/b8dd6a7ce05add28f922a7f71641eebe0778a146), [`3be5312`](https://github.com/ChestnutLabs/gcode-preview/commit/3be531219cede19168ddf042ee7954c14d73d74c)]:
  - @chestnutlabs/gcode-renderer-three@0.13.0
  - @chestnutlabs/gcode-renderer-2d@0.13.0
  - @chestnutlabs/gcode-parser@0.13.0
  - @chestnutlabs/toolpath-core@0.13.0

## 0.12.0

### Patch Changes

- [#352](https://github.com/ChestnutLabs/gcode-preview/pull/352) [`8bd6bbd`](https://github.com/ChestnutLabs/gcode-preview/commit/8bd6bbd1dfe7539ee4e3357f84de74c2eb703462) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - fix(renderer): bound tube memory by coarsening the cross-section, not by dropping segments (RR-006 correction)

  The v0.10.0 tube-memory budget bounded memory by **decimating segments** (drawing every Nth). For _tubes_
  that is destructive: a mesh/tube surface loses continuity when segments are dropped — each survivor becomes
  a disconnected, capped stub, so a smooth wall renders as a spiky hairball (and a shape as broken blocks) on
  large forced-`tubes` files. Screenshots from production confirmed it.

  The correct lever, mirroring the DD-022 mesh finding, is to reduce the tube's **cross-section resolution**
  (fewer sides per tube) while **keeping every segment** — the path stays continuous, the tube is just a bit
  lower-poly — and fall back to flat lines only when even the minimum cross-section (3 sides) blows the
  budget. New `ToolpathRendererOptions.tubeByteBudget` (default ~450 MB CPU, safe in a 2 GB cgroup) drives it;
  `tubeSegmentBudget` (v0.10.0) is **deprecated** and ignored (it caused the spikes). New exports:
  `tubeRadialForBudget`, `tubeSegmentBytes`, `TUBE_CPU_BYTE_BUDGET`, `MIN_RADIAL_SEGMENTS`.

  Also fixes the ordinal in the decimation disclosure string ("every 3rd", not "every 3th").

- Updated dependencies [[`8bd6bbd`](https://github.com/ChestnutLabs/gcode-preview/commit/8bd6bbd1dfe7539ee4e3357f84de74c2eb703462)]:
  - @chestnutlabs/gcode-renderer-three@0.12.0
  - @chestnutlabs/gcode-parser@0.12.0
  - @chestnutlabs/gcode-renderer-2d@0.12.0
  - @chestnutlabs/toolpath-core@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-parser@0.11.0
  - @chestnutlabs/gcode-renderer-2d@0.11.0
  - @chestnutlabs/gcode-renderer-three@0.11.0
  - @chestnutlabs/toolpath-core@0.11.0

## 0.10.0

### Minor Changes

- [#339](https://github.com/ChestnutLabs/gcode-preview/pull/339) [`33c4652`](https://github.com/ChestnutLabs/gcode-preview/commit/33c46528967b88d5b67ab81e61a3ab7f7e1cdc79) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(core): expose `decimationApplied` on `RenderStillResult` (honest disclosure for large tube cards)

  `renderStill` now returns `decimationApplied` (1 = none, > 1 = every-Nth extrusion kept, layer boundaries
  always preserved). The headless still path is where a farm renders thumbnail/cards, and the tube-segment
  budget (RR-006, `gcode-renderer-three`) can now decimate a large card to bound memory — but the still
  result carried no signal of it, so a card could be silently simplified. This closes that gap: a consumer
  can disclose "simplified for size" on a decimated card, matching the interactive controller's existing
  `state.disclosure`. Additive; small/normal renders report `decimationApplied: 1`.

### Patch Changes

- Updated dependencies [[`a6ae736`](https://github.com/ChestnutLabs/gcode-preview/commit/a6ae736dab468960939b477964790c6ce9130572)]:
  - @chestnutlabs/gcode-renderer-three@0.10.0
  - @chestnutlabs/gcode-parser@0.10.0
  - @chestnutlabs/gcode-renderer-2d@0.10.0
  - @chestnutlabs/toolpath-core@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [[`cc6e1f6`](https://github.com/ChestnutLabs/gcode-preview/commit/cc6e1f6b48e531bc991cb1c7c53846ccbf7ca522), [`dd535d6`](https://github.com/ChestnutLabs/gcode-preview/commit/dd535d64ac71bbd876e83e81dccc6dbb046bf689), [`3299760`](https://github.com/ChestnutLabs/gcode-preview/commit/32997607dbd30db79c91d14d2d8383d99be933af)]:
  - @chestnutlabs/gcode-renderer-three@0.9.0
  - @chestnutlabs/gcode-parser@0.9.0
  - @chestnutlabs/gcode-renderer-2d@0.9.0
  - @chestnutlabs/toolpath-core@0.9.0

## 0.8.1

### Patch Changes

- Updated dependencies [[`92ae9a2`](https://github.com/ChestnutLabs/gcode-preview/commit/92ae9a2532e7ecc1a7b9938eda442d105e4f31b4)]:
  - @chestnutlabs/gcode-parser@0.8.1
  - @chestnutlabs/gcode-renderer-2d@0.8.1
  - @chestnutlabs/gcode-renderer-three@0.8.1
  - @chestnutlabs/toolpath-core@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-parser@0.8.0
  - @chestnutlabs/gcode-renderer-2d@0.8.0
  - @chestnutlabs/gcode-renderer-three@0.8.0
  - @chestnutlabs/toolpath-core@0.8.0

## 0.7.0

### Minor Changes

- [#310](https://github.com/ChestnutLabs/gcode-preview/pull/310) [`bbdef97`](https://github.com/ChestnutLabs/gcode-preview/commit/bbdef97d8a1eb77a3864291918f7f5aace559ff2) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Decouple the build-volume **wireframe cage** from the bed/plate ([#306](https://github.com/ChestnutLabs/gcode-preview/issues/306) item 6). The cage (the box up to
  the volume height) is now independently toggleable: a new `controls.setBuildVolumeCage(visible)` and a
  `showVolumeCage` prop across all four adapters (`show-volume-cage` attribute on the element), plus a
  `BuildVolumeStyle.showCage` option. Default `true` (unchanged look); set `false` to show only the
  printable bed/plate without the whole machine-volume cage. The 2D renderer treats it as a documented
  no-op. Toggling flips the named `volumeCage` object in place (no geometry rebuild).

- [#313](https://github.com/ChestnutLabs/gcode-preview/pull/313) [`39ede6e`](https://github.com/ChestnutLabs/gcode-preview/commit/39ede6ebc0a1ba594a391f1b33db2bdf3445d414) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Frame-to-content: frame the printed **object**, not the skirt/prime ([#306](https://github.com/ChestnutLabs/gcode-preview/issues/306) item 6). New
  `ToolpathIR.objectBounds` (extrusion of labeled objects only, `segments.object != 0`; empty when the
  file has no object labels) and a `frameContent: 'object' | 'all'` option threaded through the renderer
  (`setFrameContent`), `renderStill`, and all four adapters (`show-`-style `frame-content` attribute on the
  element). Default `'all'` (unchanged framing). `'object'` frames only the printed objects so a prime
  line or skirt at the bed edge no longer shrinks the object in view; when the file carries no object
  labels it discloses (an `E_FRAME_CONTENT_UNAVAILABLE` event) and frames all extrusion — never fabricated.

  Note: `frameContent: 'object'` engages only when the parser populated the `objects` capability (M486 /
  EXCLUDE_OBJECT / `; printing object`). Broadening object-label detection for more slicer/firmware
  variants is tracked separately.

- [#314](https://github.com/ChestnutLabs/gcode-preview/pull/314) [`caaa0fa`](https://github.com/ChestnutLabs/gcode-preview/commit/caaa0fad0938bfa3ac1cd9f312f9cd2355c722d1) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Interaction-aware render quality ([#306](https://github.com/ChestnutLabs/gcode-preview/issues/306) item 2, DD-020). New opt-in `interactionQuality: 'off' | 'auto'`
  renderer option + `controls.setInteractionQuality` + an `interactionQuality` prop / `interaction-quality`
  attribute on all four adapters. With `'auto'`, the renderer **reduces render detail (pixel ratio) while
  the camera is moving and restores full detail when it settles** (short debounce), so orbiting a heavy tube
  scene stays responsive without permanently dropping to lines. The reduction is proactive (a gesture starts
  at 0.6× the resting pixel ratio) and adapts to measured frame time within a clamped `[0.4, 1]` band. The
  hard vertex-budget `quality-fallback` (tubes → lines when a chunk can't allocate) is unchanged as the final
  safety net. **Default `'off'` — existing behavior is byte-identical.** The 2D renderer treats it as a
  documented no-op.

  A consumer maps a High / Balanced / Performance preference on top: High = `quality:'tubes'` +
  `interactionQuality:'auto'`; Balanced = `quality:'auto'` + `interactionQuality:'auto'`; Performance =
  `quality:'lines'`.

- [#312](https://github.com/ChestnutLabs/gcode-preview/pull/312) [`6293342`](https://github.com/ChestnutLabs/gcode-preview/commit/62933424cb59684878bf142ad7fc7edb44507a19) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add a `background` convenience option to `renderStill` ([#306](https://github.com/ChestnutLabs/gcode-preview/issues/306)): `'transparent'` composites the still on a
  consumer card (creates an alpha GL context so the unset scene background shows through), or a solid
  `ThemeColor` paints a themed backdrop. Shorthand for wiring `theme.background` + an alpha `createRenderer`
  yourself — so a presentation card thumbnail is `renderStill(ir, { quality: 'tubes', showTravel: false,
showWipe: false, background: 'transparent' })` (no build volume, extrude-only framing). An explicit
  `theme.background` or `createRenderer` you pass still wins.

- [#307](https://github.com/ChestnutLabs/gcode-preview/pull/307) [`69806d8`](https://github.com/ChestnutLabs/gcode-preview/commit/69806d8e44498925c9140acb124a5f76395a1e8f) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Surface slicer **`metadata`** on the `ready` / `parse-complete` event ([#306](https://github.com/ChestnutLabs/gcode-preview/issues/306) item 4). The
  `DialectMetadata` a slicer file carries — per-tool `filaments` (`{slot, type, color, name}`),
  `filamentUsage` (`{lengthMm, volumeCm3, weightG}`), `printEstimate` (`{seconds, mode}`), `thumbnails`,
  `dialects`, and whitelisted `raw` settings — is now on the event across all four adapters, so a consumer
  can build a "Slice details" panel without reaching into the raw handle. Capability-honest: `metadata` is
  `undefined` when the file carried none, and individual fields are absent (never fabricated) when a slicer
  didn't emit them. (Purge/waste, prime/tower, and cost are not parsed and are intentionally not present.)

### Patch Changes

- Updated dependencies [[`bbdef97`](https://github.com/ChestnutLabs/gcode-preview/commit/bbdef97d8a1eb77a3864291918f7f5aace559ff2), [`39ede6e`](https://github.com/ChestnutLabs/gcode-preview/commit/39ede6ebc0a1ba594a391f1b33db2bdf3445d414), [`caaa0fa`](https://github.com/ChestnutLabs/gcode-preview/commit/caaa0fad0938bfa3ac1cd9f312f9cd2355c722d1), [`1c15c5e`](https://github.com/ChestnutLabs/gcode-preview/commit/1c15c5ea38f69aba99478cec60e4a0af28b9cae4)]:
  - @chestnutlabs/gcode-renderer-three@0.7.0
  - @chestnutlabs/toolpath-core@0.7.0
  - @chestnutlabs/gcode-parser@0.7.0
  - @chestnutlabs/gcode-renderer-2d@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [[`277e148`](https://github.com/ChestnutLabs/gcode-preview/commit/277e1481ba015d6d0fa8d5b4e5ff6c7e014d494b), [`ac1e1f9`](https://github.com/ChestnutLabs/gcode-preview/commit/ac1e1f984305071db1a16fd8bbd7f1166b877d9d)]:
  - @chestnutlabs/gcode-renderer-three@0.6.0
  - @chestnutlabs/gcode-parser@0.6.0
  - @chestnutlabs/gcode-renderer-2d@0.6.0
  - @chestnutlabs/toolpath-core@0.6.0

## 0.5.2

### Patch Changes

- [#292](https://github.com/ChestnutLabs/gcode-preview/pull/292) [`d7f3e88`](https://github.com/ChestnutLabs/gcode-preview/commit/d7f3e88afd80fd07167625cd8128f569830be3f8) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Fix: `renderStill` now honors `showTravel: false` (and its documented default of false), and adds a
  matching `showWipe` option (also default false).

  `renderStill` only ever turned travel visibility **on** (`if (options.showTravel === true) …`), and the
  renderer defaults travel (and wipe) visible — so `showTravel: false`, and omitting the option (documented
  default false), were both no-ops and travel always rendered into the still. Travel and wipe visibility are
  now applied unconditionally from their options, so a headless thumbnail is a clean model-only image by
  default. (Retraction markers were already off by default — the renderer never enables them in a still.)

  Note: this does not change camera framing. `renderStill` frames to the IR's **extrude-only** bounds
  (`ir.bounds`), never the travel-inclusive bounds — so a still that still shows lines reaching the plate
  corners after this fix indicates those moves are classified as extrusion, not travel (an E-mode/motion
  classification question, unrelated to `showTravel`).

- Updated dependencies []:
  - @chestnutlabs/gcode-parser@0.5.2
  - @chestnutlabs/gcode-renderer-2d@0.5.2
  - @chestnutlabs/gcode-renderer-three@0.5.2
  - @chestnutlabs/toolpath-core@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-parser@0.5.1
  - @chestnutlabs/gcode-renderer-2d@0.5.1
  - @chestnutlabs/gcode-renderer-three@0.5.1
  - @chestnutlabs/toolpath-core@0.5.1

## 0.5.0

### Minor Changes

- [#283](https://github.com/ChestnutLabs/gcode-preview/pull/283) [`804cafb`](https://github.com/ChestnutLabs/gcode-preview/commit/804cafb33f8f8be2617585156babf1221a856941) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Adapter surface: capabilities/warnings on `ready` + declarative `view`/`cameraState` ([#275](https://github.com/ChestnutLabs/gcode-preview/issues/275) M3+M6)

  **M3** — the `parse-complete` / `ready` event now carries `capabilities` (the per-field confidence
  map) and `warnings` alongside `{ segments, layers, complete }`, so consumers can gate their own UI on
  capability-honesty without reaching for the raw handle.

  **M6** — the `setView`/`getCameraState`/`setCameraState` methods ([#268](https://github.com/ChestnutLabs/gcode-preview/issues/268)) get first-class declarative
  props on all four adapters: a `view` prop (preset orientation) and a `cameraState` prop (restore),
  paired with a new **`camera-changed`** event (renderer → controller → adapters, emitted when a user
  camera interaction settles) so a `cameraState` binding round-trips. The 2D renderer keeps disclosing
  via `renderer-unsupported` rather than fabricating a pose. Behavioral-suite coverage added for the
  capabilities/warnings payload across all four adapters.

- [#270](https://github.com/ChestnutLabs/gcode-preview/pull/270) [`bb2af7a`](https://github.com/ChestnutLabs/gcode-preview/commit/bb2af7a4b9c433ef8caf59ecb5ece51f39a8eb9e) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Preset camera views + serializable camera state ([#268](https://github.com/ChestnutLabs/gcode-preview/issues/268))

  Adds three imperative camera methods, threaded from the renderer through `PreviewRenderer` and the
  `controls` handle into all four adapters:
  - `setView(view)` — snap to a preset orientation (`top`/`bottom`/`front`/`back`/`left`/`right`/`iso`),
    instant, preserving the active projection.
  - `getCameraState()` — read the current camera as a serializable `CameraState`
    (`{ position, target, zoom, cameraMode }`, scene coordinates); a stable contract a dashboard can
    persist.
  - `setCameraState(state)` — restore a snapshot verbatim (no re-fit to the current model).

  New public types `CameraView` and `CameraState`. No new dependency, no IR/schema change, no animation
  (snapping is instant). The low-resource 2D renderer has no 3D pose, so it honors these as documented
  disclosures (`getCameraState()` → `null`; `setView`/`setCameraState` → `renderer-unsupported`) rather
  than fabricating a pose. Covered across all four adapters by the portable behavioral suite.

### Patch Changes

- Updated dependencies [[`804cafb`](https://github.com/ChestnutLabs/gcode-preview/commit/804cafb33f8f8be2617585156babf1221a856941), [`b671d02`](https://github.com/ChestnutLabs/gcode-preview/commit/b671d02179ba6cf30ce9888fa4b851328852e0f1), [`54b54fe`](https://github.com/ChestnutLabs/gcode-preview/commit/54b54fe240e5ef7edae0e03e351127de531c5069), [`bb2af7a`](https://github.com/ChestnutLabs/gcode-preview/commit/bb2af7a4b9c433ef8caf59ecb5ece51f39a8eb9e)]:
  - @chestnutlabs/gcode-renderer-three@0.5.0
  - @chestnutlabs/gcode-parser@0.5.0
  - @chestnutlabs/gcode-renderer-2d@0.5.0
  - @chestnutlabs/toolpath-core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`b2053be`](https://github.com/ChestnutLabs/gcode-preview/commit/b2053be4b8e71250bc6077f60ef996fe601b6f3e), [`5f59b77`](https://github.com/ChestnutLabs/gcode-preview/commit/5f59b7788bbb14cacfe21aaf3d7134c6ba8dcd86), [`13fd5c6`](https://github.com/ChestnutLabs/gcode-preview/commit/13fd5c61d730428a7f7e73c28cf3cc9c48e68c19), [`1029580`](https://github.com/ChestnutLabs/gcode-preview/commit/10295803839816adaed224c48eba1f74374c0c2a), [`11f317d`](https://github.com/ChestnutLabs/gcode-preview/commit/11f317de2d6cb963d2a7fb0c894c89d3d5adc86d), [`8fec7c3`](https://github.com/ChestnutLabs/gcode-preview/commit/8fec7c3622cd2a6d6d57b43d7866cfea1cb71e09), [`879b60a`](https://github.com/ChestnutLabs/gcode-preview/commit/879b60ae0fca87ca8187791603a1bc7f54e61c4c), [`b84bea9`](https://github.com/ChestnutLabs/gcode-preview/commit/b84bea959b7aae24d148e6bcc488a9ed254a54f0)]:
  - @chestnutlabs/gcode-parser@0.4.0
  - @chestnutlabs/gcode-renderer-three@0.4.0
  - @chestnutlabs/toolpath-core@0.4.0
  - @chestnutlabs/gcode-renderer-2d@0.4.0

## 0.3.0

### Minor Changes

- [#219](https://github.com/ChestnutLabs/gcode-preview/pull/219) [`bb23c90`](https://github.com/ChestnutLabs/gcode-preview/commit/bb23c901cc405ea22aad9003ccb20c7cab525490) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - E8 phase 3 ([#214](https://github.com/ChestnutLabs/gcode-preview/issues/214), DD-014 D5): select the renderer with a **`renderer: '2d' | '3d'`** prop, plus a
  live-progress marker in the 2D view. Additive; the default (`'3d'`) output is unchanged.
  - **`gcode-preview-core`**: a renderer-agnostic `PreviewRenderer` seam. `renderer.mode` (default
    `'3d'`) picks the implementation; the **3D renderer is now loaded on demand** (dynamic `import()`),
    so a `'2d'` consumer's bundle **never pulls Three.js**. New `LayerView2DRenderer` adapts the Canvas
    2D renderer to the seam. Genuine 3D-only requests on the 2D view (camera projection, quality modes)
    are disclosed via a new `renderer-unsupported` event rather than faked. The controller's renderer
    now resolves asynchronously; controls issued before it is ready are queued and replayed in order.
  - **`gcode-renderer-2d`**: a live-progress "completed cut" (DD-006) — `LayerView2D.setProgress` /
    `drawLayers({ progress })` dims the not-yet-printed extrusion of the layer currently printing.
  - **Adapters** (Vue/React/Svelte/Element): a top-level `renderer` prop (+ `adjacentLayers`) maps to
    `renderer.mode`; `raw.renderer()` now returns the neutral `PreviewRenderer`. `<GcodePreview renderer="2d" />`.

  No IR/parser change; no change to the 3D renderer's public API or output.

- [#220](https://github.com/ChestnutLabs/gcode-preview/pull/220) [`ca4d9c0`](https://github.com/ChestnutLabs/gcode-preview/commit/ca4d9c0cbbec7d4edc98403f615332c2b3c34453) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - E8 phase 4 ([#215](https://github.com/ChestnutLabs/gcode-preview/issues/215), DD-014 §6/§11) — capability honesty for the low-resource 2D view. Closes E8.
  - `gcode-renderer-2d`: `describe2DDisclosures(ir)` + `LayerView2D.getDisclosures()` return honest
    notes when the IR can't be faithfully shown as flat layers — `capabilities.layers: 'unavailable'`
    (non-planar / CNC: every move is on layer 0, so the 2D view shows them all in one flat top-down
    frame; Z variation and non-XY motion aren't represented) or `'inferred'`. Planar FDM → no note.
  - `gcode-preview-core`: `LayerView2DRenderer` emits those disclosures on `setIR` via the
    `renderer-unsupported` event, so a consumer UI is told what the flat view omits — never fabricated.

  The DD-014 §8 low-resource budget is verified on a real device (Linux/Chrome host): layer-change
  redraw ~0.2 ms median (≤ 3.6 ms even at 6× CPU throttle) vs the 16 ms budget, and ~0 MB heap growth
  over 870 renders (the 2D renderer builds no per-layer geometry). See
  `tools/benchmark/results/e8-2d-lowresource-benchmark-2026-07-26.md`.

- [#224](https://github.com/ChestnutLabs/gcode-preview/pull/224) [`d161e80`](https://github.com/ChestnutLabs/gcode-preview/commit/d161e802e36cc87fa27848ceef9d68cd45628760) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Source-line ↔ segment mapping ([#184](https://github.com/ChestnutLabs/gcode-preview/issues/184)) — the "G-code debugger" surface. Additive; no IR/geometry change.
  - `toolpath-core`: framework-free primitives over `segments.srcByte` + `sourceIndex`: build a line
    index (`buildSourceLineIndex`), then `lineAtByte` / `byteRangeOfLine` / `sourceLineOfSegment`
    (segment → its 1-based source line) / `segmentAtSourceLine` (line → segment, -1 when the line
    produced none). Both directions, O(log n).
  - `gcode-renderer-three`: `ToolpathRenderer.pickSegment(ndcX, ndcY, threshold?)` raycasts the
    toolpath and returns the IR segment under a pointer (or null) — click a segment → its source line.
    The pure index-mapping helper `resolveHitSegment(mesh, vertexIndex)` is exported and unit-tested.
  - `gcode-preview-core`: `PreviewRenderer.pickSegment` (the 2D renderer returns null — no picking yet),
    reachable via `raw.renderer()`.

- [#223](https://github.com/ChestnutLabs/gcode-preview/pull/223) [`82bd7ae`](https://github.com/ChestnutLabs/gcode-preview/commit/82bd7ae7f76e742767719d8efa11173a6548fc03) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Time-based scrub + a print-time estimate ([#181](https://github.com/ChestnutLabs/gcode-preview/issues/181)). Additive; no IR/geometry change.
  - `toolpath-core`: `computeToolpathTime(ir)` builds a cumulative **kinematic** time axis (per-segment
    length ÷ feedrate; constant-velocity, not accel-aware — a slight *under*estimate) plus
    `segmentsCompletedAtTime(cumulativeMs, ms)`. Unknown feedrates contribute 0 and flag the estimate
    approximate (`hasUnknownFeedrate`) — never a fabricated duration.
  - `gcode-preview-core`: state gains `totalTimeMs` + `timeEstimateSource` — **prefers the slicer's own
    estimate** (`DialectMetadata.printEstimate`, [#183](https://github.com/ChestnutLabs/gcode-preview/issues/183)) when present (`'slicer'`), else the kinematic
    total (`'kinematic'`). New `controls.setScrubTime(ms)` cuts the toolpath at a print time (resolves to
    a segment-index scrub).
  - Adapters (Vue/React/Svelte/Element): a `scrubTime` prop → `setScrubTime`.

- [#229](https://github.com/ChestnutLabs/gcode-preview/pull/229) [`be72283`](https://github.com/ChestnutLabs/gcode-preview/commit/be72283b20215450e8bf91b9a4eee730e98b423e) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Render slicer wipe moves as an independently toggleable layer (DD-016 phase 2, [#182](https://github.com/ChestnutLabs/gcode-preview/issues/182)).

  Phase 1 populated `MoveKind.Wipe` from `;WIPE_START`/`;WIPE_END`; this makes those moves visible
  and toggleable:
  - **renderer-three**: wipe segments build into their own `'wipe'` geometry chunk (separate from
    travel), and `setKindVisible('wipe', …)` shows/hides them. Default visible — nothing disappears
    until a consumer opts out. Wipe geometry is exempt from travel decimation (it is sparse and the
    point is to see it).
  - **core**: `setKindVisible` widens to `'extrude' | 'travel' | 'wipe'` (new `MoveKindToggle` type).
    The 2D renderer treats `'wipe'` as a documented no-op (the flat view has no distinct wipe form).
  - **adapters** (Vue/React/Svelte/Element): a `showWipe` prop / `show-wipe` attribute (default true)
    mirrors `showTravel`.

  Additive and backward-compatible; existing callers passing `'extrude'`/`'travel'` are unaffected.
  Completes [#182](https://github.com/ChestnutLabs/gcode-preview/issues/182).

### Patch Changes

- Updated dependencies [[`75f9f2b`](https://github.com/ChestnutLabs/gcode-preview/commit/75f9f2b2c758ef15b26a4b0f8dd955c89c9c5fb1), [`83f7db4`](https://github.com/ChestnutLabs/gcode-preview/commit/83f7db46be38477c4ff4127e250c6d6147c302ed), [`e8f889b`](https://github.com/ChestnutLabs/gcode-preview/commit/e8f889b576ee06da4181a048724c880ae38fedee), [`39348de`](https://github.com/ChestnutLabs/gcode-preview/commit/39348de9ce68717e71516f9acaccd475139983ba), [`5f3b16a`](https://github.com/ChestnutLabs/gcode-preview/commit/5f3b16a7aa8dfcce451d74f0cebece5f0eaaecef), [`dc1c535`](https://github.com/ChestnutLabs/gcode-preview/commit/dc1c5350ce545ae01e13c0782fed30d5d318f010), [`dc1c535`](https://github.com/ChestnutLabs/gcode-preview/commit/dc1c5350ce545ae01e13c0782fed30d5d318f010), [`17e9951`](https://github.com/ChestnutLabs/gcode-preview/commit/17e995123fa68274d508527261161741955b0647), [`f1afbb2`](https://github.com/ChestnutLabs/gcode-preview/commit/f1afbb2d2b6341805f7908aed501b4892ef7bd04), [`bb23c90`](https://github.com/ChestnutLabs/gcode-preview/commit/bb23c901cc405ea22aad9003ccb20c7cab525490), [`ca4d9c0`](https://github.com/ChestnutLabs/gcode-preview/commit/ca4d9c0cbbec7d4edc98403f615332c2b3c34453), [`4cd453f`](https://github.com/ChestnutLabs/gcode-preview/commit/4cd453f88f3dcb012af67ee8ff30159e371fd91a), [`d161e80`](https://github.com/ChestnutLabs/gcode-preview/commit/d161e802e36cc87fa27848ceef9d68cd45628760), [`82bd7ae`](https://github.com/ChestnutLabs/gcode-preview/commit/82bd7ae7f76e742767719d8efa11173a6548fc03), [`2d2b32b`](https://github.com/ChestnutLabs/gcode-preview/commit/2d2b32b836b296f2fac460073df10a7796596e9f), [`be72283`](https://github.com/ChestnutLabs/gcode-preview/commit/be72283b20215450e8bf91b9a4eee730e98b423e)]:
  - @chestnutlabs/gcode-parser@0.3.0
  - @chestnutlabs/gcode-renderer-three@0.3.0
  - @chestnutlabs/toolpath-core@0.3.0
  - @chestnutlabs/gcode-renderer-2d@0.3.0

## 0.2.0

### Minor Changes

- [#171](https://github.com/ChestnutLabs/gcode-preview/pull/171) [`1c2e5b0`](https://github.com/ChestnutLabs/gcode-preview/commit/1c2e5b031845630a6f82501de51e1ae902d52559) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add M600 filament-swap color-change annotation (E9 phase 3, [#147](https://github.com/ChestnutLabs/gcode-preview/issues/147), DD-009 D2).

  The parser now records a sparse `colorChanges` events channel on `ToolpathIR`
  (`{ x, y, z, segIndex, srcByte, tool }`, capability `colorChanges`) — `M600` is a marker with a
  position but no motion segment, captured in a side channel that leaves segment indices, scrub, and
  layer ranges untouched (mirrors the `retractions` channel from [#148](https://github.com/ChestnutLabs/gcode-preview/issues/148)). Detection lives in the parser
  (where `M600` was previously discarded as `unsupported-command`), so a bare `M600` is honored even
  when no dialect is detected. A new `colorChange` renderer color mode shades segments by **swap slot**
  (the count of color changes at or before a segment) using the existing palette-index path — not the
  `tool` channel — so multi-material prints color by active filament across manual swaps. Capability-
  gated: offered only when the IR actually carries an `M600`. Exposed through the existing `colorMode`
  option, so all adapters and `renderStill` support it with no new prop.

  DD-009 D2 was amended (maintainer-approved) to move detection from the dialect layer to the parser
  and realize the "dedicated color-change channel" as this sparse events channel.

- [#170](https://github.com/ChestnutLabs/gcode-preview/pull/170) [`d4c51a3`](https://github.com/ChestnutLabs/gcode-preview/commit/d4c51a394c1078efe959646b68f42de74e7cf4de) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add an orthographic camera option (E9 phase 2, [#150](https://github.com/ChestnutLabs/gcode-preview/issues/150), DD-009 D3).

  The renderer now carries both a perspective and an orthographic camera and switches between them with
  `setCameraMode('perspective' | 'orthographic')`, surfaced as a `cameraMode` renderer/controller option
  (default `'perspective'`), a `cameraMode` prop on the Vue, React, and Svelte adapters, and a
  `renderStill` option. Toggling preserves the view direction, target, and apparent framing — the
  orthographic frustum is sized to the same half-height the perspective view frames — and OrbitControls
  follows the active camera. Orthographic (parallel) projection suits dimensional/technical inspection.

- [#168](https://github.com/ChestnutLabs/gcode-preview/pull/168) [`11c75bd`](https://github.com/ChestnutLabs/gcode-preview/commit/11c75bd540c1490f888ec9ecee64814cafb25156) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add opt-in retraction/deretraction markers (E9 phase 1, [#148](https://github.com/ChestnutLabs/gcode-preview/issues/148), DD-009 D1).

  The parser now records a sparse `retractions` events channel on `ToolpathIR`
  (`{ x, y, z, kind, srcByte, segIndex }`, capability `retractions`) — E-only retraction moves emit no
  segment, so they are captured positionally in a side channel that leaves segment indices, scrub, and
  layer ranges untouched. The renderer draws them as opt-in always-on-top markers (warm = retract, cool
  = unretract) via `setShowRetractions`, clipped by the current layer/scrub window and shown only when
  the IR actually carries events. Exposed as a `showRetractions` prop across the Vue, React, and Svelte
  adapters (default off).

- [#173](https://github.com/ChestnutLabs/gcode-preview/pull/173) [`aceb9f2`](https://github.com/ChestnutLabs/gcode-preview/commit/aceb9f29091bec94f0de91791dd093ab0d92b834) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add a bounded declarative theming API (E9 phase 4, [#153](https://github.com/ChestnutLabs/gcode-preview/issues/153), DD-009 D4).

  A small, stable `Theme` object — `background`, `gridColor`, `bedColor`, `hemisphereIntensity`,
  `directionalIntensity`, and a `materialPreset` (`'matte'` | `'glossy'`) — surfaced as a renderer
  `theme` option + `setTheme()`, a controller `renderer.theme` option + `controls.setTheme()`, a `theme`
  prop on the Vue/React/Svelte adapters, and a `theme` option on `renderStill` (so headless thumbnails
  theme identically). The public type is three-free (`ThemeColor = number | string`) and re-exported
  through `gcode-preview-core`, so it stays valid across `three` upgrades; deep customization keeps using
  the `createRenderer` / `raw.renderer()` escape hatches.

  Additive and opt-in — the defaults reproduce the existing look exactly, and `setTheme` uses replace
  semantics (omitted fields reset to their defaults). Semantic colors (progress/retraction markers,
  overlay ghost/band, and the origin tripod) are intentionally not themeable; the material preset affects
  tube (extrude) geometry only — lines-quality geometry is unlit.

### Patch Changes

- Updated dependencies [[`1c2e5b0`](https://github.com/ChestnutLabs/gcode-preview/commit/1c2e5b031845630a6f82501de51e1ae902d52559), [`d4c51a3`](https://github.com/ChestnutLabs/gcode-preview/commit/d4c51a394c1078efe959646b68f42de74e7cf4de), [`11c75bd`](https://github.com/ChestnutLabs/gcode-preview/commit/11c75bd540c1490f888ec9ecee64814cafb25156), [`aceb9f2`](https://github.com/ChestnutLabs/gcode-preview/commit/aceb9f29091bec94f0de91791dd093ab0d92b834)]:
  - @chestnutlabs/toolpath-core@0.2.0
  - @chestnutlabs/gcode-parser@0.2.0
  - @chestnutlabs/gcode-renderer-three@0.2.0

## 0.1.0

### Minor Changes

- [#141](https://github.com/ChestnutLabs/gcode-preview/pull/141) [`c26879f`](https://github.com/ChestnutLabs/gcode-preview/commit/c26879f4148b77e5e9070bc2ee421a265c9571d3) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - First published line of the Chestnut Labs G-code Preview stack (`v0.1.0`, DD-008): worker-based
  `.gcode` / `.gcode.3mf` parsing into a versioned `ToolpathIR`, cross-vendor dialect annotation
  (PrusaSlicer, Orca/Bambu, Cura, Klipper, Marlin, RepRap-flavor), a Three.js renderer with layer
  clipping, scrub, tubes, build plates and the honest live-progress overlay, a framework-neutral
  preview controller, and first-class Vue/React/Svelte adapters with capability parity.

- [#145](https://github.com/ChestnutLabs/gcode-preview/pull/145) [`ab7db35`](https://github.com/ChestnutLabs/gcode-preview/commit/ab7db35b3fcc84da3f26c4b6fe91671470df05c5) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add `renderStill(source, options)` to `@chestnutlabs/gcode-preview-core`: a headless,
  non-interactive still-image entry point (DD-008 §4.8; the reusable capability behind AnyBridge's
  G-code thumbnail worker, [#791](https://github.com/ChestnutLabs/gcode-preview/issues/791)). Accepts G-code bytes or a pre-parsed `ToolpathIR`, builds to
  completion, frames deterministically (or applies an explicit camera pose), and renders one frame
  to an `OffscreenCanvas` or DOM canvas for the caller to read back.

  `gcode-renderer-three` gains the supporting surface: `ToolpathRenderer` accepts an `OffscreenCanvas`
  render target (new `RenderTargetCanvas` type) and a `preserveDrawingBuffer` option for readable
  single-frame renders.

### Patch Changes

- Updated dependencies [[`c26879f`](https://github.com/ChestnutLabs/gcode-preview/commit/c26879f4148b77e5e9070bc2ee421a265c9571d3), [`ab7db35`](https://github.com/ChestnutLabs/gcode-preview/commit/ab7db35b3fcc84da3f26c4b6fe91671470df05c5)]:
  - @chestnutlabs/toolpath-core@0.1.0
  - @chestnutlabs/gcode-parser@0.1.0
  - @chestnutlabs/gcode-renderer-three@0.1.0
