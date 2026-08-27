---
"@chestnutlabs/gcode-renderer-three": minor
---

feat(renderer): render diagnostics — `getRenderStats()` + `renderStats` event (DD-027 Phase 1)

Adds a capability-honest `RenderStats` snapshot so consumers can read *what the renderer is actually
running on* and *why a build was slow or degraded* instead of inferring it. `ToolpathRenderer` now
exposes `getRenderStats(): RenderStats | null` and emits a `renderStats` event at build-complete
carrying:

- **GPU:** `backend`, `webglVersion`, `capability` (hardware/software/unknown), and the raw
  `gpuRenderer`/`gpuVendor` strings — the answer to "is my GPU actually being used, or is this a
  software fallback?" (via the new best-effort `probeGpuInfo`, which reads the live context once).
- **Geometry:** `geometryMode`, source vs rendered segment counts, `decimationApplied`, `vertexCount`,
  `drawCalls`, and `tubeBytes`/`tubeByteBudget` (the latter set only when the budget actually
  constrained the build).
- **Timings:** `geometryBuildMs` and `firstRenderMs` (`parseMs`/`totalReadyMs` are `null` here — core
  fills them when it re-emits, DD-027 Phase 2).
- **Policy:** `qualityMode` and `disclosures[]` (honest degradation reasons already emitted).

Every field is a real value or `null`/`'unknown'` — never fabricated when a backend genuinely can't
provide it (2D canvas, privacy-gated `WEBGL_debug_renderer_info`, parse timing the renderer never
sees). Read-only; FDM geometry byte-identical.
