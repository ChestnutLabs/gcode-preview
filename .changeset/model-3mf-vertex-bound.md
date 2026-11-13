---
'@chestnutlabs/gcode-model-renderer': patch
---

A 3MF that holds an absurd number of vertices is now rejected with `E_MODEL_TOO_MANY_VERTICES` before its vertex
arrays are allocated, instead of being read up to the container's expanded-size cap. The bound is three vertices per
allowed triangle (15,000,000 at the default `maxTriangles` of 5,000,000), counted across every object and part, so
raising `maxTriangles` raises it too and the error message names both numbers. Meshes that fit the triangle limit are
unaffected, including unindexed exports that use exactly three vertices per triangle. A file that is within the
triangle limit but carries more than three vertices per triangle (unreferenced vertices) will now reject; raise
`maxTriangles` to load it.
