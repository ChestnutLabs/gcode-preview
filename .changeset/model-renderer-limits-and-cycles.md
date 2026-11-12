---
'@chestnutlabs/gcode-model-renderer': patch
---

Hostile 3MF files can no longer hang the parser, and model `limits` are now validated and enforced.

- **A small 3MF could hang the load forever.** Components that list the next object twice (a 3 KB file
  with 50 levels is 2^50 steps), or an object that lists itself, were walked without a bound. Every node
  of the assembly now counts against `maxInstances` (default 50,000) and fails with
  `E_MODEL_TOO_MANY_INSTANCES`, including nodes inside production-extension parts. An object that contains
  itself, directly or through others, throws the new `E_MODEL_CYCLE`. A part shared by several parents is
  valid 3MF and still loads.
- **`maxObjects` is now enforced.** It was documented (default 10,000) but never checked. A 3MF with more
  `<object>` elements than the limit, counted across the main and any external parts, now throws the new
  `E_MODEL_TOO_MANY_OBJECTS`. **Files with more than 10,000 objects that used to load now reject**; raise
  `maxObjects` if you load such files on purpose.
- **Invalid limits throw instead of switching the bound off.** `maxTriangles`, `maxObjects`,
  `maxSourceBytes` and `maxInstances` must be non-negative integers. Before, `NaN` disabled the bound and a
  negative value rejected every file. Now they throw `ModelParseError` with `code: 'E_MODEL_OPTION'`. As with
  the container and parser caps, `Infinity` is not accepted as "unlimited"; pass a large integer. A field
  that is left out or `undefined` keeps its default, and `0` is allowed.
- **A 3MF whose components fan out past `maxInstances` also counts mesh-free containers.** An assembly
  that was within the cap by placements alone, but had more than `maxInstances` nodes in total, now rejects.
