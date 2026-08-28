---
"@chestnutlabs/gcode-renderer-three": minor
"@chestnutlabs/gcode-preview-core": minor
"@chestnutlabs/toolpath-core": minor
---

feat(renderer): `setFeatureRoleVisible(role, visible)` — show/hide a single feature role

Toggle a `FeatureRole` on or off — e.g. hide `Skirt`/`Brim` to declutter a part preview, or isolate
`Support`. Feature roles live per-segment inside the extrusion geometry (unlike the whole-chunk move-kind
toggle), so hidden segments are collapsed to NaN positions and the GPU discards them; showing the role
again restores the geometry byte-for-byte. Available on `ToolpathRenderer` and via
`GcodePreviewControls.setFeatureRoleVisible` (a no-op on the 2D renderer). Additive and capability-gated:
gate the UI on `capabilities.featureRoles === 'known'`, like the feature colour mode; untouched geometry
(no role hidden) is byte-identical. Also exports `FeatureRoleValue` from `@chestnutlabs/toolpath-core`.
