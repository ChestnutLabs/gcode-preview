# @chestnutlabs/gcode-model-renderer

Three.js **presentation** renderer for source models — draws an `.stl` or `.3mf` mesh as a clean,
studio-lit thumbnail. It answers *"what object is this?"*, and is deliberately **separate** from the
toolpath renderer, which answers *"how does this print/cut run?"* (design: DD-018).

> **Peer dependency:** `three` (supported range `^0.178.0`) — install it alongside this package.

Use it for file-browser thumbnails, library cards, and "what's in this file" previews — the picture a
slicer shows of a part, not the toolpath. For inspecting the actual moves (layers, travel, seams,
color modes, live progress), use [`@chestnutlabs/gcode-renderer-three`](../gcode-renderer-three)
instead.

- **STL and 3MF** — a bare STL is a single object with no declared material; a 3MF brings its own
  multi-object structure, per-object transforms, and per-object / per-triangle material colors,
  including files that use the 3MF **Production Extension** (`p:path` external parts).
- **Capability-honest color** — when the source declares colors (3MF `basematerials`), the render
  uses them and reports `materials: 'known'`. When it doesn't — a plain STL, or a proprietary paint
  format the 3MF standard doesn't cover — it draws a neutral default and reports
  `materials: 'unavailable'`. It never invents a source color.
- **Fixed presentation pose** — framed at a 3/4 angle on the shared render "stage" from
  `@chestnutlabs/gcode-renderer-three`, under a neutral studio light rig, on a transparent (default)
  or solid background you can composite onto a card.
- **Headless still** — `renderModelStill` mirrors the toolpath side's `renderStill`: hand it bytes,
  get back a canvas plus a stable `cacheKey` and the `materials` confidence for that render. Runs in
  any Chromium-class WebGL2 context (an `OffscreenCanvas` in a Worker, or headless Chromium).
- **Three-free public types** — `ModelScene` / `ModelObject` / `MeshGeometry` are plain typed arrays,
  so the package's surface never leaks `three`; the renderer builds three meshes internally.

```ts
import { renderModelStill } from '@chestnutlabs/gcode-model-renderer';

// In a Worker with an OffscreenCanvas, or headless Chromium:
const { canvas, objectCount, materials, cacheKey } = await renderModelStill(
  { kind: '3mf', bytes },                        // or { kind: 'stl', bytes }
  { canvas: new OffscreenCanvas(512, 512), background: 'transparent' }
);
// materials === 'known'  → the render used colors the file declared
// materials === 'unavailable' → the file carried none; a neutral default was used (never faked)
const blob = await canvas.convertToBlob();
```

Want to build your own scene or drive the renderer interactively? `parseStl` / `parse3mf` return a
three-free `ModelScene`, and `ModelRenderer` renders one onto a canvas you own.

Determinism: same input + same environment ⇒ identical output. Cross-GPU/driver pixel identity is not
promised — cache by the returned `cacheKey`.

Part of [Chestnut Labs G-code Preview](../../README.md) · MIT
