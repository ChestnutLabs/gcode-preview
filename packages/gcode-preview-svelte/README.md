# @chestnutlabs/gcode-preview-svelte

Thin Svelte integration for the Chestnut Labs G-code viewer — a reactivity bridge over
`@chestnutlabs/gcode-preview-core` with **capability parity** to the Vue and React adapters
(same engine, same state model, same TypeScript contracts; DD-007 D1 amendment).

```sh
npm install @chestnutlabs/gcode-preview-svelte three
```

(`three` is a peerDependency of the renderer, supported range `^0.178.0` — npm ≥ 7 installs
it automatically; pnpm/yarn users add it explicitly. See the
[support policy](https://github.com/ChestnutLabs/gcode-preview/blob/dev/docs/reference/support-policy.md).)

## Ready-to-use component

```svelte
<script>
  import GcodePreview from '@chestnutlabs/gcode-preview-svelte/GcodePreview.svelte';
  let file = null;
</script>

<div style="height: 70vh">
  <GcodePreview source={file} on:ready={(e) => console.log(`${e.detail.segments} segments`)} />
</div>
```

That is a complete viewer. The component ships from the `/GcodePreview.svelte` subpath as a **raw
`.svelte` file** (standard Svelte library packaging — your bundler's svelte plugin compiles it via
the `svelte` export condition), not from the package index. The ~24-prop defaulted surface covers
`source`, `parseOptions`, `buildVolume` (consumer-wins bed precedence), `quality` / `qualityMode`,
`colorMode`, `theme`, `cameraMode` / `view` / `frameContent`, `layerRange`, `scrub`, `showTravel` /
`showRetractions` / `showWipe`, `hiddenFeatureRoles` (hide feature roles like Skirt or Brim; gate on
`capabilities.featureRoles`), `progress` (DD-006 observation), and `createWorker`. Events (13):
`ready`, `camerachange`, `parseerror`, `parsecancelled`, `parseprogress`, `stage`, `buildcomplete`,
`qualityfallback`, `machinegeometrymismatch`/`discovered`, `progresspresentationchanged`,
`disclosure`, `error`. The full handle is exported as `preview` (`bind:this` then `.preview`); its
`controls` reach the imperative surface — `getRenderStats()` (render diagnostics),
`pickSegment(ndcX, ndcY, threshold?)` (source-mapping / picking), `isColorModeAvailable(mode)`, and
`capture(opts?)` (image `Blob`, also `preview.capture`). The handle `state` carries capability-aware
UI data (`availableColorModes`, `hasRetractions`, `hasColorChanges`).

## Store/action API (build your own controls)

```svelte
<script>
  import { createGcodePreview } from '@chestnutlabs/gcode-preview-svelte';
  import { onDestroy } from 'svelte';

  const preview = createGcodePreview();
  onDestroy(() => preview.dispose());
  // $state store: const state = preview.state;  →  {$state.summary?.segments}
  // await preview.parse(bytes); preview.controls.setScrubPosition(n);
  // preview.observeProgress(obs); preview.raw.renderer()
</script>

<canvas use:preview.canvas style="width: 100%; height: 100%" />
```

`preview.state` follows the Svelte store contract (immediate emission + every snapshot after),
so `$`-prefix auto-subscription works. Headless (non-component) users call `dispose()` themselves.

## Workers

Batteries default (all dialect adapters + `.gcode.3mf`) needs zero setup under Vite; pass
`createWorker` for the slim build, custom adapters, other bundlers, or strict CSP — options are
identical across all three framework adapters by design (see the Vue README for the shared worker
documentation).

## Example

`tools/example-svelte` in the repository is a complete Vite + Svelte app (corpus load,
layer/scrub, simulated live progress) compiling the raw component through the export condition.
