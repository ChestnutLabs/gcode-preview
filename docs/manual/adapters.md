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
**View / camera** — `cameraMode` · `view` · `cameraState` · `frameContent` · `showVolumeCage`
**Rendering** — `quality` · `qualityMode` · `progressivePreview` · `interactionQuality` · `tube`
**Machine & progress** — `buildVolume` · `progress`

Each fires the same events (naming follows each framework's idiom): parse lifecycle
(`ready` / `parse-error` / `parse-cancelled` / `parse-progress`), staged preparation (`stage`),
`build-complete`, `quality-fallback`, camera settle (`camera-change`), machine geometry
(`machine-geometry-discovered` / `machine-geometry-mismatch`), `progress-presentation-changed`,
`disclosure`, and `error`.

Beyond the declarative props, the same **imperative surface** is reachable through the handle's
`controls` in every adapter — including render diagnostics (`getRenderStats`), segment picking /
source-mapping (`pickSegment`), the color-mode capability gate (`isColorModeAvailable`), and image
`capture`. Capability-aware state (`availableColorModes`, `hasRetractions`, `hasColorChanges`) lets
your UI offer and *explain* controls honestly rather than guessing.

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
