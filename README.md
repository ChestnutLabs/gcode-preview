# Chestnut Labs G-code Preview

A worker-based, cross-vendor **G-code toolpath stack** for the browser: parse `.gcode`,
`.gcode.3mf`, and Prusa binary `.bgcode` off the main thread, normalize them into a versioned
intermediate representation (`ToolpathIR`), and render an interactive Three.js (or low-resource
Canvas 2D) preview — with first-class **Vue, React, and Svelte** integrations that are thin adapters
over one shared, framework-neutral engine.

> **Status: published.** Thirteen `@chestnutlabs/*` packages are on npm (latest **`v0.3.0`**,
> lockstep-versioned with npm provenance). E0–E11 of the
> [master plan](docs/00_PROJECT_MASTER_PLAN.md) are closed; `v0.3.0` adds the low-resource Canvas 2D
> renderer, expanded color modes, wipe/seam visibility, time-based scrub, and binary G-code
> (`.bgcode`) decode. Install from npm — see *Quick start* below.

![3DBenchy rendered as tubes with feature coloring in the showcase viewer](docs/media/viewer-benchy-tubes.png)

## What you get

- **Off-thread parsing** — a Web Worker session (`GcodeParseSession`) with streaming input,
  progressive preview for large files, resource limits, and an adversarial-input corpus behind it.
- **Cross-vendor dialect handling** — PrusaSlicer, OrcaSlicer/Bambu Studio, Cura, Klipper, Marlin,
  and RepRap-flavor annotations (features, objects, bed geometry, thumbnails, multi-tool), each
  claim capability-tagged as `known | inferred | approximated | unavailable` — the stack refuses to
  fabricate what it cannot know.
- **`.gcode.3mf` container support** — zero-dependency, bounded ZIP extraction with multi-plate
  selection, hardened against adversarial archives.
- **Binary G-code (`.bgcode`) decode** — Prusa's binary container (heatshrink / DEFLATE / MeatPack
  codecs) decoded to plain G-code through the same pipeline, byte-for-byte equivalent to the
  `.gcode` original.
- **A versioned neutral IR** (`ToolpathIR`) — structure-of-arrays geometry + metadata + source
  index; the seam between parsing and everything else.
- **A Three.js renderer** — layer chunks with decimation disclosure, layer-range clip and
  segment-level scrub, tube or line geometry with automatic quality fallback, per-file build
  plates, WebGL context-loss recovery.
- **A low-resource Canvas 2D renderer** — an optional `renderer: '2d'` layer view for constrained
  environments, with adjacent "ghost" layers and its own progress mapping (no WebGL required).
- **Rich toolpath coloring** — by feature type, move speed, object, per-layer height, or (for
  non-extrusion) tool power and cut-vs-rapid, plus toggleable wipe/seam moves; time-based scrub with a
  print-time estimate; and a source-line ↔ segment debugger mapping.
- **Non-extrusion toolpaths — CNC / laser / plotter** *(experimental)* — cut/burn/draw moves classified
  as `Cut`, a modal `toolPower` (laser power / spindle RPM) channel, canned drilling-cycle expansion
  (`G81`/`G82`/`G83`), and controller recognition (GRBL laser/mill, LinuxCNC) — all honesty-**tiered**:
  reported `inferred` until confirmed on real hardware, never fabricated.
- **Honest live progress** (for printer telemetry) — a normalized `ProgressObservation` contract
  mapped onto the toolpath with tiered confidence: a precise cut + marker when the source position
  is known, an uncertainty band when it is approximated, stale-signal handling, and user scrub
  always winning.
- **Three equal framework adapters** — each ships a ready-to-use `<GcodePreview>` component *and*
  a lower-level surface, with the same capabilities, options, events, and TypeScript contracts,
  enforced by a shared behavioral suite that runs against all three in CI.

| Honest live progress | Layer clipping & scrub |
|---|---|
| ![Live-progress overlay: the completed portion rendered in full color, the remaining path as a translucent ghost, and an orange marker at the byte-exact print position](docs/media/live-progress-overlay.png) | ![3DBenchy clipped to layer 73 of 174, exposing perimeters and infill with feature coloring](docs/media/layer-clip-benchy.png) |
| Completed cut + translucent remaining-path ghost + byte-exact position marker (uncertainty band when the signal is approximate) | Draw-range layer clipping — no geometry rebuilds; segment-level scrub works the same way |

## Packages

| Package | What it is |
|---|---|
| [`@chestnutlabs/toolpath-core`](packages/toolpath-core) | `ToolpathIR`, capability model, progress mapping |
| [`@chestnutlabs/gcode-parser`](packages/gcode-parser) | Worker parse core + session client (streaming, limits, workers) |
| [`@chestnutlabs/gcode-dialects`](packages/gcode-dialects) | Slicer/firmware dialect annotators |
| [`@chestnutlabs/gcode-containers`](packages/gcode-containers) | `.gcode.3mf` / ZIP container adapters |
| [`@chestnutlabs/gcode-bgcode`](packages/gcode-bgcode) | Prusa binary G-code (`.bgcode`) decode container adapter |
| [`@chestnutlabs/gcode-renderer-three`](packages/gcode-renderer-three) | Three.js toolpath renderer (peer: `three`) |
| [`@chestnutlabs/gcode-renderer-2d`](packages/gcode-renderer-2d) | Low-resource Canvas 2D layer renderer (no WebGL) |
| [`@chestnutlabs/gcode-colors`](packages/gcode-colors) | Shared color models (feature / speed / object / layer-height) |
| [`@chestnutlabs/gcode-preview-core`](packages/gcode-preview-core) | Framework-neutral preview controller + portable behavioral suite |
| [`@chestnutlabs/gcode-preview-vue`](packages/gcode-preview-vue) | Vue 3 component + `useGcodePreview()` composable |
| [`@chestnutlabs/gcode-preview-react`](packages/gcode-preview-react) | React component + `useGcodePreview()` hook |
| [`@chestnutlabs/gcode-preview-svelte`](packages/gcode-preview-svelte) | Svelte component + `createGcodePreview()` store/action |
| [`@chestnutlabs/gcode-preview-element`](packages/gcode-preview-element) | Framework-free `<gcode-preview>` Web Component (no peer framework) |

## Quick start

Install the adapter for your framework **plus `three`** (the renderer declares `three` as a
peerDependency, range `^0.178.0` — npm ≥ 7 installs it automatically; pnpm/yarn users add it
explicitly):

```sh
npm install @chestnutlabs/gcode-preview-vue three     # or -react / -svelte
```

Each adapter has two adoption levels — a complete component, and a lower-level API for building
your own controls (composable / hook / store) — documented in its package README.

### Vue

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

Lower level: [`useGcodePreview()`](packages/gcode-preview-vue/README.md) — canvas ref, worker
parse, controls, reactive state summaries.

### React

```tsx
import { GcodePreview } from '@chestnutlabs/gcode-preview-react';

function Viewer({ file }) {
  return (
    <div style={{ height: '70vh' }}>
      <GcodePreview source={file} onReady={(s) => console.log(`${s.segments} segments`)} />
    </div>
  );
}
```

StrictMode-safe. Lower level: [`useGcodePreview()`](packages/gcode-preview-react/README.md)
(`useSyncExternalStore`-backed state, identity-stable handle).

### Svelte

```svelte
<script>
  import GcodePreview from '@chestnutlabs/gcode-preview-svelte/GcodePreview.svelte';
  let file = null;
</script>

<div style="height: 70vh">
  <GcodePreview source={file} on:ready={(e) => console.log(`${e.detail.segments} segments`)} />
</div>
```

Ships as raw `.svelte` (your bundler's Svelte plugin compiles it). Lower level:
[`createGcodePreview()`](packages/gcode-preview-svelte/README.md) — store contract +
`use:` canvas action.

All three components share the same defaulted prop surface — `source`, `parseOptions`,
`buildVolume`, `quality`, `colorMode`, `layerRange`, `scrub`, `showTravel`, `progress`,
`createWorker` — with matching events/callbacks. `<GcodePreview source={file} />` is the whole
thin path; the full viewer is reachable without switching APIs.

## Workers: batteries included, escape hatch provided

- **Default (zero setup):** the adapters create the *batteries* worker — every supported dialect
  adapter plus `.gcode.3mf` support — via the bundler-native `new Worker(new URL(...))` pattern.
  Vite resolves it out of the box (tested in CI).
- **Custom:** pass `createWorker` for the slim build, custom dialect adapters, other bundlers, or
  strict-CSP environments. Both paths are documented in the
  [Vue package README](packages/gcode-preview-vue/README.md) (shared across adapters by design).

## Format, dialect & capability support

- **Formats:** `.gcode` (plain), `.gcode.3mf` (sliced-plate container; multi-plate via
  `parseOptions.plate`).
- **Dialects:** PrusaSlicer, OrcaSlicer/Bambu, Cura, Klipper, Marlin, RepRap-flavor — see the
  evidence-dated [compatibility matrix](docs/compatibility/dialects-and-containers.md).
- **Motion commands:** which position-affecting G/M-codes are honored — absolute/relative
  positioning (`G90`/`G91`), extruder mode (`M82`/`M83`), and the `G92` E-datum are modeled
  (E10 phase 1); arc planes (`G17`–`G19`) and work-coordinate systems are still in progress — see
  [G-code motion coverage](docs/compatibility/gcode-motion-coverage.md).
- **Build volume:** per-file discovered bed geometry with consumer-wins precedence (your
  configured plate is never silently overridden; discovery is emitted instead).
- **Live progress:** the normalized [progress signal contract](docs/reference/progress-signal-contract.md)
  plus [consumer notes](docs/reference/progress-consumer-notes.md) for wiring real printer
  telemetry (Moonraker, Bambu, OctoPrint-class sources).
- **Support & deprecation policy:** [Node/browser/framework matrix and the rolling support
  window](docs/reference/support-policy.md).
- **Headless still render:** [`renderStill`](docs/reference/still-render.md) — a single
  non-interactive image from a Worker `OffscreenCanvas`, Electron hidden window, or headless
  Chromium (server-side thumbnails).

## See it running

- `tools/demo` — the showcase: full control panel over the whole pipeline (corpus picker,
  dialect annotations, quality/color modes, layer clip + scrub, simulated live-progress tiers),
  plus a Vue-component parity page and the visual-regression harness. `npm run dev` inside the
  directory.
- `tools/example-react`, `tools/example-svelte` — complete Vite apps per framework, run the same
  way. All three apps consume the packages exactly as an external consumer would.

## Project status & governance

Docs-first: every architecture-sensitive epic passes a Design Document gate before
implementation. The [master plan](docs/00_PROJECT_MASTER_PLAN.md) controls direction; the
[docs index](docs/README.md) tracks epic status; accepted designs live in
[`docs/design/`](docs/design). Current state: E0–E9 closed and accepted (parser, dialects,
containers, renderer, live progress, multi-framework integration, the `v0.1.0` release, and
`v0.2.0`'s toolpath annotations + renderer options); E10 (motion-model correctness) is in
progress — its phase 1 (`M82`/`M83`, `G90`/`G91`, the `G92` E-datum) has shipped, with arc
planes and coordinate systems to follow.

Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md) ·
security policy: [SECURITY.md](SECURITY.md).

## Development

```sh
# Node >= 22
npm ci
npm run build            # inherited engine build (rollup)
npm run test             # root suite (IR goldens, manifest validation, adapters)
npm run test:packages    # all workspace package suites
npm run lint && npm run typeCheck && npm run license:check
npm run test:consumer-vue   # tarball consumer fixture
npm run pack:check       # packaged-artifact gate (pack snapshots + publint + attw)
```

## Origin & attribution

This project began as a fork of
[`xyz-tools/gcode-preview`](https://github.com/xyz-tools/gcode-preview) (project identity
`remcoder/gcode-preview`) by Remco Veldkamp and contributors, MIT-licensed. Chestnut Labs has
since rebuilt it into the worker-based multi-package stack described above; the inherited Git
history is preserved, upstream copyright notices are retained in [`LICENSE`](LICENSE), and the
full attribution and provenance record lives in [`NOTICE.md`](NOTICE.md),
[`docs/UPSTREAM_PROVENANCE.md`](docs/UPSTREAM_PROVENANCE.md), and the
[upstream & licensing policy](docs/03_UPSTREAM_FORK_LICENSE_AND_CONTRIBUTION_POLICY.md).
Upstream changes are adopted deliberately through review, never auto-synced.

## License

[MIT](LICENSE) — inherited code © 2017–2025 Remco Veldkamp and the `xyz-tools/gcode-preview`
contributors; Chestnut Labs additions © 2026 Chestnut Labs.
