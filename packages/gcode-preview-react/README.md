# @chestnutlabs/gcode-preview-react

Thin React integration for the Chestnut Labs G-code viewer — a reactivity bridge over
`@chestnutlabs/gcode-preview-core` with **capability parity** to the Vue and Svelte adapters
(same engine, same state model, same TypeScript contracts; DD-007 D1 amendment).

```sh
npm install @chestnutlabs/gcode-preview-react three
```

(`three` is a peerDependency of the renderer, supported range `^0.178.0` — npm ≥ 7 installs
it automatically; pnpm/yarn users add it explicitly. See the
[support policy](https://github.com/ChestnutLabs/gcode-preview/blob/dev/docs/reference/support-policy.md).)

## Ready-to-use component

```tsx
import { GcodePreview } from '@chestnutlabs/gcode-preview-react';

function Viewer({ file }: { file: File | null }) {
  return (
    <div style={{ height: '70vh' }}>
      <GcodePreview source={file} onReady={(s) => console.log(`${s.segments} segments`)} />
    </div>
  );
}
```

That is a complete viewer (StrictMode-safe). The full surface is ~24 optional props with sensible
defaults — `source`, `parseOptions`, `buildVolume` (consumer-wins bed precedence), `quality` /
`qualityMode`, `colorMode`, `theme`, `cameraMode` / `view` / `frameContent`, `layerRange`, `scrub`,
`showTravel` / `showRetractions` / `showWipe` / `showCut` (CNC/laser cutting moves, default on), `hiddenFeatureRoles` (hide feature roles like Skirt or
Brim; gate on `capabilities.featureRoles`), `progress` (DD-006 observation), `createWorker` — with
matching callbacks (`onReady`, `onCameraChange`, `onParseError`, `onParseCancelled`,
`onParseProgress`, `onStage`, `onBuildComplete`, `onQualityFallback`,
`onMachineGeometryMismatch`/`Discovered`, `onProgressPresentationChanged`, `onDisclosure`,
`onRendererUnsupported`, `onError`). The full handle is reachable via `ref`; its `controls` reach the imperative surface —
`getRenderStats()` (render diagnostics), `pickSegment(ndcX, ndcY, threshold?)` (source-mapping /
picking), `isColorModeAvailable(mode)`, and `capture(opts?)` (image `Blob`, also `handle.capture`).
The handle `state` carries capability-aware UI data (`availableColorModes`, `hasRetractions`,
`hasColorChanges`).

## Headless hook (build your own controls)

```tsx
import { useGcodePreview } from '@chestnutlabs/gcode-preview-react';

function CustomViewer() {
  const preview = useGcodePreview();
  // <canvas ref={preview.canvasRef} /> — bind; unmount disposes automatically
  // await preview.parse(bytes); preview.controls.setScrubPosition(n);
  // preview.observeProgress(obs); preview.state (useSyncExternalStore-subscribed)
  return <canvas ref={preview.canvasRef} style={{ width: '100%', height: '100%' }} />;
}
```

Invalid numbers throw a `RangeError`, and a control the renderer rejects surfaces as an `error` with code `E_CONTROL_REJECTED`; both are described in [Adapters](../../docs/manual/adapters.md).

## Workers

The batteries default (all dialect adapters + `.gcode.3mf`) needs zero setup under Vite; pass
`createWorker` for the slim build, custom adapters, other bundlers, or strict CSP. See the
`@chestnutlabs/gcode-preview-vue` README for the shared worker documentation — the options are
identical across adapters by design.

## Model viewing (Prepare side)

The `/model` subpath ships a `<ModelViewer>` — the **Prepare**-side counterpart to `<GcodePreview>`.
Where `<GcodePreview>` draws the toolpath (how a print runs), `<ModelViewer>` draws the **source
model** (an `.stl` / `.3mf` mesh) — the object before slicing.

```tsx
import { ModelViewer } from '@chestnutlabs/gcode-preview-react/model';

function ModelPreview({ bytes }: { bytes: Uint8Array }) {
  return (
    <div style={{ height: '70vh' }}>
      <ModelViewer
        source={{ kind: '3mf', bytes }}
        onReady={(info) => console.log(info.objectCount, info.materials)}
      />
    </div>
  );
}
```

`onReady(info)` carries the honest material-colour tier: `info.materials` is `'known'` /
`'approximated'` when the file declared colours the render used, and `'unavailable'` when it declared
none (a neutral default was drawn, never faked). The declarative props, callbacks, and the
`useModelViewer` hook mirror the toolpath component. See
[`docs/manual/adapters.md`](../../docs/manual/adapters.md) "Two viewers: Preview and Prepare" for the
cross-adapter tour, and `tools/example-react/model.html` for a runnable minimal page.

## Look, lens and plate (opt-in)

`<GcodePreview>` and `<ModelViewer>` both take `theme` and `cameraFov`; `<ModelViewer>` also takes
`buildVolume`. The Studio look is an opt-in preset: set nothing and the viewers render as before.

```tsx
import { GcodePreview } from '@chestnutlabs/gcode-preview-react';
import { ModelViewer } from '@chestnutlabs/gcode-preview-react/model';
import { studioTheme, STUDIO_CAMERA_FOV } from '@chestnutlabs/gcode-renderer-three';

const theme = studioTheme('dark'); // module scope (or useMemo): a new object each render re-applies it

<GcodePreview source={file} theme={theme} cameraFov={STUDIO_CAMERA_FOV} showVolumeCage={false} />;
<ModelViewer source={model} buildVolume={{ x: 256, y: 256, z: 256 }} theme={theme} showVolumeCage={false} />;
```

`<ModelViewer>` takes `showVolumeCage` too (default `true`; `false` drops only the wireframe and keeps the plate, grid
and shadow), and `controls.setBuildVolumeCage(visible)` changes it live.

`cameraFov` takes 10-120 degrees (the default is 50) and throws `RangeError` outside it. The model viewer reports
`placement` (`known` / `inferred` / `approximated`, or `null` with no plate) and `placementOffset` in `onReady` and its state.
The 2D renderer ignores `theme`; a lens, as a prop or a call, fires `onRendererUnsupported` once. See the [Studio look and build plate guide](https://github.com/ChestnutLabs/gcode-preview/blob/dev/docs/manual/guide-looks-lens-plate.md).

### Pixel ratio

Both components take an opt-in `pixelRatio`: a number in (0, 4], or `'device'` for `min(devicePixelRatio, 2)`, followed
live. Anything else throws `RangeError`. Unset, the renderer keeps its own ratio. Ratio 2 shades four times the
fragments of ratio 1, so prefer `'device'` on pages with one viewer. Imperatively: `controls.setPixelRatio(ratio)`.

```tsx
<GcodePreview source={file} pixelRatio="device" />;
<ModelViewer source={model} pixelRatio={1.5} />;
```

An unsized `controls.capture()` is the resting drawing-buffer size when unset and the CSS size when set; with the
built-in renderer a ratio never changes the default capture size, so pass `width`/`height` for a crisper image. The 2D
renderer ignores it and fires `onRendererUnsupported` once.

## Examples

`tools/example-react` in the repository is a Vite app with two tiers, both driving this published
package (no raw renderer or parser imports):

- **`minimal.html`** — the smallest real integration: `<GcodePreview source>` plus a fixture picker
  and a layer slider. One short file to copy when getting started.
- **`showcase.html`** — the full declarative surface: capability-gated color modes (a mode greys out
  with a plain-language reason when the file can't support it), declarative `hiddenFeatureRoles`,
  camera, and `getRenderStats()`/`pickSegment()` diagnostics through the `ref` handle. Uses the
  `useGcodePreview` hook for render-subscribed reactive state.

Run it with `npm install --prefix tools/example-react && npm run dev --prefix tools/example-react`
(port 5201).
