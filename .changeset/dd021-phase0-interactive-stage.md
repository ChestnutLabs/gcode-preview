---
'@chestnutlabs/gcode-renderer-three': patch
---

feat(renderer): add the shared InteractiveStage viewport (DD-021 Phase 0)

Adds `InteractiveStage` — the shared interactive **viewport** the DD-021 model viewer will reuse: it
owns the WebGL renderer, the dual perspective/orthographic camera, orbit/zoom/pan controls (with a new
injectable `createControls` seam for headless tests), WebGL context-loss recovery, resize, the
damage-driven render, and the DD-020 interaction-quality controller. It renders a `Scene` the owner
provides and holds no scene content or IR of its own, so the toolpath renderer and the model viewer
can drive one implementation instead of parallel camera/controls stacks. The camera types
(`CameraMode`/`CameraView`/`CameraState`) now live here and are re-exported from the toolpath renderer
for import-path stability. Additive; the toolpath renderer is unchanged (its full suite passes
byte-for-byte) and adopts the stage in the next Phase 0 step.
