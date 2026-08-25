---
'@chestnutlabs/gcode-model-renderer': patch
---

fix(model-renderer): the fast-reject estimate counts UNIQUE triangles, not baked-per-placement (DD-022)

The Phase 0 structural estimate summed an external master's triangle estimate **once per placement**, so a
full-sheet instanced plate (e.g. Baby_Opossum, ~40 reused copies) estimated ~26 M "baked" triangles and was
**wrongly rejected** with `E_MODEL_TOO_MANY_TRIANGLES` — even though Phase 1 instancing renders it from its
~1.5 M **unique** triangles. The still path only escaped it by running with raised limits; the interactive
`createModelViewer` used defaults and rejected.

The estimate now counts each unique master (by objectid / external path) **once**, matching the instanced
render. The placement count still guards an instance bomb via `maxInstances`. So an instanced plate parses
and renders (interactive and headless) at default limits instead of falsely rejecting; a genuinely huge
*unique* mesh is still bounded by the triangle limit. Fixes the "too large to show interactively" regression
on instanced source `.3mf` plates.
