# Headless Still Render (`renderStill`)

**Status:** Live from `v0.1.0` (DD-008 §4.8, E7 phase 5, #132) · consumer: AnyBridge #791.

`renderStill` produces a single non-interactive image of a **toolpath** in a headless/offscreen
environment — the reusable capability behind AnyBridge's `ThumbnailWorker` G-code backend. It is a
**bounded adapter over the same engine** the interactive viewer uses (parse → `ToolpathIR` →
`ToolpathRenderer`); it reuses that renderer rather than adding a new one.

> Rendering the **source model** (an STL/3MF mesh) instead of the toolpath is a separate job with its
> own package — see [`renderModelStill`](../../packages/gcode-model-renderer/README.md) in
> `@chestnutlabs/gcode-model-renderer`.

```ts
import { renderStill } from '@chestnutlabs/gcode-preview-core';

// In a Worker with an OffscreenCanvas, or an Electron hidden window:
const canvas = new OffscreenCanvas(1024, 768);
const { segmentCount } = await renderStill(gcodeBytes, {
  canvas,
  quality: 'tubes',
  buildVolume: machineGeometry // optional; discovered geometry otherwise
});
const png = await canvas.convertToBlob({ type: 'image/png' }); // caller extracts pixels
```

## Input

`source` is **G-code bytes** (`Uint8Array` / `ArrayBuffer` — a worker parse runs; supply
`createWorker` for the slim/custom worker, else the batteries default) **or a pre-parsed
`ToolpathIR`** (no worker; AnyBridge can render straight from an IR it already holds).

## Options (all neutral — the surface AnyBridge's `RenderSpec` translates onto)

| Option | Meaning |
|---|---|
| `canvas` (required) | `OffscreenCanvas` or DOM canvas — the render target |
| `width` / `height` | output size (defaults to the canvas dimensions) |
| `quality` | `'auto'` (default) / `'tubes'` / `'lines'` |
| `colorMode` | single / by-tool / by-feature (feature is capability-gated) |
| `tube` | tube profile parameters |
| `tubeByteBudget` | memory ceiling, in bytes, for the retained tube mesh; a plate whose tubes would exceed it is drawn as lines instead (`result.quality` says which). Raise it when the host has RAM to spare. Ignored when `qualityMode` is `'full'` |
| `qualityMode` | fidelity policy: `'adaptive'` (default) keeps tubes unless `tubeByteBudget` forces lines; `'full'` always draws full geometry and never falls back to lines; `'fast'` always draws flat lines. Same option and meaning as the interactive viewer |
| `buildVolume` | a renderer volume or discovered `MachineGeometry` |
| `layerRange` | inclusive `[start, end]` layer clip |
| `scrub` | draw up to a segment index (progress-style clip) |
| `showTravel` | include travel moves (default off) |
| `camera` | explicit `{ position, target, fov? }` pose; omitted → **deterministic bounds framing** |
| `createWorker` / `parseOptions` | worker + wire options for the bytes path |
| `createRenderer` | GL-backend injection (tests / exotic hosts) |

Returns `{ canvas, width, height, layerCount, segmentCount, quality, parsed }`. The build runs to
completion before a single render; the caller reads pixels from `canvas` in its own environment
(`convertToBlob`, `toDataURL`, or a WebGL `readPixels`).

## Errors

If the toolpath geometry fails to build, `renderStill` rejects with a `RenderStillError` (exported
from `@chestnutlabs/gcode-preview-core`). Its `code` is `'E_GEOMETRY_BUILD'` and its `message` is
the renderer's description. The internal renderer is already disposed when the rejection arrives.
A parse failure on G-code bytes rejects with the parser's `ParseSessionError`, which has the same
`code` / `message` shape. Before v0.22.0 a failed build left the promise pending forever, so add a
`catch` to any still job that awaited without one.

Options that would only produce a blank or broken still reject with a `RangeError` before any parse
or GL work starts: an output size (`width` / `height`, or the canvas size) that is not a finite
number greater than 0, a `cameraFov` or `camera.fov` outside [10, 120], a `camera.position` or
`camera.target` that is not three finite numbers, and a `NaN` `scrub` or `layerRange` bound.

```ts
try {
  await renderStill(gcodeBytes, { canvas });
} catch (err) {
  // err.code: 'E_GEOMETRY_BUILD' for a build failure, or a parser code for a parse failure
  showError(err.code, err.message);
}
```

## Determinism

**Same environment ⇒ identical output.** Framing is computed purely from model bounds, the build
runs to completion before the one render, and no animation loop is involved. Cross-GPU/driver
**pixel identity is not promised** (antialiasing and rasterization vary by hardware) — cache by job
identity, not by pixel hash.

## Supported environments

Any **Chromium-class WebGL2 context**: a Worker `OffscreenCanvas`, an Electron hidden `BrowserWindow`,
or headless Chromium (CI). The drawing buffer is preserved so the canvas is readable after the render
returns.

**Out of scope (roadmap):** pure-Node GPU-less rendering (software rasterization / a WebGL shim) is a
deferred **E8-class** capability — it would need substantial new infrastructure and is not part of
`v0.1.0`. If a future consumer needs server-side rendering without a Chromium-class context, that
opens its own DD.

## Ownership boundary (AnyBridge #791)

`gcode-preview` owns this reusable capability. AnyBridge owns only: its `ThumbnailWorker`
integration, translating its shared `RenderSpec` into these neutral options, and
caching/storage/job-identity/workflow behavior. AnyBridge does **not** maintain a duplicate
rendering harness.
