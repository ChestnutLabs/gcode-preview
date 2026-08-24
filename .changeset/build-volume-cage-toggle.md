---
"@chestnutlabs/gcode-renderer-three": minor
"@chestnutlabs/gcode-preview-core": minor
"@chestnutlabs/gcode-preview-vue": minor
"@chestnutlabs/gcode-preview-react": minor
"@chestnutlabs/gcode-preview-svelte": minor
"@chestnutlabs/gcode-preview-element": minor
---

Decouple the build-volume **wireframe cage** from the bed/plate (#306 item 6). The cage (the box up to
the volume height) is now independently toggleable: a new `controls.setBuildVolumeCage(visible)` and a
`showVolumeCage` prop across all four adapters (`show-volume-cage` attribute on the element), plus a
`BuildVolumeStyle.showCage` option. Default `true` (unchanged look); set `false` to show only the
printable bed/plate without the whole machine-volume cage. The 2D renderer treats it as a documented
no-op. Toggling flips the named `volumeCage` object in place (no geometry rebuild).
