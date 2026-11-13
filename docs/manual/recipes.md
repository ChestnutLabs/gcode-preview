---
title: Recipes
group: Guide
category: Guide
---

# Recipes

Task-focused snippets. All use the shared `<GcodePreview>` surface unless noted.

## Layer clipping & scrub

Clip to a layer range and scrub within it — no geometry rebuilds, just draw-range updates:

```tsx
<GcodePreview source={file} layerRange={[0, 73]} scrub={0.5} />
```

## Feature coloring, tubes, and orthographic view

```tsx
<GcodePreview source={file} quality="tubes" colorMode="feature" cameraMode="orthographic" />
```

`colorMode` is capability-gated — the stack colors by a feature only when the dialect actually
disclosed it (see [ToolpathIR & the capability model](concept-ir-capabilities.md)).

## Color by speed on a fixed scale

The speed, layer-height, and power modes fit their color ramp to each file. To compare files on
the same scale, pass a `range`:

```ts
controls.setColorMode({
  mode: 'feedrate',
  ramp: [
    [0, 0, 1], // blue = slow
    [1, 0, 0] // red = fast
  ],
  range: [600, 12000], // mm/min, ascending
  fallback: [0.7, 0.7, 0.7]
});
```

A `range` must be two finite numbers `>= 0` in ascending order. Anything else throws a `RangeError`
when you set the mode, and the previous mode stays in effect. For a reversed scale, reverse the
`ramp`. A point range such as `[1500, 1500]` is valid and draws every segment in the ramp's first
color. Moves with no speed in the file, or a negative one, are drawn in `fallback`. To check a mode
built from user input before you set it, call `checkColorMode(mode)` from `@chestnutlabs/gcode-colors`.

Every color in the mode is checked too: each `ramp` and `palette` entry and the `fallback` must be
`[r, g, b]` of three finite numbers. A `NaN` from a color picker, or a two-entry array, throws a
`RangeError` that names the field and its index, and the previous mode stays in effect. Each mode's
required fields are listed in the
[gcode-colors README](https://github.com/ChestnutLabs/gcode-preview/blob/dev/packages/gcode-colors/README.md#colours-that-throw).

## Camera control: preset views & saved state

The imperative `controls` handle (the composable return / React ref / Svelte `bind:this` / element
instance) exposes preset orientations and a serializable camera snapshot:

```ts
const { controls } = preview; // or handleRef.current, etc.

controls.setView('iso'); // 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso'
controls.frame(); // re-fit to the model bounds
controls.setCameraMode('orthographic'); // perspective ↔ ortho

// Persist "where the user was looking" and restore it later (e.g. a dashboard).
const view = controls.getCameraState(); // { position, target, zoom, cameraMode } | null
localStorage.setItem('view', JSON.stringify(view));
controls.setCameraState(view); // restores verbatim — no re-fit to the current model
```

`setView` snaps instantly (no animation) and preserves the active projection. `getCameraState`
returns `null` on the low-resource 2D renderer, which has no 3D pose — `setView`/`setCameraState`
there disclose via the `renderer-unsupported` event rather than fabricating one.

The same three are also **declarative props** on every adapter — a `view` prop (preset) and a
`cameraState` prop (restore) — paired with a **`camerachange`/`camera-change`** event that fires with
the new `CameraState` after a user orbits/pans/zooms. Together they form a two-way binding you can
persist:

```svelte
<GcodePreview {source} {view} bind:cameraState on:camerachange={(e) => save(e.detail)} />
```

## Capabilities & warnings on `ready`

The `ready` event (React `onReady`, Vue `@ready`, Svelte `on:ready`, element `ready`) carries
`capabilities` (the per-field `known | inferred | approximated | unavailable` map) and `warnings`
alongside `{ segments, layers, complete }` — so a consumer can gate its own UI (e.g. only offer a
color-by-power control when `capabilities.toolPower !== 'unavailable'`) without reaching for the raw
handle. A warning means part of the file was drawn differently from what it says, for example an arc
whose radius is too small for its endpoints; the arc and canned-cycle codes are listed in the
[motion coverage reference](../compatibility/gcode-motion-coverage.md#moves-drawn-differently-from-what-was-written).

## `.gcode.3mf` multi-plate

`.gcode.3mf` containers can hold several sliced plates. Select one with `parseOptions.plate`:

```tsx
<GcodePreview source={file} parseOptions={{ plate: 1 }} />
```

`parseOptions.plate` selects the plate **at parse time**. To *switch* plates after the first render,
start a fresh parse rather than only changing `parseOptions` — assign a new `source`, or call the
imperative `controls.parse(bytes, { plate: 1 })`. When the source is a `Uint8Array`, parsing
**transfers (empties) its buffer**, so re-parsing the same bytes needs a fresh copy — pass
`bytes.slice()`. (Re-parsing a now-empty buffer fails cleanly with `E_POST_FAILED`; it no longer
wedges the preview.)

## Show one plate of a multi-plate 3MF

A Bambu/Orca project 3MF can declare several plates. The model viewer reports them on `ready`
(`info.plates.list`, each with an `id`, optional `name`, and counts), and a **render scope** draws one plate alone.
Offer a selector only when the source declares plates:

```tsx
import { useState } from 'react';
import { ModelViewer } from '@chestnutlabs/gcode-preview-react/model';

function PlateViewer({ source }) {
  const [plates, setPlates] = useState([]);
  const [plateId, setPlateId] = useState(null); // null = every plate

  return (
    <>
      {plates.length > 0 && (
        <select value={plateId ?? 'all'} onChange={(e) => setPlateId(e.target.value === 'all' ? null : Number(e.target.value))}>
          <option value="all">All plates</option>
          {plates.map((p) => (
            <option key={p.id} value={p.id}>{p.name ?? `Plate ${p.id}`}</option>
          ))}
        </select>
      )}
      <ModelViewer
        source={source}
        buildVolume={{ x: 256, y: 256, z: 256 }}
        renderScope={plateId === null ? null : { plateId }}
        onReady={(info) => setPlates(info.plates?.list ?? [])}
      />
    </>
  );
}
```

The same scope is `controls.setRenderScope({ plateId })` on any adapter, and `renderScope` on `renderModelStill`.
Other scopes are `{ objectIds }` and `{ instanceFilter }`. Three things to know:

- A source with no declared plates (an STL, a CAD 3MF) has no `info.plates`; `{ plateId }` on such a source matches nothing and renders an empty scene, so gate the selector on `info.plates`.
- The camera re-fits to the selected plate. With a `buildVolume`, each selection also reports its own `placement` (for a project made for your bed, i.e. its printable area matches `buildVolume`: `known` for plate 1, `inferred` for a later plate whose parts sit one workspace cell over; otherwise `approximated`, centred on your plate); with every plate in scope there is no single bed, so `placement` is `null` and no plate is drawn. See [Studio look and build plate](guide-looks-lens-plate.md).
- Reloading a different source: clear or reset the scope first, because a plate id from the previous file selects nothing in the next one.

The Feature Lab's Prepare mode has this selector, on a synthetic two-plate project.

## A custom worker (slim build, other bundlers, strict CSP)

By default the adapters create a *batteries* worker (every dialect adapter + `.gcode.3mf`) via the
bundler-native `new Worker(new URL(...))` pattern. Pass `createWorker` to supply your own — a slim
build, custom dialects, or a CSP-friendly setup:

```tsx
<GcodePreview source={file} createWorker={() => new Worker(new URL('./my-worker.js', import.meta.url), { type: 'module' })} />
```

## Live printer telemetry

Feed a normalized `ProgressObservation` and the preview maps it onto the toolpath with honest,
tiered confidence — a precise marker when the source position is known, an uncertainty band when it
is approximate, and user scrub always winning. See
[Live progress & motion model](concept-progress-motion.md) and the
[progress signal contract](https://github.com/ChestnutLabs/gcode-preview/blob/dev/docs/reference/progress-signal-contract.md).

```tsx
<GcodePreview source={file} progress={observation} />
```

## Headless still image (server-side thumbnails)

`renderStill` from `@chestnutlabs/gcode-preview-core` produces a single non-interactive image from
a Worker `OffscreenCanvas`, an Electron hidden window, or headless Chromium — no interactive viewer
required. See the
[still-render reference](https://github.com/ChestnutLabs/gcode-preview/blob/dev/docs/reference/still-render.md).

## Several previews on one page

Mount multiple `<GcodePreview>` instances — each owns its own worker and renderer. See the
[multi-gcode note](https://github.com/ChestnutLabs/gcode-preview/blob/dev/docs/reference/multi-gcode-previews.md)
for the current guidance and its trade-offs.
