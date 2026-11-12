---
'@chestnutlabs/gcode-preview-core': patch
---

The portable behavioral suite (`@chestnutlabs/gcode-preview-core/testing`) now checks that every
`GcodePreviewState` field is reachable through an adapter, the way it already checks every
`GcodePreviewControls` method. The new `REQUIRED_STATE_KEYS` and `REQUIRED_CONTROLS` exports list
the fields and methods it checks. Both lists are derived from their types, so adding a field or a
method without listing it fails the type check. A failure now names the missing keys. The library
itself does not change. An adapter run through `runBehavioralSuite` now fails if its state is
missing a field.
