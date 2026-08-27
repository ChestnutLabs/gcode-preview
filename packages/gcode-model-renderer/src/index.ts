/**
 * @chestnutlabs/gcode-model-renderer — Three.js **presentation** renderer for source models (STL and
 * 3MF multi-object/material, incl. production `paint_color` multicolor) — clean thumbnails/cards
 * answering "what object is this?", distinct from toolpath inspection. A headless still
 * (`renderModelStill`, DD-018) and an interactive viewer (`createModelViewer`, DD-021) share one scene
 * core. Sits on the shared render "stage" from `@chestnutlabs/gcode-renderer-three`. `three` is a peer
 * dependency.
 */
export { ModelRenderer, NEUTRAL_MATERIAL_COLOR } from './model-renderer.js';
export type { ModelRendererOptions, ModelBackground, PresentationView } from './model-renderer.js';
export { renderModelStill } from './render-model-still.js';
export type { ModelSource, RenderModelStillOptions, RenderModelStillResult } from './render-model-still.js';
export { createModelViewer } from './model-viewer.js';
export type { ModelViewer, ModelViewerOptions, ModelViewerEvent, ModelReadyInfo } from './model-viewer.js';
export { parseStl } from './stl.js';
export { parse3mf } from './three-mf.js';
export type { Parse3mfOptions } from './three-mf.js';
export { stlLoader, threeMfLoader, DEFAULT_MODEL_LOADERS, isModelScene, resolveModelScene } from './loaders.js';
export type { ModelLoader, ModelLoadOptions, ModelSourceInput } from './loaders.js';
export { computeCacheKey, defaultEnvId } from './cache-key.js';
export { DEFAULT_LIMITS, resolveLimits, ModelParseError } from './limits.js';
export type { ModelLimits, ResolvedLimits } from './limits.js';
export { IDENTITY_MAT4, applyRenderScope } from './scene-model.js';
export type {
  ModelScene,
  ModelObject,
  ModelMaterial,
  ModelPlateSummary,
  MeshGeometry,
  ModelBounds,
  RenderScope,
  RGB,
  Mat4
} from './scene-model.js';
