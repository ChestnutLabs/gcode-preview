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

## Model viewing (Prepare side)

The `/model` subpath ships a `<ModelViewer>` — the **Prepare**-side counterpart to `<GcodePreview>`.
Where `<GcodePreview>` draws the toolpath (how a print runs), `<ModelViewer>` draws the **source
model** (an `.stl` / `.3mf` mesh) — the object before slicing.

```svelte
<script>
  import ModelViewer from '@chestnutlabs/gcode-preview-svelte/model/ModelViewer.svelte';
  export let bytes;
</script>

<div style="height: 70vh">
  <ModelViewer
    source={{ kind: '3mf', bytes }}
    on:ready={(e) => console.log(e.detail.objectCount, e.detail.materials)}
  />
</div>
```

`on:ready` (detail-wrapped, like the other Svelte events) carries the honest material-colour tier:
`e.detail.materials` is `'known'` / `'approximated'` when the file declared colours the render used,
and `'unavailable'` when it declared none (a neutral default, never faked). The `createModelViewer`
store handle mirrors the toolpath component. See
[`docs/manual/adapters.md`](../../docs/manual/adapters.md) "Two viewers: Preview and Prepare" for the
cross-adapter tour, and `tools/example-svelte/model.html` for a runnable minimal page.

## Examples

`tools/example-svelte` in the repository is a Vite app with two tiers, both driving this published
package through the `.svelte` export condition (no raw renderer or parser imports):

- **`minimal.html`** — the smallest real integration: `<GcodePreview {source}>` plus a fixture
  picker and a layer slider. One short component to copy when getting started.
- **`showcase.html`** — the full declarative surface: capability-gated color modes (a mode greys out
  with a plain-language reason when the file can't support it), declarative `hiddenFeatureRoles`,
  camera, and `getRenderStats()`/`pickSegment()` diagnostics through the `bind:this` handle
  (`viewer.preview.controls`); the handle's store-contract `state` supplies the reactive UI data.

Run it with `npm install --prefix tools/example-svelte && npm run dev --prefix tools/example-svelte`
(port 5202).
