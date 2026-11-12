---
'@chestnutlabs/gcode-preview-react': minor
'@chestnutlabs/gcode-preview-vue': minor
'@chestnutlabs/gcode-preview-svelte': minor
'@chestnutlabs/gcode-preview-element': minor
'@chestnutlabs/gcode-preview-core': patch
---

The toolpath components now tell you when the renderer can't honour a setting (#520). Before, only the
lower-level `onEvent` received it.

- **New event:** React `onRendererUnsupported`, Vue `@renderer-unsupported`, Svelte `on:rendererunsupported`, and
  `renderer-unsupported` on `<gcode-preview>`. The payload is `{ feature, message }`; the names match the `/model`
  viewers.
- **When it fires:** on the 2D renderer (`renderer="2d"`), for a lens, pixel ratio, quality, camera mode, preset view,
  camera state, retraction markers, or a non-planar toolpath. It fires once per request, with no dedupe.
- **At mount:** on every adapter, `quality`, `cameraMode`, `cameraFov` or `pixelRatio` set to a non-default value
  fires it once. A default (`'auto'`, `'perspective'`, a 50-degree lens, no ratio) fires nothing, written out or not.
- **No extra 3D work at mount:** a 3D view no longer re-applies these props at mount, since it was built with them.
  Before, React and Svelte re-applied `quality`, which rebuilt the view when the parse finished before three.js
  loaded. React now builds the 3D view with `pixelRatio` too, like the other adapters, so under StrictMode the
  ratio set at mount reaches the live view.
- **Svelte:** `quality`, `cameraMode`, `cameraFov` and `pixelRatio` now apply only when their value changes.
- **Core `testing.ts`:** `ComponentHarness` callbacks gain an optional `onRendererUnsupported`, `MountedComponent`
  an optional `setCameraMode`, and `ComponentMountOptions` gains `cameraFov` and `pixelRatio`. Two conformance cases
  are new. A harness that doesn't wire the callback fails them with an explicit message.
