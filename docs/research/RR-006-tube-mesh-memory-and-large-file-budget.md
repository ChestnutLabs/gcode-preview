# RR-006 — Tube-mesh memory cost and the large-file render budget

**Status:** Complete
**Author(s):** Nathaniel Chestnut
**Date:** 2026-08-24
**Owning work:** large-file rendering scalability (renderStill / ToolpathRenderer tube mode) ·
**Informs:** a tube-aware decimation budget in `@chestnutlabs/gcode-renderer-three`

## 1. Question & the decision it informs

Real print-farm files reach 1–2 million toolpath segments (e.g. a 49.6 MB multi-object plate ≈ 1.6 M
segments). Rendered as **tubes** — the presentation quality a card/thumbnail forces (`quality:'tubes'`)
— such a file **OOM-kills the render worker in a 2 GB memory cgroup**, in both the headless
`renderStill` sidecar and the browser render worker. The crash is **version-agnostic** (it is not the
0.8.1 paint-decode or filament-dedup work — those never touch toolpath tube meshing).

This record answers: **what exactly consumes the memory, why does the existing decimation policy not
prevent it, and what is the capability-honest fix** — so the fix is a real scalability change, not a
band-aid, and so the calibration is not rediscovered later.

## 2. Measured cause

Tube geometry is built by `buildTubeChunk` (`tubes.ts`): each toolpath segment becomes a ring of
`radialSegments + 1` vertices (default 9), and each polyline of *n* segments has *n + 1* rings. Per
segment the CPU typed arrays are:

| Array | Per segment (8 radial) |
|---|---|
| `positions` (9 verts × 3 × f32) | 108 B |
| `normals` (9 × 3 × f32) | 108 B |
| `indices` (48 × u32) | 192 B |
| `vertexSegment` (9 × u32) | 36 B |
| vertex `color` (9 × 3 × f32, scene layer) | 108 B |
| **Total** | **≈ 552 B/segment** |

A **lines**-mode segment is 6 × f32 = **24 B/segment**. Tubes are therefore **≈ 23× heavier**.

Measured directly (synthetic 1.6 M-segment IR, Node, `radialSegments: 8`):

```
decimationApplied = 1            (NO reduction applied)
556 bytes/segment
tube typed-array bytes  = 681 MB
+ color bytes           = 166 MB   (847 MB total CPU)
peak RSS (CPU only)     = 1207 MB
```

On GPU upload three.js keeps a **second copy** of each attribute/index buffer until the source arrays
are released, so ~1.7 GB of tube data is live at the upload peak, plus the ~0.5 GB base RSS and the
source bytes — **> 2 GB → OOM**.

**Why the existing policy does not catch it.** `autoDecimation` (`chunks.ts`) reduces only above
**2 M / 5 M / 10 M** extrude segments. Those thresholds were ratified for **lines** memory (24 B/seg).
At 1.6 M the file is *under* the first threshold, so `decimationApplied = 1` — a segment count that is
harmless as lines (~38 MB) is catastrophic as tubes (~1.7 GB). The per-chunk `maxVertices` budget
(8 M, throws → falls back to lines) does not help either: the tubes path deliberately uses a **small**
chunk target so no single chunk approaches 8 M, and the many small chunks then accumulate unbounded —
the budget bounds one chunk, never the total.

## 3. Chosen fix — a tube-aware decimation budget (capability-honest)

Decimation, not a new mesh format, is the right lever: the project already has an **honest, disclosed**
every-Nth reduction that always keeps layer-boundary segments (silhouettes/layer counts stay truthful),
and consumers already surface `decimationApplied > 1`. The defect is only that the *threshold* ignores
per-segment cost.

**Policy:** when a build resolves to **tubes**, choose decimation from a **tube-segment budget** rather
than the lines thresholds:

```
decimation = max(autoDecimation(count), ceil(count / TUBE_SEGMENT_BUDGET))
```

with `TUBE_SEGMENT_BUDGET = 400_000` kept tube segments. Measured, that bounds the tube+color arrays to
≈ **350 MB CPU + ~350 MB GPU ≈ 700 MB** at the upload peak (both copies live) on top of base RSS — real
headroom inside 2 GB for the source and the framework. Worked examples: 1.6 M → decimation 4 (≈ 400 k
kept); 5 M → decimation 13 (≈ 385 k kept); always bounded. (Measured at 600 k the peak was ~930 MB, which
left only moderate margin; 400 k was chosen for a safe default and can be raised on a memory-rich host.)

- **Disclosed** through the existing `decimationApplied` on the `built`/`decimated` event — a farm card
  that decimates says so; nothing is silently dropped.
- **Layer boundaries preserved** (existing `buildChunks` guarantee) so the silhouette and layer count
  stay honest at any decimation.
- **Lines mode unchanged** — the tube budget only applies when tubes are actually built, so FDM lines
  output and small-file tube output are byte-identical.
- **Configurable** — the budget is an option (`ChunkBuildOptions`) so a memory-rich host can raise it or
  a tighter sidecar can lower it; the default is the safe 2 GB-cgroup value.

The headless still and the interactive renderer share the budget (one policy, simplest honest default).
A future refinement could raise the interactive budget on a known-large heap, but that is not needed to
close the OOM and is out of scope here.

## 4. Alternatives considered

- **Cheaper per-segment tube geometry** (Uint16 indices, drop `vertexSegment`, fewer radial segments
  under load) — real but incremental (≤ ~2× headroom); does not bound an arbitrarily large file, so it
  is a complement, not the fix. Deferred.
- **Instanced tube rendering** (one cylinder instance per segment) — a much larger renderer rework with
  its own draw-range/scrub and picking implications; overkill for the budgeted-thumbnail need and a
  separate design if ever pursued.
- **Streaming upload + immediate CPU release** — reduces the CPU+GPU double-copy peak but still uploads
  unbounded GPU memory for a huge file; the budget is still required. Complementary, deferred.
- **Silently forcing lines above a segment count** — rejected: it discards the requested presentation
  quality without disclosure and produces a visibly different render with no signal. Budgeted decimation
  keeps tubes and discloses the reduction.

## 5. Acceptance

1. A forced-`tubes` build of a ≥ 1.6 M-segment file stays within a 2 GB budget (no OOM) and renders a
   decimated tube mesh, with `decimationApplied > 1` disclosed.
2. Small files and lines mode are byte-identical to today (budget inert below it).
3. Live-tested against the staged 49.6 MB multi-object plate (uncommitted) in the headless still path.
