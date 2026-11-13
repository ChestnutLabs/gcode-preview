# @chestnutlabs/gcode-preview-core

The **framework-neutral preview controller** for the Chestnut Labs G-code Preview stack
(design: DD-007). This is the single engine under the Vue, React, Svelte, and Web Component
(`@chestnutlabs/gcode-preview-element`) adapters — parse
session + renderer + progress mapper glued into one lifecycle with an **immutable-snapshot state
model** (`getState()` returns a new identity per mutation; `onStateChange` notifies), which every
framework's reactivity can bridge cheaply.

```ts
import { createPreviewController } from '@chestnutlabs/gcode-preview-core';

const preview = createPreviewController();
preview.bindCanvas(canvas);              // resize-observed
await preview.parse(bytes);              // worker parse + progressive build
preview.controls.setLayerRange(0, 42);   // scrub / quality / colors / bed / frame ...
preview.observeProgress(obs);            // DD-006 live progress
preview.onStateChange(cb);               // snapshots: summaries only, never toolpath buffers
preview.dispose();
```

`parse()` hands a `Uint8Array` or `ArrayBuffer` to the parse worker without copying it, so the
buffer you passed is empty afterwards. To parse the same file again (for example a different plate
via `parse(bytes, { plate: 1 })`), keep your own copy and pass `bytes.slice()` each time. Passing
the already-transferred bytes fails with `E_POST_FAILED`, and the preview keeps working.

Controls you call before the renderer is ready (the 3D renderer loads on demand) are queued and
applied in order once it binds. A bad value throws `RangeError` to you at once, queued or not, and
nothing is queued. The same goes for the renderer options you pass to `createPreviewController`: a bad
one throws from the constructor, in 2D as well as 3D. These are checked up front, with the renderer's
own rules and messages:

| Option | Setter | Accepts |
| --- | --- | --- |
| `mode` | (none) | `'2d'`, `'3d'` |
| `theme` | `setTheme` | the fields listed under [theme values that throw](../gcode-renderer-three/README.md#theme-values-that-throw) |
| `buildVolume` | `setBuildVolume` | a volume the grid can draw (see the [renderer-three README](../gcode-renderer-three/README.md)) |
| `cameraMode` | `setCameraMode` | `'perspective'`, `'orthographic'` |
| (none) | `setView` | `'top'`, `'bottom'`, `'front'`, `'back'`, `'left'`, `'right'`, `'iso'` |
| (none) | `setCameraState` | finite `position` / `target`, `zoom` > 0, a valid `cameraMode` |
| `cameraFov` | `setCameraFov` | 10 to 120 degrees |
| `pixelRatio` | `setPixelRatio` | `'device'`, or a number in (0, 4] |
| `qualityMode` | `setQualityMode` | `'full'`, `'adaptive'`, `'fast'` |
| `progressivePreview` | `setProgressivePreview` | `'auto'`, `'lines'`, `'hold'`, `'off'` |
| `frameContent` | `setFrameContent` | `'object'`, `'all'` |
| `interactionQuality` | `setInteractionQuality` | `'off'`, `'auto'` |

Layer, scrub and colour-mode values are checked the same way. A queued call that the renderer still
rejects once it binds is reported instead of thrown: the preview sets `state.error` and fires an `error`
event with code `E_CONTROL_REJECTED`, and the message names the control (`setTheme rejected: ...`). The
calls queued after it still apply. A bed discovered in the file is not checked here: the renderer
reports a bad one as an event.

A colour mode is checked before it is stored: every colour must be `[r, g, b]` of three finite
numbers, and each mode needs its `palette` or `ramp`. See the
[gcode-colors README](../gcode-colors/README.md#colours-that-throw).

With `renderer: { mode: '2d' }`, a bad 2D option throws `RangeError` from `bindCanvas`: an
`adjacentLayers` of `NaN`, or a `ghostOpacity` outside `[0, 1]` or `NaN`. A negative `adjacentLayers`
is still valid and draws no ghost layers.

If the parse worker can't be created (a strict Content Security Policy is the usual cause), `parse()` emits
`parse-error` with code `E_WORKER_CREATE_FAILED`, sets `state.error` and returns to `parsing: false`; the next
`parse()` tries again. The event, `state.error` and the failed `parse()` outcome carry `{ code, message, cause }`,
where `cause` is the browser's own error, so you can check `error.cause?.name === 'SecurityError'`.

If the 3D renderer fails, the controller fires an `error` event with code `E_RENDERER_LOAD` and a `reason`:

- `'load'`: its code could not be downloaded (offline, or a stale deploy). Reload, or fall back to
  `renderer: { mode: '2d' }`.
- `'start'`: it downloaded but could not start, usually because there is no WebGL. Fall back to
  `renderer: { mode: '2d' }`; `cause` holds the browser's error.

Read `cause` but don't persist it: `structuredClone(state)` throws `DataCloneError` when a cause can't be copied.

A 2D-only app loads no three.js. This is the whole setup, and the startup bundle is about 35 KB:

```ts
import { createPreviewController } from '@chestnutlabs/gcode-preview-core';

const preview = createPreviewController({ renderer: { mode: '2d' } });
```

The 3D renderer loads when a 3D view binds, not when core is imported. If your own tests wait a fixed number of
ticks for it, preload it once in the test setup: `await import('@chestnutlabs/gcode-renderer-three')`. The
three-free pieces (`CaptureUnsupportedError`, `studioTheme`, `STUDIO_CAMERA_FOV`) are also exported from
`@chestnutlabs/gcode-renderer-three/lite`; you normally don't need it.

A callback you pass to `onStateChange` or `onEvent` that throws cannot break the preview. The other
callbacks still run, and `parse()` still resolves with the parse's own outcome. Your callback's error is
re-thrown from a microtask, so it still shows up as an uncaught error in the console.

Building an adapter for another framework? The **portable behavioral suite** is exported from
`@chestnutlabs/gcode-preview-core/testing` — `runBehavioralSuite(...)` is the same parity
contract the Vue, React, Svelte, and Web Component adapters pass in CI, and it is the anti-drift
firewall for any new integration.

Part of [Chestnut Labs G-code Preview](../../README.md) · MIT
