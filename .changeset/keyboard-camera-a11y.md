---
"@chestnutlabs/gcode-renderer-three": patch
"@chestnutlabs/gcode-preview-vue": patch
"@chestnutlabs/gcode-preview-react": patch
"@chestnutlabs/gcode-preview-svelte": patch
"@chestnutlabs/gcode-preview-element": patch
---

Keyboard-operable camera for embedded viewers (DD-004 a11y) (#275/M4)

The embedded adapter canvases had `aria-label` but no `tabindex`, so they weren't focusable, and the
renderer never enabled OrbitControls key events — only the standalone demo page was keyboard-usable.
Now every adapter canvas is focusable (`tabindex="0"`) and the renderer enables OrbitControls keyboard
events scoped to the canvas (arrow keys pan the view when it's focused, without hijacking the page's
arrow keys). Keyboard operability is satisfied for embedders, not just the demo.
