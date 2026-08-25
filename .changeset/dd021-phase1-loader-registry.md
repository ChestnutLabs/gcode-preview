---
'@chestnutlabs/gcode-model-renderer': minor
---

feat(model-renderer): add the generic open-`kind` model-source loader registry (DD-021 Phase 1)

Adds a loader registry so the model-source input is a **generic** `{ kind: string; bytes } | ModelScene`
rather than a baked-in `STL | 3MF` union — new formats (OBJ/STEP/PLY/…) become loadable by registering a
`ModelLoader`, with no change to the public input type. New exports: `ModelLoader`, `ModelLoadOptions`,
`ModelSourceInput`, `stlLoader`, `threeMfLoader`, `DEFAULT_MODEL_LOADERS`, `isModelScene`, and
`resolveModelScene` (which throws `E_MODEL_UNSUPPORTED_KIND` for an unregistered `kind`). The 3MF
`filament_colour` palette override flows through as a format-agnostic option that non-consuming loaders
ignore.

`renderModelStill` is unchanged in signature and output — its internal source dispatch now flows through
this shared registry (the existing `{kind:'stl'} | {kind:'3mf'} | ModelScene` input stays valid). This is
the seam the interactive `createModelViewer` (next PR) consumes.
