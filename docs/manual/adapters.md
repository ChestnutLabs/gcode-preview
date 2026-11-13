---
title: Framework adapters
group: Guide
category: Guide
---

# Framework adapters

Every adapter is a thin shell over the framework-neutral **`@chestnutlabs/gcode-preview-core`**
controller, so they share the same capabilities, options, events, and TypeScript contracts —
enforced by a portable behavioral suite that runs against all four in CI, including a parity guard
that fails the build if a controller capability isn't exposed by an adapter. Each has **two adoption
levels**: a complete `<GcodePreview>` component, and a lower-level API for building your own controls.

## Two ways in

```
<GcodePreview source={file} />        ← drop-in viewer, sensible defaults
useGcodePreview() / createGcodePreview() / element.controls   ← your own UI over the same engine
```

Reach for the component to get a working viewer in one line; reach for the lower-level API when you
want bespoke controls without reimplementing the parse→render pipeline.

## Two viewers: Preview and Prepare

The SDK has two viewing surfaces, like a slicer's two modes — and each framework exposes both:

- **Preview** — the sliced **G-code / toolpath** (`<GcodePreview>`, from the package root). Layers,
  travel, scrub, color modes, diagnostics.
- **Prepare** — the **source model** (STL / 3MF) before slicing (`<ModelViewer>`, from the package's
  **`/model`** subpath). Orbit/zoom/pan, honest material-colour capability tier, object/instance counts,
  per-plate render scope, capture.

The model viewer is a thin declarative shell over the framework-neutral
`createModelPreviewController` (in `@chestnutlabs/gcode-model-renderer`), exactly as the toolpath
component is over `gcode-preview-core` — same idioms (props/options, events, a ref/handle, `getState`
where the framework is reactive), and a matching portable behavioral suite with its own parity guard.
It lives behind the `/model` subpath so toolpath-only consumers never bundle the model renderer.

| Framework | Toolpath (Preview) | Source model (Prepare) |
| --- | --- | --- |
| React | `import { GcodePreview } from '@chestnutlabs/gcode-preview-react'` | `import { ModelViewer } from '@chestnutlabs/gcode-preview-react/model'` |
| Vue | `import { GcodePreview } from '@chestnutlabs/gcode-preview-vue'` | `import { ModelViewer } from '@chestnutlabs/gcode-preview-vue/model'` |
| Svelte | `import GcodePreview from '@chestnutlabs/gcode-preview-svelte/GcodePreview.svelte'` | `import ModelViewer from '@chestnutlabs/gcode-preview-svelte/model/ModelViewer.svelte'` |
| Web Component | `import '@chestnutlabs/gcode-preview-element/define'` → `<gcode-preview>` | `import '@chestnutlabs/gcode-preview-element/model/define'` → `<gcode-model-viewer>` |

```jsx
// React — the smallest source-model integration (STL / 3MF bytes)
<ModelViewer source={{ kind: 'stl', bytes }} onReady={(info) => console.log(info.materials)} />
```

`<ModelViewer source={…} />` alone is a working viewer; `onReady`/`@ready`/`on:ready`/the `ready`
event carries the honest `ModelReadyInfo` (`objectCount`, `materials` tier, `bounds`, `instancedCount`,
`plates?`). The showcase examples put Preview and Prepare behind one toggle.

## Try the examples

Each adapter ships a runnable Vite example in the repository with **two tiers**, both driving the
real published package (never a raw renderer or parser):

| Adapter | Example | Port |
| --- | --- | --- |
| Vue | `tools/example-vue` | 5203 |
| React | `tools/example-react` | 5201 |
| Svelte | `tools/example-svelte` | 5202 |
| Web Component | `tools/example-webcomponent` | 5204 |

Every one has a **`minimal.html`** — the smallest toolpath integration you'd copy to get started — a
**`model.html`** — the smallest source-model integration (`<ModelViewer source>`) — and a
**`showcase.html`** — the full capability-aware surface with the Preview/Prepare toggle (color modes
that grey out with a reason when a file can't support them, declarative feature-role hiding,
`getRenderStats()`/`pickSegment()` diagnostics, and the source-model viewer). Run one with, e.g.,
`npm install --prefix tools/example-react && npm run dev --prefix tools/example-react`.

## The shared surface

The declarative props below are equivalent across the Vue, React, and Svelte components (camelCase),
and are attributes or properties on the Web Component (see the Web Component note for which is which):

**Source & parse** — `source` · `parseOptions` · `renderer` (`'3d'`/`'2d'`) · `createWorker`
**Inspect** — `layerRange` · `scrub` · `scrubTime` · `showTravel` · `showWipe` · `showCut` · `showRetractions` ·
`hiddenFeatureRoles`
**Appearance** — `colorMode` · `theme`
**View / camera** — `cameraMode` · `cameraFov` · `view` · `cameraState` · `frameContent` · `showVolumeCage`
**Rendering** — `quality` · `qualityMode` · `progressivePreview` · `interactionQuality` · `pixelRatio` · `tube`
**Machine & progress** — `buildVolume` · `progress`

A `Uint8Array` or `ArrayBuffer` given as `source` (or to `controls.parse`) is handed to the parse
worker without copying, so that buffer is empty afterwards. In every adapter, changing `parseOptions`
alone does not re-parse: the next parse uses the current `parseOptions`. To parse the same file again —
for example a different plate — set a new `source` that is a fresh copy (`bytes.slice()`), or call
`controls.parse(bytes.slice(), { plate: 1 })`. Passing the
already-used buffer fails with `E_POST_FAILED`, and the preview keeps working. A `File` source can
be re-parsed as-is.

Each fires the same events (naming follows each framework's idiom): parse lifecycle
(`ready` / `parse-error` / `parse-cancelled` / `parse-progress`), staged preparation (`stage`),
`build-complete`, `quality-fallback`, camera settle (`camera-change`), machine geometry
(`machine-geometry-discovered` / `machine-geometry-mismatch`), `progress-presentation-changed`,
`disclosure`, `renderer-unsupported`, and `error`. Every parse that starts ends with exactly one of `ready`,
`parse-error` or `parse-cancelled`; a parse replaced by a newer source reports `parse-cancelled`, and one
replaced before it started emits nothing.

A control you call before the 3D renderer has loaded is queued and applied when it is ready. A bad value, for
example a theme opacity outside 0–1, is never queued: the call throws `RangeError` at once, before and after the
load, with the same message the renderer uses. An option or prop left `null` or `undefined` is not an error: before
any value is set it means the default, and a prop cleared to `null` later leaves the current value (the one
exception for now is `colorMode`, where `null` still throws). If the renderer still rejects a queued call (rare, since values are checked first), you get an `error`
event and `state.error` with code `E_CONTROL_REJECTED` and a message that names the control; the other queued
controls still apply.

`setLayerRange`, `setScrubPosition` and `setScrubTime` throw `RangeError` at once for a value that is not a
number, or is `NaN`, even before the renderer has loaded. `null` (clear, on `setScrubPosition` and
`setScrubTime` only; `setLayerRange` takes numbers) and `±Infinity` (an open end, on all three) are still
accepted. On `<gcode-preview>` a non-numeric `scrub` or `scrub-time` attribute is ignored instead, and
the previous cut is kept, so the source still parses. A callback of yours that throws (an event handler or
`onStateChange`) cannot change a parse's outcome: the other callbacks still run, and the error is re-thrown
from a microtask so it still reaches the console.

`scrub`, `scrubTime` and `layerRange` describe the view you want, and they stay in force until you change
them. Loading a file starts from the whole toolpath, so each adapter re-sends the ones that hold a value whenever
`source` changes, and the new file opens with the same cut or range. A prop you leave unset sends nothing: it
does not clear a cut you set another way. Setting one back to `null` (or removing the attribute) clears it. When
both `scrub` and `scrubTime` hold a value, `scrubTime` wins. A call you make from a `ready` handler applies to
that file and wins over the props, so you can still reset the range to each new file's layer count there.
Calling `controls.parse()` yourself does not re-send the props: set the cut you want after it, or before it
finishes.

The `theme` and `colorMode` props also throw `RangeError` for a value the renderer can't use, in every adapter:
see [theme values that throw](https://github.com/ChestnutLabs/gcode-preview/blob/dev/packages/gcode-renderer-three/README.md#theme-values-that-throw)
and [colours that throw](https://github.com/ChestnutLabs/gcode-preview/blob/dev/packages/gcode-colors/README.md#colours-that-throw).
So do `buildVolume`, `cameraMode`, `qualityMode`, `progressivePreview`, `frameContent`, `interactionQuality` and
`renderer`, and the matching `controls` calls (`setView` and `setCameraState` too). The throw comes at once, from
mounting or from the call, even before the 3D renderer has loaded and on a 2D viewer. On `<gcode-preview>` this
applies to the properties; a bad attribute value is ignored instead. The allowed values are listed in the
[core README](https://github.com/ChestnutLabs/gcode-preview/blob/dev/packages/gcode-preview-core/README.md).

Two of the events tell your users what the view is not showing. They answer different questions:

| | `disclosure` | `renderer-unsupported` |
| --- | --- | --- |
| Tells you | what the current build leaves out | that the renderer can't honour a setting you asked for |
| When | after every `build-complete` | once per request (no dedupe), including some props set at mount |
| Payload | the text, `''` when nothing is left out | `{ feature, message }`; `feature` is `camera`, `quality`, `layers` or `retractions` |
| Also in state | yes, `state.disclosure` | no, event only |
| Vue | `@disclosure` | `@renderer-unsupported` |
| React | `onDisclosure` | `onRendererUnsupported` |
| Svelte | `on:disclosure` | `on:rendererunsupported` |
| Web Component | `disclosure` (`detail.text`) | `renderer-unsupported` (`detail`) |

In practice `renderer-unsupported` comes from the flat 2D renderer (`renderer="2d"`). It fires when you set a
3D-only option: `quality`, `cameraMode`, `cameraFov`, `pixelRatio`, `view`, `cameraState`, or `showRetractions`.
It also fires when a toolpath isn't planar. Setting the same option twice fires twice, so show the latest
message instead of a list.

At mount, every adapter follows one rule for `quality`, `cameraMode`, `cameraFov` and `pixelRatio`: a value that
differs from the default fires once, and a default fires nothing, whether you wrote it out or left it off. The
defaults are `quality="auto"`, `camera-mode="perspective"`, a lens of 50 degrees, and no pixel ratio. The 3D
renderer is built with these values, so the rule never rebuilds a 3D view. The model viewer (`/model`) uses the
same event names.

These mount-time notices fire while the component mounts, so the listener has to be in place first. On
`<gcode-preview>` they fire in `connectedCallback`: add the listener before `appendChild`, because one added just
after it misses them. In Svelte, listen with an `on:rendererunsupported` directive in the parent template; a `$on`
attached after `new GcodePreview({ target })` misses them.

The lower-level APIs (`useGcodePreview`, `createGcodePreview`, `createPreviewController`) deliver the same event
through `onEvent`, once per `controls.set*` call. They don't report options passed at construction to a 2D
renderer. To get the notice, call the control after creating the preview.

The `disclosure` text says what the current build leaves out. It follows every `build-complete`, in both
renderers, and is empty when the build draws everything. In 3D it names decimation (`Showing every 3rd
extrusion segment …`). For a toolpath you build yourself, it also counts segments skipped for an `Infinity` or
`NaN` coordinate: `3 segments with a non-finite coordinate were not drawn.` The two renderers count
differently. The flat 2D view checks x and y, over extrusion, Cut and travel. The 3D renderer checks x, y and z, over
every segment it builds: extrusion, travel and wipe. A segment with only a non-finite z is drawn in 2D and
skipped in 3D. Both count every layer, not only the one on screen, and both count travel whether or not travel
is shown, because a skipped segment is never drawn. In 2D, `build-complete` fires once each time a toolpath
loads, with `quality: 'lines'`.

Beyond the declarative props, the same **imperative surface** is reachable through the handle's
`controls` in every adapter — including render diagnostics (`getRenderStats`), segment picking /
source-mapping (`pickSegment`), the color-mode capability gate (`isColorModeAvailable`), and image
`capture`. Capability-aware state (`availableColorModes`, `hasRetractions`, `hasColorChanges`) lets
your UI offer and *explain* controls honestly rather than guessing.

### Error codes you can handle

These codes arrive on the `error` and `parse-error` events, in `state.error`, or as the `code` of a rejected
promise. Each adapter surfaces them the same way.

Every error is `{ code, message }`, plus two optional fields:

- **`cause`** is the original error when there is one: for example the browser's `SecurityError` behind
  `E_WORKER_CREATE_FAILED`, or what the WebGL renderer threw behind `E_RENDERER_LOAD`. Use it to tell causes apart
  (`error.cause?.name === 'SecurityError'`) instead of matching on `message`. It is for reading, not persisting: a
  cause may not survive `structuredClone`, and `structuredClone(state)` throws `DataCloneError` when it can't copy it.
- **`reason`** is set on `E_RENDERER_LOAD` only. It says what to do next, as in the table.

| Code | When | What to do |
| --- | --- | --- |
| `E_WORKER_CREATE_FAILED` | `createWorker`, or the default worker, threw: a strict Content Security Policy is the usual cause | The preview returns to `parsing: false`; the next `parse()` tries again. The browser's own error is on `cause` |
| `E_RENDERER_LOAD` with `reason: 'load'` | The 3D renderer's code could not be downloaded: offline, or a stale deploy whose chunk now returns 404 | Reload the page, or fall back to `renderer: { mode: '2d' }` (or the `/lite` entry) |
| `E_RENDERER_LOAD` with `reason: 'start'` | The 3D renderer downloaded but could not start, usually because the device or browser has no WebGL. Read `cause` for the browser's error: a renderer option the renderer rejects lands here too | Fall back to `renderer: { mode: '2d' }`; reloading won't help |
| `E_WORKER_TERMINATED` | You passed a single `Worker` instance as `createWorker` and it was terminated (a cancel that the worker did not acknowledge in time, a crash, or `dispose()`); the next parse used to hang | Pass a factory, `createWorker: () => new Worker(…)`, so each parse gets a fresh worker |
| `E_POST_FAILED` | You re-parsed a buffer that was already handed to the worker | Pass `bytes.slice()` each time. The browser's `DataCloneError` is on `cause` |
| `E_CONTROL_REJECTED` | The renderer rejected a control you queued before it loaded. Rare: a bad value throws `RangeError` from the call instead (see above) | Fix the value named in the message |
| `E_CAPTURE_UNSUPPORTED` | `capture()` was called before the 3D renderer is ready, or on the 2D renderer | Call it once the 3D view shows the file (the `stage` event's `ready` stage); `ready` can fire before the 3D chunk has bound, so retry on this code |
| `E_PARSE_OPTION`, `E_MODEL_OPTION` | A `parseOptions` or model limit is not a usable number | Pass a finite whole number; there is no `Infinity` |

The `/model` viewer adds codes for files it refuses: `E_MODEL_TOO_LARGE`, `E_MODEL_TOO_MANY_TRIANGLES`,
`E_MODEL_TOO_MANY_VERTICES` and the rest. The
[model renderer README](https://github.com/ChestnutLabs/gcode-preview/blob/dev/packages/gcode-model-renderer/README.md)
lists the limit codes and what triggers each.

### A 2D-only app

`renderer: { mode: '2d' }` (`renderer="2d"` on the components) loads no three.js: the startup bundle for a 2D-only
controller is about 35 KB, against about 630 KB when three.js is bundled. The 3D renderer loads only when a 3D view
binds. If your own tests wait a fixed number of ticks for the 3D renderer to bind, preload it once in your test
setup:

```ts
await import('@chestnutlabs/gcode-renderer-three');
```

`@chestnutlabs/gcode-renderer-three/lite` is the three-free entry; most apps never import it.

## Look, lens and plate (opt-in)

The **Studio look** (`studioTheme('dark' | 'light')`, a gradient backdrop, a solid build plate with grid and
outline, and a contact shadow) and a **camera lens** (`cameraFov`, 10-120 degrees, default 50; the preset uses
`STUDIO_CAMERA_FOV` = 32) are optional. With no `theme` and no `cameraFov` every viewer renders as before. Import
the preset from `@chestnutlabs/gcode-renderer-three` (also re-exported by `-core` and `-model-renderer`).
The [Studio look and build plate](guide-looks-lens-plate.md) guide has the full tour.

| | Toolpath (`GcodePreview`) | Model viewer (`/model`) |
| --- | --- | --- |
| Look | `theme` (declarative), `controls.setTheme` | `theme`, `controls.setTheme`; plate and backdrop fields only, lights are not themed |
| Lens | `cameraFov` / `camera-fov`, `controls.setCameraFov(deg)` | the same |
| Plate | `buildVolume` (already there) | `buildVolume` (new), `controls.setBuildVolume(def \| null)` |
| Placement | n/a | `placement` + `placementOffset` on `ready` and in state: `known` / `inferred` / `approximated`, or `null` when no plate is drawn |
| Cage | `showVolumeCage` / `show-volume-cage`, `controls.setBuildVolumeCage(visible)` | the same; it drops only the wireframe, the plate, grid and shadow stay |

Deliberate differences, not drift:

- **Web Component.** `camera-fov` is an attribute (on `<gcode-preview>` and `<gcode-model-viewer>`) and `cameraFov` a
  property. An invalid attribute value (non-numeric or outside 10-120) is ignored and the last valid lens is kept; setting
  the property to an invalid value throws `RangeError`. `theme` and `buildVolume` are properties only (objects).
  `show-volume-cage` is an attribute too: absent or anything but `"false"` means the cage is on.
- **Clearing the plate.** On the model viewer, `setBuildVolume(null)` (or a `buildVolume` prop cleared to `null`)
  removes the plate. On the toolpath viewer it does nothing: the current plate stays, also after a volume was set,
  and a bed found in a later file is reported (`machine-geometry-discovered`) but not applied. The toolpath renderer
  has no "remove the plate" operation. Before any volume is set, `buildVolume: null` there lets a file's bed apply.
- **Model viewer themes.** Only `background`, the grid and outline fields, `bedSurface` and `contactShadow` apply.
  `theme.background` beats the `background` prop, which is the fallback tier.
- **2D renderer** (`renderer="2d"`). A flat top-down view: `theme` and the cage are ignored (no-ops). A lens, as a
  prop at mount or a later `setCameraFov`, fires the `renderer-unsupported` event once (feature `camera`). The 2D
  renderer has no 3D look to preset.

## Pixel ratio (opt-in)

`pixelRatio` sets the resting pixel ratio of the interactive 3D canvas: a number in (0, 4], or `'device'`, which
follows `min(devicePixelRatio, 2)` live (monitor change, browser zoom). Anything else throws `RangeError` and is never
clamped. Left unset, the renderer keeps its own ratio and nothing changes.

| | Toolpath (`GcodePreview`) | Model viewer (`/model`) |
| --- | --- | --- |
| Ratio | `pixelRatio` / `pixel-ratio`, `controls.setPixelRatio(ratio)`; core: `renderer: { pixelRatio }` | `pixelRatio` / `pixel-ratio`, `controls.setPixelRatio(ratio)` |

- **Fill cost.** Ratio 2 shades four times the fragments of ratio 1 (ratio squared). `'device'` suits a page with one
  viewer; leave it unset, or use a number, for many viewers or weak GPUs. `interactionQuality: 'auto'` still lowers the
  ratio while you orbit and settles back on yours.
- **`capture()` size.** With no `width`/`height`, unset gives the resting drawing-buffer size and a set ratio gives the
  canvas's CSS size. With the built-in renderer, setting a ratio never changes the default capture size. A custom
  `createRenderer` decides for itself. Pass `width`/`height` for a crisper image.
- **Web Component.** `pixel-ratio` is an attribute and `pixelRatio` a property on `<gcode-preview>` and
  `<gcode-model-viewer>`. An invalid attribute is ignored and the last valid ratio kept; an invalid property value
  throws `RangeError`.
- **2D renderer.** A no-op. The prop at mount, or a later `setPixelRatio`, fires the `renderer-unsupported` event once
  (feature `quality`). Stills
  (`renderStill`, `renderModelStill`) have no pixel-ratio option; size them with `width`/`height`.

## Vue

```vue
<script setup>
import { GcodePreview } from '@chestnutlabs/gcode-preview-vue';
</script>
<template>
  <GcodePreview :source="file" quality="tubes" color-mode="feature" />
</template>
```

Lower level: **`useGcodePreview()`** — a composable giving you the canvas ref, worker parse,
`controls`, `capture`, and reactive state summaries.

## React

```tsx
import { GcodePreview } from '@chestnutlabs/gcode-preview-react';

function Viewer({ file }) {
  return <GcodePreview source={file} quality="tubes" onReady={(s) => console.log(s.segments)} />;
}
```

StrictMode-safe. Lower level: **`useGcodePreview()`** — `useSyncExternalStore`-backed state with an
identity-stable handle (`controls`, `capture`).

## Svelte

```svelte
<script>
  import GcodePreview from '@chestnutlabs/gcode-preview-svelte/GcodePreview.svelte';
</script>
<GcodePreview source={file} on:ready={(e) => console.log(e.detail.segments)} />
```

Ships as raw `.svelte` (your bundler's Svelte plugin compiles it), imported from the
`/GcodePreview.svelte` subpath. Lower level: **`createGcodePreview()`** — a store contract plus a
`use:` canvas action.

## Web Component (no framework)

```html
<script type="module">
  import '@chestnutlabs/gcode-preview-element/define';
</script>
<gcode-preview quality="tubes" camera-mode="orthographic"></gcode-preview>
```

Scalar options (`quality`, `camera-mode`, `layer-range`, `scrub`, `view`, `hidden-feature-roles`, …)
are **attributes**; rich options (`.source`, `.colorMode`, `.theme`, `.tube`, `.buildVolume`) are
**JS properties** because objects can't be attributes. Listen for `ready`; call `element.capture()`
or `element.controls.*` for the imperative surface. Works in any page or framework. The source-model
counterpart is `<gcode-model-viewer>` (from `/model/define`) — the tag avoids the reserved
`<model-viewer>` name.

On `<gcode-preview renderer="2d">`, a non-numeric `adjacent-layers` attribute is ignored and the default of one
ghost layer applies.

## Build your own (core)

`@chestnutlabs/gcode-preview-core` exposes the controller each of the four adapters wraps — mount it
on a canvas, drive parse/render, and subscribe to state. Reach for it when you want a bespoke UI (or
a framework we don't ship an adapter for) without reimplementing the pipeline.

> **Single source of truth.** Each package's own `README` on npm/GitHub is the canonical short
> reference for that adapter's exact API — this page is the cross-adapter tour. See, for example, the
> [Vue package README](https://github.com/ChestnutLabs/gcode-preview/tree/dev/packages/gcode-preview-vue).
> Deliberate per-framework differences (Web Component property-vs-attribute split and DOM-wrapped
> event details; Svelte's `.svelte` subpath) are noted in the package READMEs.
