---
'@chestnutlabs/gcode-preview-react': patch
---

Mutation sweep of the React adapter. No behaviour change.

- `useGcodePreview` no longer guards `observeProgress` and `tickProgress` against a missing controller. The
  controller exists from the first render and is never cleared, so the guard could not run.
- New tests pin the handle after `dispose()` (`raw`, `onEvent`, `controls` and `state`, in both the toolpath and
  `/model` hooks), the options a rebuilt controller gets, the 2D canvas bind, the single event subscription, the
  `onReady` metadata, the feature-role list copy, and the canvas attributes.
