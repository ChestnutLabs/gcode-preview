---
'@chestnutlabs/gcode-preview-core': patch
---

The portable behavioral suite (`@chestnutlabs/gcode-preview-core/testing`) now checks that every
`GcodePreviewState` field is reachable through an adapter, the way it already checks every
`GcodePreviewControls` method. The new `REQUIRED_STATE_KEYS` export lists those fields. The list
is derived from the state type, so adding a state field without listing it fails the type check.
The library itself does not change. An adapter run through `runBehavioralSuite` now fails if its
state is missing a field.
