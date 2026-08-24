---
"@chestnutlabs/gcode-model-renderer": minor
---

New package **`@chestnutlabs/gcode-model-renderer`** — a Three.js **presentation** renderer for source
models, distinct from toolpath inspection (DD-018, Phase 1: the STL proving slice).

- `renderModelStill(source, options)` — headless single-frame thumbnail preset (OffscreenCanvas /
  ANGLE→SwiftShader), mirroring `renderStill`; **transparent** or themed-solid background; deterministic
  export + a stable `(sourceHash, options, envId)` cache key.
- `ModelRenderer` — sits on the shared render "stage" from `gcode-renderer-three` (framing pose, GL
  builder with `alpha`, GL type contracts); its own presentation studio lighting.
- Three-free, **multi-object + material-capable** `ModelScene` from day one (STL is the degenerate
  single-object/no-material case; 3MF multi-object/material lands next). Capability-honest color: a model
  with no declared material renders neutral and reports `materials: 'unavailable'` — never fabricated.
- STL binary + ASCII via three's `STLLoader`; bounded (`maxTriangles`/`maxSourceBytes`) with structured
  `ModelParseError`s. `three` is a peer dependency.
