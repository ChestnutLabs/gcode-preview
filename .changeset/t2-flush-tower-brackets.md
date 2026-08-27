---
"@chestnutlabs/gcode-dialects": minor
---

feat(orca-bambu): FLUSH/WIPE_TOWER housekeeping brackets (DD-026 D3)

The OrcaSlicer/Bambu adapter now recognises Bambu's bare `FLUSH_START/END` (multi-material purge) and
`WIPE_TOWER_START/END` comment brackets and maps the enclosed range to `FeatureRole.Purge` /
`FeatureRole.WipeTower` (RR-007 §5). The brackets are applied **after** the `;TYPE:` / `; FEATURE:`
markers so the explicit bracket wins over the surrounding role, and the non-model classifier (DD-026 D4)
then excludes them from `modelBounds` — so a plate whose flush/wipe-tower sits far from the parts frames
the model rather than the purge column, even without an object channel.

Shares the wipe bracket's balancing logic via a new internal `forEachBracketRange` helper (a stray END
is ignored, a second START folds in, an unclosed START closes at EOF) — `applyWipeRanges` is refactored
onto it with byte-identical behaviour. `matchBracketComment` / `applyFeatureBracketRanges` /
`BracketMark` are internal annotate helpers (not re-exported), mirroring the existing wipe bracket.

Additive feature-channel coverage only; FDM geometry unchanged (the golden corpus carries no
flush/wipe-tower brackets, so no goldens move).
