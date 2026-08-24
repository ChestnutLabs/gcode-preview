# @chestnutlabs/gcode-model-renderer

Three.js **presentation** renderer for source models — draws an `.stl` or `.3mf` mesh as a clean,
studio-lit thumbnail. It answers *"what object is this?"*, and is deliberately **separate** from the
toolpath renderer, which answers *"how does this print/cut run?"* (design: DD-018).

> **Peer dependency:** `three` (supported range `^0.178.0`) — install it alongside this package.

![Two presentation thumbnails: a neutral gray STL part (materials: unavailable) beside a red/amber/green three-object 3MF (materials: known)](https://raw.githubusercontent.com/ChestnutLabs/gcode-preview/dev/docs/media/model-render-stl-3mf.png)

Use it for file-browser thumbnails, library cards, and "what's in this file" previews — the picture a
slicer shows of a part, not the toolpath. For inspecting the actual moves (layers, travel, seams,
color modes, live progress), use [`@chestnutlabs/gcode-renderer-three`](../gcode-renderer-three)
instead.

- **STL and 3MF** — a bare STL is a single object with no declared material; a 3MF brings its own
  multi-object structure, per-object transforms, and per-object / per-triangle material colors,
  including files that use the 3MF **Production Extension** (`p:path` external parts).
- **Production multicolor** — real Bambu Studio / OrcaSlicer files paint per-region color with a
  proprietary `paint_color` facet attribute and keep the palette in `project_settings.config`, not in
  standard 3MF materials. The renderer decodes that facet-paint format (clean-room, see
  [RR-005](../../docs/research/RR-005-3mf-paint-color-facet-format.md)) and reads the `filament_colour`
  palette itself, so a designer's multicolor model renders in its true colors without slicing.
- **Capability-honest color** — when the source declares colors — standard 3MF `basematerials`, or
  `paint_color` + a filament palette — the render uses them and reports `materials: 'known'`
  (`'approximated'` when a handful of multi-color facets are flattened). When it declares none — a
  plain STL, or a paint format with no palette present — it draws a neutral default and reports
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

Already hold a corrected or richer filament palette (e.g. re-rendering a sliced file)? Pass
`filamentPalette` (hex per 0-based slot) to `renderModelStill` / `parse3mf` to override the one read
from `project_settings.config`. Optional — the renderer reads the file's own palette without it.

Want to build your own scene or drive the renderer interactively? `parseStl` / `parse3mf` return a
three-free `ModelScene`, and `ModelRenderer` renders one onto a canvas you own.

Determinism: same input + same environment ⇒ identical output. Cross-GPU/driver pixel identity is not
promised — cache by the returned `cacheKey`.

Part of [Chestnut Labs G-code Preview](../../README.md) · MIT
