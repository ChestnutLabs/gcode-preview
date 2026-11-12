---
'@chestnutlabs/gcode-preview-core': patch
'@chestnutlabs/gcode-preview-element': patch
---

The preview controller no longer misreports a rejected control or a throwing subscriber, and it rejects
`NaN` layer and scrub positions. Vue, React, Svelte and the Web Component inherit every change.

- **A rejected queued control is reported as `E_CONTROL_REJECTED`.** A control you call before the 3D
  renderer has loaded is queued and replayed once it binds. If the renderer rejected one of those calls,
  for example `setTheme({ gridOpacity: 2 })` or a `setBuildVolume` it cannot draw, the bind used to
  report `E_RENDERER_LOAD`, although the renderer was bound. Every call queued after the bad one was lost.
  Now each rejected call sets `state.error` and fires an `error` event with code `E_CONTROL_REJECTED`.
  The message names the control and quotes the renderer's error, for example
  `setTheme rejected: theme gridOpacity must be a number in [0,1] (got 2)`. The calls queued after it
  still apply, and a rebind replays nothing twice. `bindCanvas` never throws because of a queued call,
  in 2D or 3D. A call made after the renderer is bound still throws its `RangeError` to you, as before.
- **A throwing subscriber no longer changes a parse's outcome.** If an `onStateChange` or `onEvent`
  callback threw during a parse, `parse()` resolved `{ ok: false, error: { code: 'E_UNKNOWN' } }` for a
  file that had loaded. `parse-complete` and the capability state (`availableColorModes`,
  `hasRetractions`, `hasColorChanges`) were also skipped, and a throw at the very end could reject
  `parse()`. Now each subscriber runs on its own: the others still run, and the parse outcome reflects
  only the parse. A throwing listener no longer makes `parse()` reject or report `parse-error`. The
  subscriber's error is re-thrown from a microtask, so it still shows up as an uncaught error.
  If a subscriber disposes the preview or rebinds its canvas while queued calls are being replayed,
  the rest of those calls are no longer run on the old renderer, and `state.layerCount` and
  `state.segmentCount` no longer drop to 0. A rebind during replay drops the queued calls that had not run
  yet: the new view starts from the construction options, as on any rebind.
- **These calls now throw `RangeError` for a value that is not a number, or is `NaN`:**
  `setLayerRange(startLayer, endLayer)` (either end), `setScrubPosition(segIndex)` and
  `setScrubTime(ms)`. They throw at once, before anything is queued, even before the renderer has loaded.
  `null` (clear) and `±Infinity` (an open end) are still accepted. Before, a `NaN` reached the 3D
  renderer's draw state, and `setScrubTime(NaN)` silently drew nothing.
- **The Web Component ignores a non-numeric `scrub` or `scrub-time` attribute.** `scrub="abc"` (or
  setting the `scrub` / `scrubTime` property to `NaN`) keeps the previous cut instead of throwing, so the
  source still parses. A number, including `Infinity`, still applies, and removing the attribute clears.
- **`<gcode-preview scrub="5">` keeps its initial cut.** Without a `scrub-time` attribute, connecting the
  element used to clear the cut that `scrub` had just set. When both are set, `scrub-time` is applied last.
- **`setScrubTime(ms)` before a successful parse does nothing, as documented.** It used to clear an
  existing scrub cut. `setScrubTime(null)` still clears.
