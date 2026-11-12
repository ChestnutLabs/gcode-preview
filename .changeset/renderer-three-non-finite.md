---
'@chestnutlabs/gcode-renderer-three': patch
---

The three.js renderer now copes with bad coordinates and bad build volumes instead of showing a blank
canvas or never returning.

- **One `Infinity` or `NaN` coordinate no longer blanks the view.** Before, a toolpath you built
  yourself with a single non-finite coordinate left the camera at `NaN` (an empty canvas), and picking
  and culling broke for the whole chunk holding that segment. Now the segment is skipped: it is not
  drawn and it does not affect the frame. The camera falls back to the next usable bounds (model,
  object, all extrusion), then to the build volume. `buildChunks` reports the number of skipped
  segments in a new `skippedNonFinite` field. Only this package reports it: core and the framework
  adapters skip the same segments but do not surface the count yet.
- **A build volume that cannot be drawn now throws a `RangeError` instead of hanging.** Before, an
  `Infinity` size, a grid pitch of 0, a negative or `NaN` pitch, or a huge size such as 1e9 mm at a
  10 mm pitch ran the grid loop until the tab ran out of memory. `createBuildVolume`, `setBuildVolume`
  and the `buildVolume` option now throw for a non-finite size, origin, height or bed shape, a pitch
  that is not a positive number, and more than 10 000 grid lines on one axis. A rejected
  `setBuildVolume` leaves the current volume in place. Real beds are far under the limit (1 m at a
  1 mm pitch is 1001 lines).
- **A bad `decimation` option now throws.** `buildChunks` takes a whole number of at least 1, or
  `'auto'`. Before, `0`, a negative number, a fraction or `NaN` silently drew the wrong segments.

Parsed files are not affected unless they hit these cases. The parser already drops number words
that overflow, with a `number-out-of-range` warning.
