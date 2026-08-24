/**
 * @chestnutlabs/gcode-model-renderer — Three.js **presentation** renderer for source models
 * (STL now; 3MF multi-object/material next) — clean thumbnails/cards answering "what object is this?",
 * distinct from toolpath inspection (DD-018). Sits on the shared render "stage" from
 * `@chestnutlabs/gcode-renderer-three`. `three` is a peer dependency.
 */
export { ModelRenderer, NEUTRAL_MATERIAL_COLOR } from './model-renderer.js';
export type { ModelRendererOptions, ModelBackground, PresentationView } from './model-renderer.js';
export { renderModelStill } from './render-model-still.js';
export type { ModelSource, RenderModelStillOptions, RenderModelStillResult } from './render-model-still.js';
export { parseStl } from './stl.js';
export { computeCacheKey, defaultEnvId } from './cache-key.js';
export { DEFAULT_LIMITS, resolveLimits, ModelParseError } from './limits.js';
export type { ModelLimits, ResolvedLimits } from './limits.js';
export { IDENTITY_MAT4 } from './scene-model.js';
export type { ModelScene, ModelObject, ModelMaterial, MeshGeometry, ModelBounds, RGB, Mat4 } from './scene-model.js';
