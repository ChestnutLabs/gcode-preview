---
'@chestnutlabs/gcode-renderer-three': minor
---

Add an optional **filled build-plate surface** to the 3D renderer (#185). The bare wireframe grid
gains a themeable, self-drawn plate underneath it so a print reads against a bed rather than empty
space — off by default (`bedSurface: { mode: 'none' }`), so the existing look is unchanged.

- `Theme.bedSurface` (`BedSurface`): `mode: 'none' | 'solid'`, optional `color`, `opacity`, and a
  consumer-supplied `texture` (`ImageBitmap | HTMLCanvasElement` — never a URL, so it stays CSP-safe
  and synchronous for `renderStill`). No bundled vendor plate art (trademark + bloat).
- The plate is an unlit plane spanning the bed, seated just below `z=0` with `depthWrite: false` so it
  never occludes the toolpath.
- Keep-out zones from `MachineGeometry.excludedRegions` now render as amber outlines on the plate.

Additive; no IR/geometry change and no new runtime dependency.
