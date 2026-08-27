---
"@chestnutlabs/gcode-renderer-three": minor
---

feat(renderer): non-rectangular build-bed geometry (DD-030 D3)

The build volume can now draw an **honest non-rectangular bed** — delta, round, or irregular — instead of
only a rectangle. `BuildVolumeDef` gains an optional `shape?: BedShape`
(`{kind:'rect'} | {kind:'circular', center, diameter} | {kind:'polygon', points}`): a circle is
polygonized, the outline is filled and drawn, and the floor grid is **clipped to the outline** so the
printable area reads correctly (a round bed is no longer a square with a circle floating over it). The
`mesh` escape hatch for a fully custom bed mesh is reserved for a later phase.

`machineToVolume()` now maps a discovered `MachineGeometry.bed` of kind `circular`/`polygon` onto that
`shape`, so a **discovered** round/delta bed renders as its true outline instead of being collapsed to its
bounding rectangle (a visible improvement for delta/round printers). Callers supply the shape (from a
machine profile, a config, wherever); the renderer just draws the polygon — no profile parsing in the
library, no vendor semantics baked in.

Additive and safe: a bed with no `shape` (or `{kind:'rect'}`) takes the original rectangular path and is
**byte-identical** — the rectangular grid, plate, cage, excluded-region outlines, and origin tripod are
unchanged. The volume cage stays a bounding box (the bed outline carries the shape). First increment of
the DD-030 renderer/viewer interoperability batch.
