---
'@chestnutlabs/gcode-model-renderer': minor
---

feat(model-renderer): render reused 3MF geometry via GPU instancing instead of baking copies (DD-022 Phase 1a)

A source `.3mf` that reuses a master mesh via production-extension `<component>` references or repeated
`<build>` items no longer **bakes** a full world-space copy per placement. `parse3mf` now folds the
transform chain into per-placement matrices and keeps each master's geometry **once** in local space, and
`ModelContent` draws it as a single three `InstancedMesh` (one geometry upload, one draw call across all
placements). So memory and the triangle budget scale with **unique** geometry, not copy count — a
full-sheet plate of ~40 instanced copies measures as its ~1 master, not ~40× baked.

New: `ModelObject.instances?: Mat4[]` (present only when a master is reused, length ≥ 2; a single-placement
object keeps its `transform`) and `ModelScene.capabilities.instanced` (`'known'` when instancing was
preserved). Additive and render-equivalent for existing files (STL and single-placement 3MF are unchanged;
the existing suite passes). This is the farm-scale fix behind DD-022; the consumption-boundary disclosure
(`instancedCount` on `ready`/result) follows in Phase 1b.
