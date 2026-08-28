# @chestnutlabs/gcode-preview-vue

Thin Vue 3 integration for the Chestnut Labs G-code viewer: parse `.gcode` / `.gcode.3mf` off the
main thread, render an interactive Three.js toolpath (layers, scrub, per-file build plates, honest
live progress), and never block your UI. This package is glue only — the engine lives in
`@chestnutlabs/gcode-parser`, `@chestnutlabs/gcode-renderer-three`, and
`@chestnutlabs/toolpath-core` (design: DD-007).

```sh
npm install @chestnutlabs/gcode-preview-vue three
```

(`three` is a peerDependency of the renderer, supported range `^0.178.0` — npm ≥ 7 installs it
automatically; pnpm/yarn users add it explicitly. See the
[support policy](https://github.com/ChestnutLabs/gcode-preview/blob/dev/docs/reference/support-policy.md).)

Two adoption levels, one implementation (the component is a shell over the composable):

## Ready-to-use component

```vue
<script setup lang="ts">
import { GcodePreview } from '@chestnutlabs/gcode-preview-vue';
import { shallowRef } from 'vue';

const file = shallowRef<File | null>(null);
</script>

<template>
  <input type="file" accept=".gcode,.3mf" @change="file = ($event.target as HTMLInputElement).files?.[0] ?? null" />
  <div style="height: 70vh">
    <GcodePreview :source="file" @ready="(s) => console.log(`${s.segments} segments`)" />
  </div>
</template>
```

That is a complete viewer. The full surface is ~24 optional props with sensible defaults — the
frequently reached-for ones:

| Prop | Purpose |
|---|---|
| `source` | `Uint8Array \| ArrayBuffer \| File` — changing it re-parses |
| `parse-options` | wire options (limits, dialects, containers, plate selection) |
| `renderer` | `'3d'` (Three.js) or `'2d'` (Canvas fallback) — construction-time |
| `build-volume` | consumer-configured plate — wins over file-discovered geometry; discovery is then emitted, not applied |
| `quality` / `quality-mode` | `'auto' \| 'lines' \| 'tubes'`; render-quality budget (`'full' \| 'adaptive' \| 'fast'`) |
| `color-mode` | single / by-tool / by-feature (feature coloring is capability-gated — check `state.availableColorModes` or listen for `error`) |
| `theme` | viewer theme (background, bed, toolpath palette) |
| `camera-mode` / `view` / `camera-state` / `frame-content` | perspective/orthographic, named view, saved camera, framing target |
| `layer-range` / `scrub` / `scrub-time` | clipping / time-based scrub controls |
| `show-travel` / `show-wipe` / `show-retractions` / `show-volume-cage` | move-class and overlay visibility toggles |
| `hidden-feature-roles` | hide feature roles (e.g. Skirt, Brim) — declarative form of `controls.setFeatureRoleVisible`; gate on `capabilities.featureRoles` |
| `progress` | a DD-006 `ProgressObservation` — drives the honest live-progress overlay (marker for byte-exact, uncertainty band for approximate, gray when stale) |
| `create-worker` | worker factory escape hatch (see below) |

Emits (13): `ready`, `camera-change`, `parse-error`, `parse-cancelled`, `parse-progress`, `stage`,
`build-complete`, `quality-fallback`, `machine-geometry-mismatch`, `machine-geometry-discovered`,
`progress-presentation-changed`, `disclosure`, `error`. The underlying handle is exposed for
template refs (`ref.preview`); its `controls` reach the imperative surface — `getRenderStats()`
(render diagnostics), `pickSegment(ndcX, ndcY, threshold?)` (source-mapping / picking),
`isColorModeAvailable(mode)`, and `capture(opts?)` (image `Blob`, also `handle.capture`). The handle
`state` carries capability-aware UI data (`availableColorModes`, `hasRetractions`, `hasColorChanges`).

## Headless composable (build your own controls)

```ts
import { useGcodePreview } from '@chestnutlabs/gcode-preview-vue';

const preview = useGcodePreview();          // in setup(); auto-disposes with the scope
// bind: <canvas :ref="(el) => (preview.canvasRef.value = el as HTMLCanvasElement)" />
await preview.parse(bytes);                 // worker parse + progressive preview
preview.controls.setLayerRange(0, 42);      // scrub / colors / quality / bed / frame ...
preview.observeProgress(obs);               // DD-006 live progress (tick ~1 Hz for staleness)
preview.state;                              // shallow read-only reactive summaries
preview.raw.session; preview.raw.renderer();// escape hatches (non-reactive)
```

The composable owns the sharp edges: dispose-on-unmount/HMR, SSR-import safety, canvas resize
(ResizeObserver + fallback), and a strict reactivity boundary (toolpath buffers are never proxied).

## Workers: default and custom (both first-class)

**Default (zero setup):** the batteries worker — all supported slicer/firmware dialect adapters
plus `.gcode.3mf` container support — is created automatically via the bundler-native
`new Worker(new URL(...))` pattern. Vite resolves this out of the box (this path is exercised by
the repo's Vite demo and consumer fixture).

**Custom (smaller builds / custom adapters / strict CSP / other bundlers):**

```ts
useGcodePreview({
  createWorker: () => new Worker(new URL('@chestnutlabs/gcode-parser/dist/worker-slim.js', import.meta.url), { type: 'module' })
});
// or your own worker built with createWorkerHandler(...) — see the parser package docs
```

Linked-workspace development note: Vite consumers using `file:` links should add every
`@chestnutlabs/*` package the worker pulls in to `optimizeDeps.exclude` (installed tarballs/registry
packages need no configuration).

## Capability honesty

Everything the engine reports as `inferred`/`approximated`/`unavailable` stays that way at this
layer: feature coloring refuses rather than fabricates, live progress shows a band instead of a
fake-precise marker, and decimation is disclosed via the `disclosure` emit — surface it.

## Support

`.gcode` (Marlin/Klipper/RepRap-flavor; PrusaSlicer, Orca/Bambu, Cura annotations),
`.gcode.3mf` (sliced-plate export; multi-plate via `parse-options.plate`), per-file build plates,
multi-tool/AMS color, object exclusion, arcs. See the repository's
`docs/compatibility/dialects-and-containers.md` for the evidence-dated matrix and
`docs/reference/progress-signal-contract.md` for the live-progress contract.
