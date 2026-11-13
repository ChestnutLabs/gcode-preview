---
'@chestnutlabs/gcode-preview-svelte': patch
'@chestnutlabs/gcode-model-renderer': patch
---

Mutation sweep of the React, Vue and Svelte `/model` adapters.

- **Svelte:** `<ModelViewer renderScope={null}>` now means "the whole source", as documented and as React and Vue
  already behave. Before, it threw `RangeError: renderScope must be an object` while the component was created.
- **Testing seam:** `@chestnutlabs/gcode-model-renderer/testing` adds `makeModelRecordingGL().drawn()`,
  `makeTwoObjectModelSource()` and an opt-in guard (`ModelAdapterInstance.rebind` + `drawn`) that a runtime render
  scope and background survive a canvas rebind. Adapters that do not provide them are unaffected.
