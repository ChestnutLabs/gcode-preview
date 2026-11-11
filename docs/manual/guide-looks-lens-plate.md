---
title: Studio look and build plate
group: Guide
category: Guide
---

# Studio look and build plate

The SDK ships a **Studio look**: a gradient backdrop, a solid build plate with a labelled grid and outline, a soft
contact shadow, and a longer 32° lens. It is an **opt-in preset**. If you set no `theme`, the viewer renders exactly
as it always has (transparent background, 50° lens); the preset changes nothing until you ask for it.

![The Feature Lab on the Studio dark look: a 3DBenchy colored by feature role on a build plate under a dark gradient backdrop](https://chestnutlabs.github.io/gcode-preview/media/app-control-panel.png)

*The [Feature Lab](https://chestnutlabs.github.io/gcode-preview/demos/feature-lab/index.html) starts on Studio dark. It is a demo choice; pick "SDK default (no theme)" in Appearance to see the default look.*

## Opt in

```tsx
import { GcodePreview } from '@chestnutlabs/gcode-preview-react';
import { studioTheme, STUDIO_CAMERA_FOV } from '@chestnutlabs/gcode-renderer-three';

<GcodePreview source={file} theme={studioTheme('dark')} cameraFov={STUDIO_CAMERA_FOV} showVolumeCage={false} />;
```

`studioTheme('dark' | 'light')` returns an ordinary `Theme`, and `STUDIO_CAMERA_FOV` is `32`. Both are exported by
`@chestnutlabs/gcode-renderer-three`, `@chestnutlabs/gcode-preview-core` and `@chestnutlabs/gcode-model-renderer`. The preset was measured with the
build-volume cage **off**, so turn it off with it (`showVolumeCage={false}`); the cage is a separate control, not a `Theme` field.

| Look | Backdrop | Plate and grid |
| --- | --- | --- |
| `studioTheme('dark')` | dark grey gradient | solid mid-grey plate, white 10 mm grid with stronger 50 mm lines and an outline |
| `studioTheme('light')` | pale grey gradient | the same plate, dark grid lines |

![The same 3DBenchy on the Studio light look](https://chestnutlabs.github.io/gcode-preview/media/app-studio-light.png)

## Camera lens

`cameraFov` (degrees, perspective only) takes `10`–`120`. The SDK default is `50`; `STUDIO_CAMERA_FOV` is `32`.
A value outside the range throws a `RangeError` rather than being clamped. Framing is lens-aware, so the model
stays in view at every lens, and changing the lens on a live viewer keeps the apparent size for lenses up to 50° (a wider lens pulls back
slightly so the model still fits). A lens set while the
camera is orthographic is remembered and applied when you return to perspective.

![The same model at the SDK default 50° lens and the Studio 32° lens](https://chestnutlabs.github.io/gcode-preview/media/app-lens-compare.png)

Imperatively: `controls.setCameraFov(deg)`. On the Web Component the lens is the `camera-fov` attribute: an invalid
value is ignored and the last valid lens is kept, while setting the `cameraFov` **property** to an invalid value
throws. The 2D renderer is a flat top-down view, so the lens, the `theme` and the cage do not apply to it (a
deliberate difference between the renderers, not a gap).

## Build plate in the model viewer

The Prepare-side `<ModelViewer>` (the `/model` subpath of each adapter) takes the same `theme` and `cameraFov`, plus
a `buildVolume` that draws a plate under the part:

```tsx
import { ModelViewer } from '@chestnutlabs/gcode-preview-react/model';

<ModelViewer source={source} buildVolume={{ x: 256, y: 256, z: 256 }} theme={studioTheme('dark')} />;
```

The model viewer applies only the plate and backdrop part of a theme (`background`, the grid and outline fields,
`bedSurface`, `contactShadow`). Its lights are not themed, so a model is lit the same with or without a theme.

### Where the part sits: `placement`

A file's coordinates do not always say where a part sits on a plate, so the viewer reports how it decided, with
the project's usual honesty tiers. `ready` (`info.placement`, `info.placementOffset`) and the live state carry both:

| `placement` | When | What is drawn |
| --- | --- | --- |
| `known` | A Bambu/Orca slicer project made for your bed (its printable area matches `buildVolume` within 1 mm on every edge) whose parts lie on the bed (within 1 mm) | The parts where the file puts them |
| `inferred` | A Bambu/Orca project made for your bed whose parts are off the bed by whole workspace cells (a later plate of a multi-plate project) | The parts with that offset subtracted |
| `approximated` | Anything else: STL, CAD 3MF, PrusaSlicer 3MF, or a slicer project made for a different bed | The parts centred on the plate, dropped to z = 0 |
| `null` | No `buildVolume`, or the render scope spans more than one declared plate | No plate |

`placementOffset` is the `{ x, y, z }` shift in millimetres that was applied, so you can map file coordinates to
what is drawn. It is presentation only: the scene and `bounds` stay as authored. The viewer frames the **part**, not
the plate, so a small part on a large plate fills the view; dolly out to see the plate.

![A single block on a 256 mm build plate, plate two of a synthetic two-plate project, with the placement line reading inferred](https://chestnutlabs.github.io/gcode-preview/media/app-prepare-plate.png)

*Synthetic two-plate project generated for the demo (not a slicer export): plate 2 is selected with a render scope and reads `inferred` with an x offset of -307.2 mm.*

To show one plate of a multi-plate file, see the [plate selection recipe](recipes.md#show-one-plate-of-a-multi-plate-3mf).

### Transparent cutouts

`theme.background` beats the `background` prop, so after `setTheme` with a Studio theme the `background` prop has no
visible effect until the theme's background is cleared. For a transparent cutout, omit it:

```ts
const cutout = { ...studioTheme('dark'), background: null }; // plate and shadow, no backdrop
```

`controls.capture({ background })` beats everything, and `capture({ includeBuildVolume: false })` hides the plate and its
shadow for that capture.

## Try it

The Feature Lab has a **Look** selector and a **Lens** slider on both Preview and Prepare, and a plate selector in
Prepare. The four framework showcases ([React](https://chestnutlabs.github.io/gcode-preview/demos/react/showcase.html),
[Vue](https://chestnutlabs.github.io/gcode-preview/demos/vue/showcase.html),
[Svelte](https://chestnutlabs.github.io/gcode-preview/demos/svelte/showcase.html),
[Web Component](https://chestnutlabs.github.io/gcode-preview/demos/webcomponent/showcase.html)) offer the same look and lens.
