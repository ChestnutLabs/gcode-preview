---
"@chestnutlabs/toolpath-core": minor
"@chestnutlabs/gcode-parser": minor
"@chestnutlabs/gcode-renderer-three": minor
"@chestnutlabs/gcode-preview-core": minor
"@chestnutlabs/gcode-preview-vue": minor
"@chestnutlabs/gcode-preview-react": minor
"@chestnutlabs/gcode-preview-svelte": minor
"@chestnutlabs/gcode-preview-element": minor
---

Frame-to-content: frame the printed **object**, not the skirt/prime (#306 item 6). New
`ToolpathIR.objectBounds` (extrusion of labeled objects only, `segments.object != 0`; empty when the
file has no object labels) and a `frameContent: 'object' | 'all'` option threaded through the renderer
(`setFrameContent`), `renderStill`, and all four adapters (`show-`-style `frame-content` attribute on the
element). Default `'all'` (unchanged framing). `'object'` frames only the printed objects so a prime
line or skirt at the bed edge no longer shrinks the object in view; when the file carries no object
labels it discloses (an `E_FRAME_CONTENT_UNAVAILABLE` event) and frames all extrusion — never fabricated.

Note: `frameContent: 'object'` engages only when the parser populated the `objects` capability (M486 /
EXCLUDE_OBJECT / `; printing object`). Broadening object-label detection for more slicer/firmware
variants is tracked separately.
