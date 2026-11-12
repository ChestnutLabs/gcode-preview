---
'@chestnutlabs/gcode-renderer-three': patch
---

The three.js renderer now copes with bad coordinates and bad build volumes instead of showing a blank
canvas or never returning.

- **One `Infinity` or `NaN` coordinate no longer blanks the view.** Before, a toolpath you built
  yourself with a single non-finite coordinate left the camera at `NaN` (an empty canvas), and picking
  and culling broke for the whole chunk holding that segment. Now the segment is skipped: it is not
  drawn, and picking and culling stay correct. The camera frame is still computed from the IR's own
  bounds, so with the default `frameContent: 'all'` an `Infinity` segment makes those bounds
  non-finite and the camera frames the build volume (or the preview bounds), not the remaining
  toolpath. With `frameContent: 'object'` it tries the model, then the object bounds, then the build
  volume. `buildChunks` reports the number of skipped segments in a new `skippedNonFinite` field.
  The 2D renderer skips on x/y only, so the two renderers do not skip exactly the same segments.
- **A build volume that cannot be drawn now throws a `RangeError` instead of hanging.** Before, an
  `Infinity` size, a grid pitch of 0, a negative or `NaN` pitch, or a huge size such as 1e9 mm at a
  10 mm pitch ran the grid loop until the tab ran out of memory. `createBuildVolume`, `setBuildVolume`
  and the `buildVolume` option now throw for a non-finite size, origin, height or bed shape, a pitch
  that is not a positive number, more than 10 000 grid lines on one axis, and an origin so large
  that the pitch no longer advances (1e20 + 10 is still 1e20). A rejected `setBuildVolume` leaves the
  current volume in place. Real beds are far under the limit (1 m at a 1 mm pitch is 1001 lines).
- **A bad bed discovered in a file does not break the load.** When the bed comes from the file's own
  comments (`; bed_shape` and similar) and cannot be drawn, `setBuildVolume` does not throw. It keeps
  the current volume and emits an `error` event with the new code `machine-geometry-invalid`, so the
  toolpath still loads. The code reaches Vue, React, Svelte and the Web Component through their
  existing generic `error` event (`{ code, message }`). A volume you pass yourself still throws.
- **A bad `decimation` option now throws.** `buildChunks` takes a whole number of at least 1, or
  `'auto'`. Before, `0`, a negative number, a fraction or `NaN` silently drew the wrong segments.

Parsed files are not affected unless they hit these cases. The parser already drops number words
that overflow, with a `number-out-of-range` warning.
