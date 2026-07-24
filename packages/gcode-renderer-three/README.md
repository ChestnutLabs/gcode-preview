# @chestnutlabs/gcode-renderer-three

Three.js **toolpath renderer** consuming [`ToolpathIR`](../toolpath-core) for the Chestnut Labs
G-code Preview stack (design: DD-004, live-progress overlay: DD-006).

> **Peer dependency:** `three` (supported range `^0.178.0`) — install it alongside this package.

![3DBenchy rendered as tubes with feature coloring](https://raw.githubusercontent.com/ChestnutLabs/gcode-preview/dev/docs/media/viewer-benchy-tubes.png)

- Layer-chunked line geometry with decimation + disclosure; tube geometry with automatic
  quality fallback
- Layer-range clipping and segment-level scrub via draw ranges (no rebuilds)
- Per-file build plates (`setBuildVolume`, mismatch events, consumer-wins precedence)
- DD-006 live-progress overlay: completed cut + translucent remaining-path ghost + always-on-top
  marker (byte-exact) or uncertainty band (approximate); user scrub always wins
- Opt-in retraction/deretraction markers (`setShowRetractions`) — warm = retract, cool = unretract,
  clipped by the same layer/scrub window; capability-honest (shown only when the IR carries events)

![Retraction (orange) and unretraction (cyan) markers on object boundaries](https://raw.githubusercontent.com/ChestnutLabs/gcode-preview/dev/docs/media/retraction-markers.png)
- Time-budgeted build ticks (rAF with a timeout backstop — works when rAF is suspended or absent),
  WebGL context-loss rebuild, injectable GL backend and frame scheduler (testable & headless-shaped)

```ts
import { ToolpathRenderer } from '@chestnutlabs/gcode-renderer-three';

const renderer = new ToolpathRenderer({ canvas });
renderer.setIR(ir);           // builds progressively; 'buildComplete' event when done
renderer.setLayerRange(0, 42);
renderer.setProgress(mapped); // DD-006 MappedProgress overlay
```

Most applications should consume this through [`@chestnutlabs/gcode-preview-core`](../gcode-preview-core)
or a framework adapter, which own the parse→render lifecycle.

Part of [Chestnut Labs G-code Preview](../../README.md) · MIT
