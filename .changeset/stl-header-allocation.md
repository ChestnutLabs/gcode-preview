---
'@chestnutlabs/gcode-model-renderer': patch
---

A tiny STL whose header overstates its triangle count no longer allocates memory in proportion to the claim
before failing.

A binary STL header says how many triangles follow, and the parser sized its buffers from that number before
checking it against the file or against `maxTriangles`. A 134-byte file claiming 5,000,000 triangles made the
loader allocate about 360 MB before failing; a larger claim cost gigabytes. The claim is now checked first, in
this order:

- a claim that the file cannot hold fails with `E_MODEL_PARSE` ("declares N triangles but holds M"), whatever
  the claim is, so a corrupt short file still reads as "could not read", not "too large";
- a claim the file does hold, but that is over `maxTriangles`, fails with `E_MODEL_TOO_MANY_TRIANGLES`,
  including when the file has trailing bytes.

The "holds" check keeps three's tolerance: a binary STL up to 2 bytes short of its last facet's trailing
attribute word passes this check, as before. (A file with a `COLOR=` header still fails at the loader, as it
always did, because three reads that word as a colour.)

Valid files are unaffected, including binary STLs with trailing bytes and ASCII STLs. Files that failed before
fail with the same error code; they now fail without the allocation.
