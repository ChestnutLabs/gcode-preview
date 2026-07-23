/**
 * @chestnutlabs/gcode-renderer-three — Three.js toolpath renderer (DD-004).
 *
 * Phase 1 (#56): the pure geometry layer — chunk builders, colors, draw-range
 * math. No three.js import yet; the scene layer arrives in phase 2 (#57).
 * Consumes ToolpathIR only (never raw G-code, never parser internals).
 */
export { buildChunks, autoDecimation } from './chunks.js';
export type { ChunkBuildOptions, ChunkBuildResult, GeometryChunk } from './chunks.js';
export { buildChunkColors } from './colors.js';
export type { ColorMode, RGB } from './colors.js';
export { computeDrawState } from './ranges.js';
export type { ChunkDrawState } from './ranges.js';
