---
'@chestnutlabs/gcode-model-renderer': minor
---

feat(model-renderer): fast structural reject for oversize / instance-bomb source 3MFs (DD-022 Phase 0)

Before decompressing any large external geometry part, `parse3mf` now runs a cheap structural estimate from
the main part's build-item/component tree plus the ZIP directory's uncompressed sizes, and rejects a clear
instance-bomb or oversize plate in **sub-second** time instead of ~10 s of decompress-and-bake. New
`ModelLimits.maxInstances` (default 50,000) bounds total instance placements → `E_MODEL_TOO_MANY_INSTANCES`;
an over-budget triangle estimate → `E_MODEL_TOO_MANY_TRIANGLES` from the estimate rather than mid-bake. The
estimate under-counts external geometry and applies a ×2 safety margin, so it never false-rejects a file
that would actually fit — borderline files fall through to the exact per-triangle parse.

First phase of the instance-aware source-model work ([DD-022](../docs/design/DD-022-model-instancing-and-lod.md)):
a standalone latency/DoS win. Phase 1 (GPU instancing) will make these plates *render* instead of reject.
Additive; existing files and limits are unchanged.
