A worker-based, cross-vendor **G-code toolpath stack** for the browser: parse `.gcode` and
`.gcode.3mf` off the main thread, normalize them into a versioned intermediate representation
(**ToolpathIR**), and render an interactive Three.js preview — with first-class **Vue, React,
Svelte**, and **Web Component** adapters over one shared, framework-neutral engine.

This is the **SDK manual** (these Guide and Concept pages). The **generated
API reference** — every public export of all fourteen `@chestnutlabs/*` packages — is a companion site
linked from the **API reference** item in the top nav.

## Install

Install the adapter for your framework **plus `three`** (the renderer declares `three` as a
peer dependency; npm ≥ 7 installs it automatically, pnpm/yarn users add it explicitly):

```bash
npm install @chestnutlabs/gcode-preview-vue three     # or -react, -svelte, -element
```

Prefer no framework? Use the Web Component:

```bash
npm install @chestnutlabs/gcode-preview-element three
```

## 60-second example (Vue)

```vue
<script setup>
import { GcodePreview } from '@chestnutlabs/gcode-preview-vue';
import { shallowRef } from 'vue';
const file = shallowRef(null);
</script>

<template>
  <input type="file" accept=".gcode,.3mf" @change="file = $event.target.files?.[0] ?? null" />
  <div style="height: 70vh">
    <GcodePreview :source="file" @ready="(s) => console.log(`${s.segments} segments`)" />
  </div>
</template>
```

Every adapter ships the same defaulted `<GcodePreview>` surface — `source`, `parseOptions`,
`buildVolume`, `quality`, `colorMode`, `layerRange`, `scrub`, `showTravel`, `progress`,
`cameraMode`, `theme`, `createWorker` — plus a lower-level API (composable / hook / store / action)
for building your own controls. `<GcodePreview :source="file" />` is the whole thin path; the full
viewer is reachable without switching APIs.

## Which package do I need?

| You want… | Install |
|---|---|
| A drop-in viewer in **Vue / React / Svelte** | `@chestnutlabs/gcode-preview-{vue,react,svelte}` |
| A viewer with **no framework** | `@chestnutlabs/gcode-preview-element` |
| To build your own viewer on the shared controller | `@chestnutlabs/gcode-preview-core` |
| Just the **parser → IR** (no rendering) | `@chestnutlabs/gcode-parser` + `@chestnutlabs/toolpath-core` |
| A **headless still image** of a toolpath (server thumbnails) | `renderStill` from `@chestnutlabs/gcode-renderer-three` |
| A **presentation thumbnail of the source model** (STL / 3MF, not the toolpath) | `renderModelStill` from `@chestnutlabs/gcode-model-renderer` |

## Where to next

- **[Framework adapters](adapters.md)** — the component *and* the lower-level API for each framework.
- **[Recipes](recipes.md)** — custom workers, `.gcode.3mf` multi-plate, headless still render, live
  printer telemetry, multiple previews on one page.
- **Concepts** — [ToolpathIR & the capability model](concept-ir-capabilities.md),
  [Workers, streaming & performance](concept-workers.md),
  [Dialects & containers](concept-dialects-containers.md),
  [Live progress & motion model](concept-progress-motion.md).
- **API reference** — pick a package in the sidebar (`toolpath-core`, `gcode-parser`, …).

> **Status:** published — all fourteen `@chestnutlabs/*` packages are on npm (latest `v0.16.0`,
> lockstep-versioned with provenance). Governance and epic status live in the
> [repository docs](https://github.com/ChestnutLabs/gcode-preview/tree/dev/docs).
