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
**Inspect** — `layerRange` · `scrub` · `scrubTime` · `showTravel` · `showWipe` · `showRetractions` ·
`hiddenFeatureRoles`
**Appearance** — `colorMode` · `theme`
**View / camera** — `cameraMode` · `cameraFov` · `view` · `cameraState` · `frameContent` · `showVolumeCage`
**Rendering** — `quality` · `qualityMode` · `progressivePreview` · `interactionQuality` · `pixelRatio` · `tube`
**Machine & progress** — `buildVolume` · `progress`

A `Uint8Array` or `ArrayBuffer` given as `source` (or to `controls.parse`) is handed to the parse
worker without copying, so that buffer is empty afterwards. In React, Vue, and the Web Component,
changing `parseOptions` alone does not re-parse; Svelte, whose reactive block also tracks
`parseOptions`, does re-parse when it changes. Either way, to parse the same file again — for example a
different plate — set a new `source` that is a fresh copy (`bytes.slice()`), or call
`controls.parse(bytes.slice(), { plate: 1 })`. Passing the
already-used buffer fails with `E_POST_FAILED`, and the preview keeps working. A `File` source can
be re-parsed as-is.

Each fires the same events (naming follows each framework's idiom): parse lifecycle
(`ready` / `parse-error` / `parse-cancelled` / `parse-progress`), staged preparation (`stage`),
`build-complete`, `quality-fallback`, camera settle (`camera-change`), machine geometry
(`machine-geometry-discovered` / `machine-geometry-mismatch`), `progress-presentation-changed`,
`disclosure`, and `error`.

The `disclosure` text says what the current build leaves out. It follows every `build-complete`, in both
renderers, and is empty when the build draws everything. In 3D it names decimation (`Showing every 3rd
extrusion segment …`). For a toolpath you build yourself, it also counts segments skipped for an `Infinity` or
`NaN` coordinate: `3 segments with a non-finite coordinate were not drawn.` The two renderers count
differently. The flat 2D view checks x and y, over extrusion and travel. The 3D renderer checks x, y and z, over
every segment it builds: extrusion, travel and wipe. A segment with only a non-finite z is drawn in 2D and
skipped in 3D. Both count every layer, not only the one on screen, and both count travel whether or not travel
is shown, because a skipped segment is never drawn. In 2D, `build-complete` fires once each time a toolpath
loads, with `quality: 'lines'`.

Beyond the declarative props, the same **imperative surface** is reachable through the handle's
`controls` in every adapter — including render diagnostics (`getRenderStats`), segment picking /
source-mapping (`pickSegment`), the color-mode capability gate (`isColorModeAvailable`), and image
`capture`. Capability-aware state (`availableColorModes`, `hasRetractions`, `hasColorChanges`) lets
your UI offer and *explain* controls honestly rather than guessing.

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
- **Model viewer themes.** Only `background`, the grid and outline fields, `bedSurface` and `contactShadow` apply.
  `theme.background` beats the `background` prop, which is the fallback tier.
- **2D renderer** (`renderer="2d"`). A flat top-down view: `theme` and the cage are ignored (no-ops); a lens or
  pixel-ratio call records a `renderer-unsupported` disclosure. The 2D renderer has no 3D look to preset.

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
- **2D renderer.** A no-op that records a `renderer-unsupported` disclosure (feature `quality`). Stills
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

## Build your own (core)

`@chestnutlabs/gcode-preview-core` exposes the controller each of the four adapters wraps — mount it
on a canvas, drive parse/render, and subscribe to state. Reach for it when you want a bespoke UI (or
a framework we don't ship an adapter for) without reimplementing the pipeline.

> **Single source of truth.** Each package's own `README` on npm/GitHub is the canonical short
> reference for that adapter's exact API — this page is the cross-adapter tour. See, for example, the
> [Vue package README](https://github.com/ChestnutLabs/gcode-preview/tree/dev/packages/gcode-preview-vue).
> Deliberate per-framework differences (Web Component property-vs-attribute split and DOM-wrapped
> event details; Svelte's `.svelte` subpath) are noted in the package READMEs.
