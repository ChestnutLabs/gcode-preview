---
"@chestnutlabs/gcode-renderer-three": minor
---

refactor(renderer): self-contained tube-chunk kernel — `buildTubeChunk(chunk, opts)` (RR-008 Phase 1)

`buildTubeChunk` and `findPolylines` now read the chunk's own `positions` buffer instead of indexing
back into the `ToolpathIR`. Each `GeometryChunk` already carries its segment endpoints (6 floats/seg),
so the tube kernel becomes **fully self-contained** — a chunk can be handed to a worker as a single
transferable buffer with no IR reference and no `SharedArrayBuffer`. This is the low-risk enabler for
the RR-008 worker-pool phase; output is **byte-identical** to the previous implementation (the same
Float32 endpoints, read from a different source).

**Signature change (0.x minor):** the exported `buildTubeChunk(ir, chunk, opts)` drops its first
argument → `buildTubeChunk(chunk, opts)`. Consumers using the high-level `ToolpathRenderer` are
unaffected; only direct callers of the low-level primitive need to drop the `ir` argument. No rendered
geometry, ordering, continuity, or output changes.
