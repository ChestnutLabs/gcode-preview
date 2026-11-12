---
'@chestnutlabs/gcode-preview-react': patch
'@chestnutlabs/gcode-preview-svelte': patch
---

Two adapter fixes found by a mutation sweep of the React, Vue and Svelte toolpath components.

- **Svelte:** `<GcodePreview>` no longer re-parses an unchanged `source` when `parseOptions` is a new object, which
  an inline `parseOptions={{ ... }}` is on every render (#435). Only a changed `source` re-parses, and it uses the
  current `parseOptions`. React and Vue already worked this way.
- **React:** a plain `buildVolume` (`{ x, y, z }`) changed after mount is now applied, as in Vue and Svelte. Before,
  only a machine geometry was re-applied and the new size was silently ignored.
