---
'@chestnutlabs/gcode-preview-core': patch
'@chestnutlabs/gcode-preview-react': patch
'@chestnutlabs/gcode-preview-vue': patch
'@chestnutlabs/gcode-preview-svelte': patch
'@chestnutlabs/gcode-preview-element': patch
---

The `scrub`, `scrubTime` and `layerRange` props now keep applying across mount and source changes.

- **A `scrub` prop set at mount now cuts the view.** In Vue, React and Svelte, `<GcodePreview scrub={1}>` with no
  `scrubTime` showed the whole toolpath: the unset `scrubTime` was sent as a clear at mount and replaced the cut.
  An unset prop now sends nothing. Changing a prop from a number to `null` still clears the cut.
- **A `scrub`, `scrubTime` or `layerRange` prop now also applies to the next file when `source` changes.** It used
  to show the new file uncut while the prop still held its value. This holds on all four adapters (the
  `<gcode-preview>` `source` property included). A range or cut you set from a `ready` handler for the new file
  still wins, so a consumer that resets its range to the new file's layer count on `ready` ends on that range.
- **When both `scrub` and `scrubTime` hold a value, `scrubTime` wins** at mount, and on a source change that leaves
  both props as they were, as it already did on `<gcode-preview>`. A prop that changes in the same update as `source`
  is applied last, so it wins: changing `scrub` together with `source` cuts the new file at the new `scrub`, even
  while `scrubTime` still holds its value.
- **A `parse()` started from a `parse-complete` (`ready`) handler now owns a cut made right after it in the
  same handler.** The cut used to reach the file that was finishing and was lost when the new one loaded.
