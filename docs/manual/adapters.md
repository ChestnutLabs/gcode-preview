---
title: Framework adapters
group: Guide
category: Guide
---

# Framework adapters

Every adapter is a thin shell over the framework-neutral **`@chestnutlabs/gcode-preview-core`**
controller, so they share the same capabilities, options, events, and TypeScript contracts —
enforced by a portable behavioral suite that runs against all of them in CI. Each has **two
adoption levels**: a complete `<GcodePreview>` component, and a lower-level API for building your
own controls.

The shared prop surface — identical across adapters:

`source` · `parseOptions` · `buildVolume` · `quality` · `colorMode` · `layerRange` · `scrub` ·
`showTravel` · `progress` · `cameraMode` · `theme` · `createWorker`

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
controls, and reactive state summaries.

## React

```tsx
import { GcodePreview } from '@chestnutlabs/gcode-preview-react';

function Viewer({ file }) {
  return <GcodePreview source={file} quality="tubes" onReady={(s) => console.log(s.segments)} />;
}
```

StrictMode-safe. Lower level: **`useGcodePreview()`** — `useSyncExternalStore`-backed state with an
identity-stable handle.

## Svelte

```svelte
<script>
  import GcodePreview from '@chestnutlabs/gcode-preview-svelte/GcodePreview.svelte';
</script>
<GcodePreview source={file} on:ready={(e) => console.log(e.detail.segments)} />
```

Ships as raw `.svelte` (your bundler's Svelte plugin compiles it). Lower level:
**`createGcodePreview()`** — a store contract plus a `use:` canvas action.

## Web Component (no framework)

```html
<script type="module">
  import '@chestnutlabs/gcode-preview-element';
</script>
<gcode-preview quality="tubes" color-mode="feature"></gcode-preview>
```

Set `.source` (a `File`/`Blob`/string) as a property; listen for the `ready` event. Works in any
page or framework.

## Build your own (core)

`@chestnutlabs/gcode-preview-core` exposes the controller each adapter wraps — mount it on a canvas,
drive parse/render, and subscribe to state. Reach for it when you want a bespoke UI without
reimplementing the pipeline.

> **Single source of truth.** Each package's own `README` on npm/GitHub is the canonical short
> reference for that adapter's exact API — this page is the cross-adapter tour. See, for example, the
> [Vue package README](https://github.com/ChestnutLabs/gcode-preview/tree/dev/packages/gcode-preview-vue).
