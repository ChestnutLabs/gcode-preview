---
'@chestnutlabs/gcode-model-renderer': patch
---

A 3MF that holds an absurd number of vertices or triangles is now rejected before its arrays are allocated, instead of
being read up to the container's expanded-size cap. Vertices are bounded at three per allowed triangle (15,000,000 at the
default `maxTriangles` of 5,000,000) and fail with the new `E_MODEL_TOO_MANY_VERTICES`; triangles are now bounded at
`maxTriangles` across the whole file while it is read (`E_MODEL_TOO_MANY_TRIANGLES`), where before only each object was
checked at read time. Both counts cover every object and part in the file, placed or not; a part reached by several
build items counts once. Raising `maxTriangles` raises both limits and the error message names the numbers. Meshes that
fit the triangle limit are unaffected, including unindexed exports that use exactly three vertices per triangle. A file
whose unplaced objects add up to more than `maxTriangles` triangles, or that carries more than three vertices per
allowed triangle, will now reject; raise `maxTriangles` to load it.
