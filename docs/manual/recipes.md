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

## `.gcode.3mf` multi-plate

`.gcode.3mf` containers can hold several sliced plates. Select one with `parseOptions.plate`:

```tsx
<GcodePreview source={file} parseOptions={{ plate: 1 }} />
```

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

`renderStill` from `@chestnutlabs/gcode-renderer-three` produces a single non-interactive image from
a Worker `OffscreenCanvas`, an Electron hidden window, or headless Chromium — no interactive viewer
required. See the
[still-render reference](https://github.com/ChestnutLabs/gcode-preview/blob/dev/docs/reference/still-render.md).

## Several previews on one page

Mount multiple `<GcodePreview>` instances — each owns its own worker and renderer. See the
[multi-gcode note](https://github.com/ChestnutLabs/gcode-preview/blob/dev/docs/reference/multi-gcode-previews.md)
for the current guidance and its trade-offs.
