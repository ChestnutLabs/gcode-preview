---
'@chestnutlabs/gcode-model-renderer': minor
---

feat(model-renderer): disclose `instancedCount` + `decimationApplied` on the model ready/still result (DD-022 Phase 1b)

`RenderModelStillResult` and `createModelViewer`'s `ready.info` (`ModelReadyInfo`) now report
`instancedCount` (total placements drawn — greater than `objectCount` when the source reused geometry, for
an "N copies" badge) and a flat `decimationApplied` (1 = none), named identically to the toolpath
`RenderStillResult.decimationApplied` so a consumer badges "simplified for size" the same way for model and
toolpath cards. `decimationApplied` is always 1 until model LOD lands (DD-022 Phase 2); it is reserved now
so the field is stable for consumers wiring the badge against the instancing boundary. Additive.
