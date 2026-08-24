---
"@chestnutlabs/gcode-model-renderer": minor
---

3MF **Production Extension** support in `parse3mf` (the Bambu Studio / MakerWorld default layout). A
production-extension file has a small `3D/3dmodel.model` shell whose `<build><item>` points at a
`<components>` object that references the real mesh in an **external** part (`<component
p:path="/3D/Objects/*.model" objectid=… transform=…/>`). Previously this parsed as "no renderable
geometry"; now the parser follows `p:path` into the referenced part, resolves the object, and composes
the component transform with the build-item transform — resolving nested components across parts (depth-
guarded). The inline-mesh case is unchanged; materials resolve from whichever part defines the mesh's
colors.

Note: some vendors (e.g. Bambu) encode multicolor via a proprietary per-triangle `paint_color` attribute
plus filament colors in `project_settings.config`, not standard 3MF materials. Those still render with
correct geometry and honest `materials: 'unavailable'` (a neutral model, never a fabricated color) —
decoding vendor paint into true colors is a separate follow-up.
