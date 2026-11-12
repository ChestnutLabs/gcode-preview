---
'@chestnutlabs/gcode-renderer-three': patch
---

Changing the file or quality while a large tube build is still running could show the previous file's
tubes, and a bad tube or budget option could hang the build or corrupt the geometry. Both are fixed.

- **A mid-build file or quality change no longer shows the previous file's tubes.** When a new toolpath
  was loaded while the worker pool was still building the old one, the old build's reply was handed to
  the new build's chunk, and the old build never finished. The pool now pairs every reply with its own
  request, drops replies from a superseded build, and stops the old build cleanly. A worker that fails
  stops the whole build, with nothing delivered afterwards, and a reply that cannot be read now counts
  as a failure instead of hanging. A worker that throws while building a chunk now reports the failure
  with that chunk's id, so a superseded build's late crash can no longer fail the build that replaced it
  (it used to drop the new build to a slower serial rebuild on the main thread).
- **Invalid options now throw a `RangeError` that names the option and the accepted range**, instead of
  hanging, silently disabling a guard, or producing broken geometry. `undefined` keeps the default.
  - `tube.radialSegments`: must be a whole number from 3 to 64. `Infinity` used to hang the build
    forever; `8.5` produced half-vertex geometry.
  - `tube.lineWidth`, `tube.lineHeight`: must be finite and greater than 0.
  - `tube.maxVertices`: must be a whole number of at least 1 (`NaN` used to turn the guard off).
  - `tubeByteBudget`, `geometryMemoryBudgetBytes`: must be finite and greater than 0.
  - `geometryConcurrency`: must be `'auto'`, `'off'`, or a whole number of at least 1.
  - `qualityMode`: must be `'full'`, `'adaptive'` or `'fast'`. `setQualityMode()` now throws the same
    error; before, it stored an unknown value and silently built as `'adaptive'`.
- **A toolpath whose layer table starts at a negative segment index no longer stalls the build.** A
  `segStart` of -50 million took 2.6 seconds; it is now bounded by the real segment count.
