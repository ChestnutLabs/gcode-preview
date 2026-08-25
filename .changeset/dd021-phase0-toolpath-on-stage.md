---
'@chestnutlabs/gcode-renderer-three': patch
---

refactor(renderer): drive the ToolpathRenderer through the shared InteractiveStage (DD-021 Phase 0)

Completes the DD-021 Phase 0 extraction: the `ToolpathRenderer` no longer owns its own GL renderer,
camera pair, orbit controls, WebGL context-loss recovery, resize, render, or interaction-quality — it
delegates all of that to the shared `InteractiveStage` (added previously) and keeps only its scene
content (toolpath geometry, overlays, retractions, build volume, picking). Camera/render behavior is
unchanged — the full renderer suite passes byte-for-byte — so this removes the duplication the model
viewer would otherwise have inherited, leaving one camera/controls implementation for both renderers.
