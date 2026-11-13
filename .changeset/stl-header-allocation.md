---
'@chestnutlabs/gcode-model-renderer': patch
---

A tiny STL whose header overstates its triangle count no longer allocates memory in proportion to the claim
before failing.

A binary STL header says how many triangles follow, and the parser sized its buffers from that number before
checking it against the file or against `maxTriangles`. A 134-byte file claiming 5,000,000 triangles made the
loader allocate about 360 MB before failing; a larger claim cost gigabytes. The claim is now checked first:

- a claim over `maxTriangles` fails with `E_MODEL_TOO_MANY_TRIANGLES`, including when the file has trailing bytes;
- a claim that the file cannot hold fails with `E_MODEL_PARSE` ("declares N triangles but holds M").

Valid files are unaffected, including binary STLs with trailing bytes and ASCII STLs. Files that failed before
fail with the same error code; they now fail without the allocation.
