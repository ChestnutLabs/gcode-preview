---
"@chestnutlabs/gcode-model-renderer": minor
"@chestnutlabs/gcode-preview-vue": minor
"@chestnutlabs/gcode-preview-react": minor
"@chestnutlabs/gcode-preview-svelte": minor
"@chestnutlabs/gcode-preview-element": minor
---

Make interactive **source-model viewing** (STL / 3MF) a first-class, declarative half of the SDK —
the Prepare side alongside the toolpath Preview side — so consumers no longer have to drop to the
imperative `createModelViewer` engine to show a model in a framework (DD-031).

**New framework-neutral controller** (`@chestnutlabs/gcode-model-renderer`):

- `createModelPreviewController(options)` — the Prepare-side analogue of `gcode-preview-core`'s toolpath
  controller. It wraps the existing `createModelViewer` engine unchanged and adds what a framework
  binding needs: canvas-deferred construction with `bindCanvas` (rebuilding on a canvas swap and
  replaying the last source), a reactive `getState()`/`onStateChange()` snapshot derived from the
  engine's events (`ModelPreviewState`: `loading`/`ready`/`rendererSupported`/`objectCount`/`materials`/
  `instancedCount`/`decimationApplied`/`bounds`/`plates`/`hasPlates`/`cameraState`/`progress`/`error`),
  and an op queue for calls made before the canvas binds. `ModelPreviewControls` exposes `setSource`,
  `setView`, get/`setCameraState`, `setBackground`, `setInteractionQuality`, `setRenderScope`, `frame`,
  `resize`, and `capture`.
- A portable model behavioral suite ships via the `@chestnutlabs/gcode-model-renderer/testing` subpath
  (`runModelBehavioralSuite`) with controls/state completeness parity guards.

**New `/model` adapter subpath on every framework** — thin shells over the one controller, mirroring
each framework's toolpath idiom:

- `@chestnutlabs/gcode-preview-react/model` — `useModelViewer` hook + `<ModelViewer>` component.
- `@chestnutlabs/gcode-preview-vue/model` — `useModelViewer` composable + `<ModelViewer>` component.
- `@chestnutlabs/gcode-preview-svelte/model` — `createModelViewer` store/action + the raw
  `@chestnutlabs/gcode-preview-svelte/model/ModelViewer.svelte` component.
- `@chestnutlabs/gcode-preview-element/model` (+ `/model/define`) — the `<gcode-model-viewer>` custom
  element (tag chosen to avoid the reserved `<model-viewer>`).

All additive — the toolpath surface is unchanged, and toolpath-only consumers don't pull the model
renderer (it lives behind the opt-in `/model` subpath). Every adapter passes the portable model
behavioral suite; each package gains `@chestnutlabs/gcode-model-renderer` as a dependency.
