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

Building an adapter for another framework? The **portable behavioral suite** is exported from
`@chestnutlabs/gcode-preview-core/testing` — `runBehavioralSuite(...)` is the same parity
contract the Vue, React, Svelte, and Web Component adapters pass in CI, and it is the anti-drift
firewall for any new integration.

Part of [Chestnut Labs G-code Preview](../../README.md) · MIT
