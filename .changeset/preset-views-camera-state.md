---
"@chestnutlabs/gcode-renderer-three": minor
"@chestnutlabs/gcode-preview-core": minor
"@chestnutlabs/gcode-preview-vue": minor
"@chestnutlabs/gcode-preview-react": minor
"@chestnutlabs/gcode-preview-svelte": minor
"@chestnutlabs/gcode-preview-element": minor
---

Preset camera views + serializable camera state (#268)

Adds three imperative camera methods, threaded from the renderer through `PreviewRenderer` and the
`controls` handle into all four adapters:

- `setView(view)` — snap to a preset orientation (`top`/`bottom`/`front`/`back`/`left`/`right`/`iso`),
  instant, preserving the active projection.
- `getCameraState()` — read the current camera as a serializable `CameraState`
  (`{ position, target, zoom, cameraMode }`, scene coordinates); a stable contract a dashboard can
  persist.
- `setCameraState(state)` — restore a snapshot verbatim (no re-fit to the current model).

New public types `CameraView` and `CameraState`. No new dependency, no IR/schema change, no animation
(snapping is instant). The low-resource 2D renderer has no 3D pose, so it honors these as documented
disclosures (`getCameraState()` → `null`; `setView`/`setCameraState` → `renderer-unsupported`) rather
than fabricating a pose. Covered across all four adapters by the portable behavioral suite.
