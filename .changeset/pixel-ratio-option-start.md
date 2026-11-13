---
'@chestnutlabs/gcode-renderer-three': patch
'@chestnutlabs/gcode-model-renderer': patch
'@chestnutlabs/gcode-preview-core': patch
---

The `pixelRatio` option no longer stops the 3D view from starting. Since 0.22.0, a `pixelRatio` that changed the
ratio at start-up (`2`, or `'device'` on a high-DPI screen) drew a frame before the cameras existed: the preview
reported `E_RENDERER_LOAD` and drew nothing, and the model viewer stayed blank. `setPixelRatio()` after start-up was
not affected.

The testing helpers now catch this: the stub GLs in `@chestnutlabs/gcode-preview-core/testing` (`makeSuiteStubGL`)
and `@chestnutlabs/gcode-model-renderer/testing` (`MODEL_STUB_GL`, `makeModelRecordingGL`) read the camera the way
three does, and `ModelAdapterHarness.create` takes an optional `{ pixelRatio }` that your harness passes to the
viewer at mount.
