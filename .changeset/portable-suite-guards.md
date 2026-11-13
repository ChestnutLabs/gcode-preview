---
'@chestnutlabs/gcode-preview-core': patch
'@chestnutlabs/gcode-model-renderer': patch
---

Portable behavioural suites: new parity guards every adapter inherits.

- **`@chestnutlabs/gcode-preview-core/testing`:** `runBehavioralSuite` now checks the parse event contract on
  every case (each `parse-started` gets exactly one terminal event, and `state.parsing` is false at dispose),
  through the newly exported `withParseLifecycleGuard` and `parseLifecycleViolation`. New cases cover a null
  input, an input whose `getReader` getter throws, a renderer-checked bad control (a `RangeError`, or
  `E_CONTROL_REJECTED` when it was queued, never both), bad control values after bind, and a 3D renderer that
  fails to load (`E_RENDERER_LOAD` in state and on the `error` event), through the new optional
  `AdapterHarness.create({ createGL })` seam. The component suite
  adds a re-parse case (the same source again, or a `parseOptions` change alone, does not re-parse) and the
  optional `MountedComponent.setParseOptions` seam it needs.
- **`@chestnutlabs/gcode-model-renderer/testing`:** `runModelBehavioralSuite` adds render-scope validation,
  last-wins overlapping `setSource`, and `setSource` after dispose rejecting `E_MODEL_PREVIEW_DISPOSED`. New
  `MODEL_VIEWER_PROP_KEYS`, `MODEL_VIEWER_EVENT_KEYS` and `modelViewerSurfaceGaps` let each `/model` adapter
  check that its component surface matches the others.
