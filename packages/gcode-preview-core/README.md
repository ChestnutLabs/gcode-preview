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
applied in order once it binds. A bad layer, scrub, lens, pixel-ratio or colour-mode value throws
`RangeError` to you at once, queued or not. A theme or build volume only the 3D renderer can check
throws to you once the renderer is bound. If that call was queued, the preview reports it instead: it
sets `state.error` and fires an `error` event with code `E_CONTROL_REJECTED`. The message names the
control, for example `setTheme rejected: theme gridOpacity must be a number in [0,1] (got 2)`. The
calls queued after it still apply. The theme fields that are checked are listed in the
[renderer-three README](../gcode-renderer-three/README.md#theme-values-that-throw).

A colour mode is checked before it is stored: every colour must be `[r, g, b]` of three finite
numbers, and each mode needs its `palette` or `ramp`. See the
[gcode-colors README](../gcode-colors/README.md#colours-that-throw).

With `renderer: { mode: '2d' }`, a bad 2D option throws `RangeError` from `bindCanvas`: an
`adjacentLayers` of `NaN`, or a `ghostOpacity` outside `[0, 1]` or `NaN`. A negative `adjacentLayers`
is still valid and draws no ghost layers.

A callback you pass to `onStateChange` or `onEvent` that throws cannot break the preview. The other
callbacks still run, and `parse()` still resolves with the parse's own outcome. Your callback's error is
re-thrown from a microtask, so it still shows up as an uncaught error in the console.

Building an adapter for another framework? The **portable behavioral suite** is exported from
`@chestnutlabs/gcode-preview-core/testing` — `runBehavioralSuite(...)` is the same parity
contract the Vue, React, Svelte, and Web Component adapters pass in CI, and it is the anti-drift
firewall for any new integration.

Part of [Chestnut Labs G-code Preview](../../README.md) · MIT
