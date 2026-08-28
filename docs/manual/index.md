<div class="gp-hero">
  <div class="gp-hero-copy">
    <p class="gp-tagline">Show a 3D print or CNC/laser job in the browser — before, during, or after it runs.</p>
    <p>Drop <code>.gcode</code>, <code>.gcode.3mf</code>, or Prusa <code>.bgcode</code> into a page and get an interactive toolpath: orbit it, clip to a layer, scrub it, color by feature or speed, overlay live progress. Parsing runs off the main thread, so a 250&nbsp;MB file never freezes the UI — with <strong>Vue, React, Svelte</strong>, and <strong>Web&nbsp;Component</strong> adapters over one engine.</p>
    <div class="gp-actions">
      <a class="gp-btn gp-btn-primary" href="#install">Get started</a>
      <a class="gp-btn" href="https://chestnutlabs.github.io/gcode-preview/documents/Feature_gallery.html">Feature gallery</a>
      <a class="gp-btn" href="https://chestnutlabs.github.io/gcode-preview/api/">API reference</a>
      <a class="gp-btn" href="https://github.com/ChestnutLabs/gcode-preview">GitHub</a>
    </div>
  </div>
  <div class="gp-hero-media">
    <img src="https://chestnutlabs.github.io/gcode-preview/media/viewer-benchy-tubes.png" alt="3DBenchy rendered as extrusion tubes with per-feature coloring on a neutral grey build plate">
  </div>
</div>

<ul class="gp-cards">
  <li class="gp-card">
    <img src="https://chestnutlabs.github.io/gcode-preview/media/layer-clip-benchy.png" alt="">
    <div class="gp-card-body"><h3><a href="https://chestnutlabs.github.io/gcode-preview/documents/Feature_gallery.html">Toolpath inspection</a></h3><p>Layer clip, segment &amp; time scrub, travel / retraction / seam markers, source-line mapping.</p></div>
  </li>
  <li class="gp-card">
    <img src="https://chestnutlabs.github.io/gcode-preview/media/color-speed-calicat.png" alt="">
    <div class="gp-card-body"><h3><a href="https://chestnutlabs.github.io/gcode-preview/documents/Feature_gallery.html">Coloring &amp; analysis</a></h3><p>Color by speed, feature, object, tool, layer height, color change, or tool power.</p></div>
  </li>
  <li class="gp-card">
    <img src="https://chestnutlabs.github.io/gcode-preview/media/progress-known.png" alt="">
    <div class="gp-card-body"><h3><a href="https://chestnutlabs.github.io/gcode-preview/documents/Live_progress___motion_model.html">Live job progress</a></h3><p>Map printer telemetry onto the path at the confidence it deserves — exact, band, or stale.</p></div>
  </li>
  <li class="gp-card">
    <img src="https://chestnutlabs.github.io/gcode-preview/media/model-render-stl-3mf.png" alt="">
    <div class="gp-card-body"><h3><a href="https://chestnutlabs.github.io/gcode-preview/documents/Feature_gallery.html">Models &amp; plates</a></h3><p>Present the source STL / 3MF — multi-object, per-plate, colored materials — a second renderer.</p></div>
  </li>
  <li class="gp-card">
    <img src="https://chestnutlabs.github.io/gcode-preview/media/parametric-bolt-circle.png" alt="">
    <div class="gp-card-body"><h3><a href="https://chestnutlabs.github.io/gcode-preview/documents/Parametric_programs_(RS274NGC).html">CNC, laser &amp; parametric</a></h3><p>Cut vs rapid, tool power, canned cycles, and RS274NGC programs the machine <em>computes</em>.</p></div>
  </li>
  <li class="gp-card">
    <img src="https://chestnutlabs.github.io/gcode-preview/media/bed-circular.png" alt="">
    <div class="gp-card-body"><h3><a href="https://chestnutlabs.github.io/gcode-preview/documents/Feature_gallery.html">Any build surface</a></h3><p>Rectangular, circular / delta, and polygonal beds — outline and grid follow the real shape.</p></div>
  </li>
</ul>

These Guide and Concept pages are the **SDK manual**. The generated
**[API reference](https://chestnutlabs.github.io/gcode-preview/api/)** — every public export of all
fourteen `@chestnutlabs/*` packages — is a companion site linked from the top nav. New here? Jump to
the **[feature gallery](feature-gallery.md)** to browse the breadth, or start below.

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
  [Live progress & motion model](concept-progress-motion.md),
  [Parametric programs (RS274NGC)](concept-parametric-programs.md).
- **API reference** — pick a package in the sidebar (`toolpath-core`, `gcode-parser`, …).

> **Status:** published — all fourteen `@chestnutlabs/*` packages are on npm (latest `v0.19.0`,
> lockstep-versioned with provenance). Governance and epic status live in the
> [repository docs](https://github.com/ChestnutLabs/gcode-preview/tree/dev/docs).
