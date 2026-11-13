---
'@chestnutlabs/gcode-preview-svelte': patch
---

`<GcodePreview>` (Svelte): setting `source` to the same value again no longer re-parses, matching the React, Vue
and Web Component adapters. Svelte counts an object prop as changed whenever it is set, so a parent that spreads
props (`{...props}`) or sets `source={file}` again used to reload the file. To reload the same bytes, pass a new
array or call `parse()`. Setting `source` to `null` and back still parses again.
