---
"@chestnutlabs/gcode-preview-vue": minor
"@chestnutlabs/gcode-preview-react": minor
"@chestnutlabs/gcode-preview-svelte": minor
"@chestnutlabs/gcode-preview-element": minor
---

feat(adapters): surface the staged-progress `stage` event (DD-029 Phase A)

All four framework adapters now forward the DD-029 `stage` event with identical semantics: Vue `@stage`,
React `onStage`, Svelte `dispatch('stage')`, Element `stage` CustomEvent — each carrying
`{ stage, progress?, detail? }` (`building-geometry` carries a real fraction + `{built,total}`). A
consumer can render honest `parsing → classifying → building-geometry → preparing-gpu → ready` status
without framework-specific hacks. Additive; existing events unchanged.
