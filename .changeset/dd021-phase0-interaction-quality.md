---
'@chestnutlabs/gcode-renderer-three': patch
---

refactor(renderer): extract the DD-020 interaction-quality controller (DD-021 Phase 0)

First step of the DD-021 shared-infrastructure extraction: the interaction-aware quality logic
(reduce device pixel ratio while the camera moves, restore on settle) moves out of `ToolpathRenderer`
into a small renderer-agnostic `InteractionQualityController`, so the upcoming interactive model viewer
reuses one implementation instead of a parallel copy. The `ToolpathRenderer` now delegates to it —
behavior is unchanged (its full test suite passes byte-for-byte), and the controller is covered by its
own unit tests. Additive export; no public API removed.
