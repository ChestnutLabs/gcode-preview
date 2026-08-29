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

## Try the examples

Each adapter ships a runnable Vite example in the repository with **two tiers**, both driving the
real published package (never a raw renderer or parser):

| Adapter | Example | Port |
| --- | --- | --- |
| Vue | `tools/example-vue` | 5203 |
| React | `tools/example-react` | 5201 |
| Svelte | `tools/example-svelte` | 5202 |
| Web Component | `tools/example-webcomponent` | 5204 |

Every one has a **`minimal.html`** — the smallest real integration you'd copy to get started — and a
**`showcase.html`** — the full capability-aware surface (color modes that grey out with a reason when
a file can't support them, declarative feature-role hiding, and `getRenderStats()`/`pickSegment()`
diagnostics through the handle). Run one with, e.g.,
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
or `element.controls.*` for the imperative surface. Works in any page or framework.

## Build your own (core)

`@chestnutlabs/gcode-preview-core` exposes the controller each of the four adapters wraps — mount it
on a canvas, drive parse/render, and subscribe to state. Reach for it when you want a bespoke UI (or
a framework we don't ship an adapter for) without reimplementing the pipeline.

> **Single source of truth.** Each package's own `README` on npm/GitHub is the canonical short
> reference for that adapter's exact API — this page is the cross-adapter tour. See, for example, the
> [Vue package README](https://github.com/ChestnutLabs/gcode-preview/tree/dev/packages/gcode-preview-vue).
> Deliberate per-framework differences (Web Component property-vs-attribute split and DOM-wrapped
> event details; Svelte's `.svelte` subpath) are noted in the package READMEs.
