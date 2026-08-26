---
"@chestnutlabs/toolpath-core": minor
"@chestnutlabs/gcode-dialects": minor
---

feat(core): first-class non-model FeatureRoles — PrimeTower, WipeTower, Raft, Purge (DD-026 T2)

Adds four additive `FeatureRole` values (`PrimeTower = 11`, `WipeTower = 12`, `Raft = 13`,
`Purge = 14`) so slicer housekeeping is a first-class role rather than being folded into the generic
`Custom`. This is the foundation for the DD-026 T2 model-bounds classifier, which excludes these
roles when framing the printed object.

Adapters now map their tower/raft vocabulary onto the new roles: OrcaSlicer/Bambu `Prime tower` →
`PrimeTower`; PrusaSlicer/ideaMaker `Wipe tower`/`WIPE-TOWER` → `WipeTower`; Cura `PRIME-TOWER` →
`PrimeTower`; Simplify3D `prime pillar` → `PrimeTower`; and `raft`/`RAFT` across Cura, ideaMaker,
OrcaSlicer, PrusaSlicer, and Simplify3D → `Raft` (previously reported as `Brim`). `Purge` is reserved
for the explicit `FLUSH_START/END` bracket landing in a follow-up. Unmapped housekeeping (e.g.
Simplify3D `ooze shield`) stays generic `Custom` — the safe, in-frame direction.

Additive numeric-index values only; FDM geometry is byte-identical. The affected raft/tower segments
report a more precise feature-channel value; no rendered geometry or default colours change.
