---
"@chestnutlabs/gcode-renderer-three": minor
---

Grow the shared render "stage" (DD-018 Phase 0): move the GL type contracts `RenderTargetCanvas` and
`GLRendererLike` into `stage.ts` (re-exported from their previous homes, so no import paths change) and
add `createDefaultGLRenderer(canvas, { preserveDrawingBuffer, alpha, antialias })` — the default
`WebGLRenderer` builder extracted from `ToolpathRenderer`, now single-sourced with an `alpha` option the
forthcoming `ModelRenderer` uses for a transparent background. Refactor-only for the toolpath side
(alpha stays false → byte-identical); additive public exports.
