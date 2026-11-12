---
'@chestnutlabs/gcode-model-renderer': patch
---

Model viewer fixes from a mutation sweep of `createModelPreviewController`, `createModelViewer`, `renderModelStill` and the render scope.

- The controller now remembers `setRenderScope`, `setBackground` and `setInteractionQuality`, so a canvas rebind (a StrictMode remount, a replaced canvas) keeps the consumer's latest values instead of the initial options.
- `controls.setSource()` after `dispose()` rejects with `E_MODEL_PREVIEW_DISPOSED` instead of never settling. `controls.capture()` before a canvas binds rejects with `CaptureUnsupportedError` (`code: 'E_CAPTURE_UNSUPPORTED'`) instead of a plain `Error`.
- A superseded or disposed `setSource` that fails no longer emits an `error` event after the newer load's `ready`; its own promise still rejects.
- An invalid render scope (not exactly one of `objectIds` (string array), `plateId` (integer), `instanceFilter` (function)) throws `RangeError` before anything is stored, in `setRenderScope`, the constructor options and `renderModelStill`. Previously `{}` threw a `TypeError` and `{ objectIds: 'a' }` matched by substring.
- A render scope whose only kept object has empty geometry now has empty bounds `[0,0,0]`..`[0,0,0]` instead of ±Infinity.
- **Cache keys change for pre-built `ModelScene` inputs.** `renderModelStill` used to key them on the object count, bounds and capabilities only, so two scenes with different geometry or colours shared a key (a false thumbnail cache hit). The key now covers the geometry content, transforms, instances, plate membership, materials, plates and the source's plate claim. A stored key for a pre-built scene will not match; regenerate it. Keys for STL and 3MF byte sources are unchanged.
