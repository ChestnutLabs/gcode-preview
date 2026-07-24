---
'@chestnutlabs/gcode-renderer-three': minor
'@chestnutlabs/gcode-preview-core': minor
'@chestnutlabs/gcode-preview-vue': minor
'@chestnutlabs/gcode-preview-react': minor
'@chestnutlabs/gcode-preview-svelte': minor
---

Add an orthographic camera option (E9 phase 2, #150, DD-009 D3).

The renderer now carries both a perspective and an orthographic camera and switches between them with
`setCameraMode('perspective' | 'orthographic')`, surfaced as a `cameraMode` renderer/controller option
(default `'perspective'`), a `cameraMode` prop on the Vue, React, and Svelte adapters, and a
`renderStill` option. Toggling preserves the view direction, target, and apparent framing — the
orthographic frustum is sized to the same half-height the perspective view frames — and OrbitControls
follows the active camera. Orthographic (parallel) projection suits dimensional/technical inspection.
