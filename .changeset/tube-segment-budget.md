---
'@chestnutlabs/gcode-renderer-three': minor
---

feat(renderer): bound tube-mesh memory with a tube-segment budget (fix ~2 GB-cgroup OOM on large forced-tube files, RR-006)

Large toolpath files (≈1.6 M+ segments) rendered as **tubes** — the quality a card/thumbnail forces —
OOM-killed the render worker in a 2 GB memory cgroup, in both the headless `renderStill` sidecar and the
browser render worker. Root cause: tube geometry costs ~23× the memory of lines (~552 B/segment), but
`autoDecimation`'s reduction thresholds were calibrated for lines, so a segment count that is harmless as
lines got **zero** decimation as tubes and allocated ~850 MB CPU + a second ~850 MB copy on GPU upload.

Tube mode now decimates to a **`TUBE_SEGMENT_BUDGET`** (new export, default ~400k kept segments) so tube
memory stays bounded (~700 MB peak, safe inside a 2 GB cgroup). The reduction is **disclosed** via the
existing `decimationApplied` (nothing silently dropped) and **always preserves layer-boundary segments**
so silhouettes and layer counts stay honest. New `ToolpathRendererOptions.tubeSegmentBudget` and
`ChunkBuildOptions.tubeSegmentBudget` let a memory-rich host raise it or a tighter sidecar lower it.

Lines mode and small/normal tube files are **unchanged** (the budget applies only when a build resolves to
tubes and exceeds it). Verified on the real 47 MB, 1.73 M-segment multi-object plate: GPU-upload peak
1590 MB → 635 MB (`decimationApplied` 1 → 4). See [RR-006](../docs/research/RR-006-tube-mesh-memory-and-large-file-budget.md).
