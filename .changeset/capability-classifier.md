---
'@chestnutlabs/gcode-renderer-three': minor
---

feat(renderer): shared client render-capability classifier (DD-023 Phase A)

Adds a pure, fail-safe WebGL render-capability classifier (`classifyRenderer`, `detectRenderCapability`,
`resolveCapability`) plus the `RenderCapability` / `CapabilityHint` / `QualityPolicy` types — the shared
seam a later phase uses to size a generous budget on hardware and a conservative one on software (DD-023 §4
D1). Classifies the **inner** renderer of an `ANGLE (...)` string (never the wrapper); an unrecognized
string or a blind `WEBGL_debug_renderer_info` extension resolves conservatively to software; a
GPU-fell-to-SwiftShader string classifies software (the safe direction). **No rendering behavior changes** —
this is the classifier + types only; the budget/`qualityMode` wiring lands in later phases.
