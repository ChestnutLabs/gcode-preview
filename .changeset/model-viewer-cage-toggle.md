---
'@chestnutlabs/gcode-model-renderer': minor
'@chestnutlabs/gcode-preview-vue': minor
'@chestnutlabs/gcode-preview-react': minor
'@chestnutlabs/gcode-preview-svelte': minor
'@chestnutlabs/gcode-preview-element': minor
---

The model viewer can now hide the build-volume cage, like the toolpath viewer. Call
`controls.setBuildVolumeCage(false)`, pass `showVolumeCage: false` when you create it, or set
`showVolumeCage={false}` on the `/model` components (`show-volume-cage="false"` on `<gcode-model-viewer>`).
The plate, its grid and the contact shadow stay, and the model does not move. The setting is kept when
you change the bed, theme or plate scope. If you don't set it, nothing changes: the cage is drawn.
