---
'@chestnutlabs/gcode-preview-core': patch
---

`@chestnutlabs/gcode-preview-core/testing` adds `runComponentConformanceSuite` (with its `ComponentHarness` / `MountedComponent` types) and the `emitSuiteBuild` helper. They are a component-level conformance case that mounts each adapter's component and checks that the disclosure callback reports the current build's text, after build-complete (#502). This is test support with the same status as `runBehavioralSuite`.
