---
'@chestnutlabs/gcode-preview-element': patch
---

`<gcode-preview>`: assigning the same `source` value again no longer re-parses, matching the React, Vue and Svelte adapters. To reload the same bytes, assign a new array or call `parse()`.
