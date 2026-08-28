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
`showTravel` / `showRetractions` / `showWipe`, `hiddenFeatureRoles` (hide feature roles like Skirt or
Brim; gate on `capabilities.featureRoles`), `progress` (DD-006 observation), `createWorker` — with
matching callbacks (`onReady`, `onCameraChange`, `onParseError`, `onParseCancelled`,
`onParseProgress`, `onStage`, `onBuildComplete`, `onQualityFallback`,
`onMachineGeometryMismatch`/`Discovered`, `onProgressPresentationChanged`, `onDisclosure`,
`onError`). The full handle is reachable via `ref`; its `controls` reach the imperative surface —
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

## Workers

The batteries default (all dialect adapters + `.gcode.3mf`) needs zero setup under Vite; pass
`createWorker` for the slim build, custom adapters, other bundlers, or strict CSP. See the
`@chestnutlabs/gcode-preview-vue` README for the shared worker documentation — the options are
identical across adapters by design.

## Example

`tools/example-react` in the repository is a complete Vite + React app (corpus load, layer/scrub,
simulated live progress) running under `<StrictMode>`.
