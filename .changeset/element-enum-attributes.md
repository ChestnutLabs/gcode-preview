---
'@chestnutlabs/gcode-preview-element': patch
---

A mistyped enum attribute no longer breaks `<gcode-preview>` or `<gcode-model-viewer>`.

- **Bad enum attributes are now ignored.** `quality`, `quality-mode`, `progressive-preview`, `camera-mode`,
  `frame-content`, `interaction-quality`, `view` and `renderer` (and `<gcode-model-viewer>`'s `view`, `camera-mode`
  and `interaction-quality`) keep the default at mount, or the last valid value on a change, when the value is not
  exactly one of the documented ones. Before, a bad `camera-mode`, `quality-mode` or `progressive-preview` left a dead
  viewer with an `E_RENDERER_LOAD` error at mount and threw from `setAttribute` afterwards.
- **`view="foo"` no longer throws.** It threw a `TypeError` on `<gcode-model-viewer>` out of `connectedCallback` and on
  every change; on `<gcode-preview>` it emitted `E_CONTROL_REJECTED` at mount and threw on a change. `renderer="foo"`
  renders the default 3D view.
- **Properties still throw.** Setting `quality`, `qualityMode`, `progressivePreview`, `cameraMode`, `frameContent`,
  `interactionQuality`, `view` or `renderer` to an invalid value now throws `RangeError` before it reflects, and
  leaves the attribute unchanged. `null` clears.
- **`capture()` before the element is connected now rejects** with `CaptureUnsupportedError` on both elements; it used
  to throw a plain `Error` synchronously.
- **`<gcode-model-viewer>`'s `renderScope` setter now validates** a bad scope with `RangeError` before storing it,
  even before the element is connected (it used to throw later, from `connectedCallback`).
- The README attribute table now lists every attribute and states the bad-value rule once.
