# @chestnutlabs/gcode-preview-element

A framework-free **`<gcode-preview>` Web Component** for the Chestnut Labs G-code viewer — a thin
custom-element shell over [`@chestnutlabs/gcode-preview-core`](../gcode-preview-core/README.md), the same engine
the Vue/React/Svelte adapters wrap. Use it from plain HTML, Angular, or any framework — **no peer
framework dependency**.

## Install

```sh
npm install @chestnutlabs/gcode-preview-element three
```

`three` is a peer dependency of the underlying renderer.

## Usage

```html
<script type="module">
  import '@chestnutlabs/gcode-preview-element/define'; // registers <gcode-preview>

  const el = document.querySelector('gcode-preview');
  el.addEventListener('ready', (e) => console.log('parsed', e.detail));
  document.querySelector('input[type=file]').addEventListener('change', (ev) => {
    el.source = ev.target.files[0]; // a File / Uint8Array / ArrayBuffer
  });
</script>

<gcode-preview quality="tubes" show-travel="false" style="width: 100%; height: 70vh"></gcode-preview>
```

Prefer explicit registration? Import the function instead of the side-effectful entry:

```js
import { defineGcodePreview } from '@chestnutlabs/gcode-preview-element';
defineGcodePreview(); // idempotent; defaults to the <gcode-preview> tag
```

## Surface

Scalar options are **attributes** (also settable as properties); rich options are **properties**.

| Attribute | Property | Type | Default |
|---|---|---|---|
| `quality` | `quality` | `'auto' \| 'lines' \| 'tubes'` | `'auto'` |
| `renderer` | `renderer` | `'3d' \| '2d'` — **construction-time** | `'3d'` |
| `adjacent-layers` | `adjacentLayers` | integer (2D ghost layers) — **construction-time** | — |
| `camera-mode` | `cameraMode` | `'perspective' \| 'orthographic'` | `'perspective'` |
| `show-travel` | `showTravel` | `"true" \| "false"` | `true` |
| `show-retractions` | `showRetractions` | `"true" \| "false"` | `false` |
| `scrub` | `scrub` | integer | — (all) |
| `layer-range` | `layerRange` | `"start,end"` / `[number, number]` | — (all) |
| `hidden-feature-roles` | `hiddenFeatureRoles` | `"6,7"` / `number[]` — hide roles (Skirt, Brim…) | — |
| — | `source` | `Uint8Array \| ArrayBuffer \| File` | `null` |
| — | `colorMode` | `ColorMode` | — |
| — | `theme` | `Theme` | — |
| — | `tube` | `TubeOptions` — **construction-time** | — |
| — | `buildVolume` | `BuildVolumeDef \| MachineGeometry` | — |
| — | `progress` | `ProgressObservation \| null` | `null` |
| — | `createWorker` | `() => WorkerLike` | batteries default |

> `source` is a **property only** (never a URL attribute) — the element does not fetch.
> `colorMode`, `theme`, `tube`, and `buildVolume` are **property-only** because objects can't be HTML
> attributes — set them as JS properties. `hidden-feature-roles` gates on `capabilities.featureRoles`
> (declarative form of `controls.setFeatureRoleVisible`). This is a ~24-option surface; the rest of
> the declarative props (`qualityMode`, `view`, `cameraState`, `frameContent`, `scrubTime`,
> `showWipe`, `showVolumeCage`, `interactionQuality`, `parseOptions`, `rendererOptions`, `layerRange`)
> are set the same way.

### DOM events (`CustomEvent`, kebab-case `detail`)

`ready` · `camerachange` · `parse-error` · `parse-cancelled` · `parse-progress` · `stage` ·
`build-complete` · `disclosure` · `quality-fallback` · `progress-presentation-changed` ·
`machine-geometry-discovered` · `machine-geometry-mismatch` · `error`.

A few event `detail`s are DOM-wrapped, an accepted custom-element idiom: `disclosure` detail is
`{ text }`, `machine-geometry-discovered` is `{ machine }`, and `machine-geometry-mismatch` is
`{ message }`.

The underlying handle is also exposed as instance members (`state`, `controls`, `raw`, `onEvent`,
`parse`, `observeProgress`, `tickProgress`, `clearProgress`, `capture`) for advanced use — the same
neutral controller surface the other adapters expose. `controls` reaches the imperative extras —
`getRenderStats()` (render diagnostics), `pickSegment(ndcX, ndcY, threshold?)` (source-mapping /
picking), and `isColorModeAvailable(mode)`; `capture(opts?)` (image `Blob`) is both a top-level
method and `controls.capture`. The handle `state` carries capability-aware UI data
(`availableColorModes`, `hasRetractions`, `hasColorChanges`).

## Model viewing (Prepare side)

The `/model/define` entry registers `<gcode-model-viewer>` — the **Prepare**-side counterpart to
`<gcode-preview>` (the tag deliberately avoids the reserved `<model-viewer>`). Where `<gcode-preview>`
draws the toolpath (how a print runs), `<gcode-model-viewer>` draws the **source model** (an `.stl` /
`.3mf` mesh) — the object before slicing.

```html
<script type="module">
  import '@chestnutlabs/gcode-preview-element/model/define'; // registers <gcode-model-viewer>

  const el = document.querySelector('gcode-model-viewer');
  el.addEventListener('ready', (e) => console.log(e.detail.objectCount, e.detail.materials));
  el.source = { kind: '3mf', bytes }; // rich options are properties; primitives are attributes
</script>

<gcode-model-viewer background="transparent" style="width: 100%; height: 70vh"></gcode-model-viewer>
```

The `ready` event carries the honest material-colour tier: `e.detail.materials` is `'known'` /
`'approximated'` when the file declared colours the render used, and `'unavailable'` when it declared
none (a neutral default, never faked). The same attribute/property split as `<gcode-preview>` applies —
rich options (`.source`, `.cameraState`, `.renderScope`, …) are properties; primitives (`view`,
`background`, `camera-mode`) are attributes. See
[`docs/manual/adapters.md`](../../docs/manual/adapters.md) "Two viewers: Preview and Prepare" for the
cross-adapter tour, and `tools/example-webcomponent/model.html` for a runnable minimal page.

## Look, lens and plate (opt-in)

`<gcode-preview>` and `<gcode-model-viewer>` both take the lens as an **attribute**, `camera-fov`, with a matching
`cameraFov` property. `theme` is a **property** on both, and `buildVolume` a property on `<gcode-model-viewer>`
(objects can't be attributes). The Studio look is an opt-in preset: set nothing and the viewers render as before.

```html
<gcode-preview camera-fov="32" show-volume-cage="false"></gcode-preview>
<gcode-model-viewer camera-fov="32" show-volume-cage="false"></gcode-model-viewer>
<script type="module">
  import { studioTheme } from '@chestnutlabs/gcode-renderer-three';
  document.querySelector('gcode-preview').theme = studioTheme('dark');
  const model = document.querySelector('gcode-model-viewer');
  model.theme = studioTheme('dark');
  model.buildVolume = { x: 256, y: 256, z: 256 };
</script>
```

`<gcode-model-viewer>` has the cage attribute too: `show-volume-cage` (absent or anything but `"false"` = cage on) with a
matching `showVolumeCage` property, and `controls.setBuildVolumeCage(visible)`. Off drops only the wireframe; the plate,
grid and shadow stay.

`camera-fov` takes 10-120 degrees (the default is 50). **An invalid attribute value (non-numeric or outside that
range) is ignored and the last valid lens is kept; setting the `cameraFov` property to an invalid value throws
`RangeError`.** `<gcode-model-viewer>` reports `placement` (`known` / `inferred` / `approximated`, or `null` with no plate)
and `placementOffset` in the `ready` event detail and its state. The 2D renderer ignores `theme`; a lens call records a
`renderer-unsupported` disclosure.
See the [Studio look and build plate guide](https://github.com/ChestnutLabs/gcode-preview/blob/dev/docs/manual/guide-looks-lens-plate.md).

### Pixel ratio

Both elements take an opt-in **`pixel-ratio` attribute** with a matching `pixelRatio` property: a number in (0, 4], or
`device` for `min(devicePixelRatio, 2)`, followed live. Unset, the renderer keeps its own ratio. Ratio 2 shades four
times the fragments of ratio 1, so prefer `device` on pages with one viewer.

```html
<gcode-preview pixel-ratio="device"></gcode-preview>
<gcode-model-viewer pixel-ratio="1.5"></gcode-model-viewer>
```

**An invalid attribute value is ignored and the last valid ratio kept; setting the `pixelRatio` property to an invalid
value throws `RangeError`.** The property getter returns the last valid ratio (`<gcode-preview>`: the effective ratio,
or `null` if none was set; `<gcode-model-viewer>`: `undefined` if none). Imperatively: `controls.setPixelRatio(ratio)`.
An unsized `controls.capture()` is the resting drawing-buffer size when unset and the CSS size when set; with the
built-in renderer a ratio never changes the default capture size, so pass `width`/`height` for a crisper image. The 2D
renderer ignores it and records a `renderer-unsupported` disclosure.

## Examples

`tools/example-webcomponent` in the repository is a framework-free Vite app with two tiers, both
driving this published element (no raw renderer or parser imports):

- **`minimal.html`** — the smallest real integration: import `/define` to register `<gcode-preview>`,
  set the `source` property, listen for `ready`; the layer slider drives the `layer-range` attribute.
  Shows the attribute/property split in ~40 lines.
- **`showcase.html`** — the full surface in vanilla JS: objects (`source`, `colorMode`,
  `hiddenFeatureRoles`) set as properties, primitives (`layer-range`, `view`) as attributes;
  capability-gated color modes; `getRenderStats()`/`pickSegment()` diagnostics via `element.controls`.

Run it with `npm install --prefix tools/example-webcomponent && npm run dev --prefix
tools/example-webcomponent` (port 5204).

## Workers

By default the batteries worker parses off-thread. To supply a custom/slim worker, set the
`createWorker` factory property (see the [Vue README](../gcode-preview-vue/README.md) for the shared worker
notes). The element passes the same behavioral parity suite as the Vue/React/Svelte adapters.
