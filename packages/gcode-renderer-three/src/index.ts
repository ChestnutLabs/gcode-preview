/**
 * @chestnutlabs/gcode-renderer-three — Three.js toolpath renderer (DD-004).
 *
 * Phase 1 (#56): the pure geometry layer — chunk builders, colors, draw-range
 * math. No three.js import yet; the scene layer arrives in phase 2 (#57).
 * Consumes ToolpathIR only (never raw G-code, never parser internals).
 */
export { buildChunks, autoDecimation } from './chunks.js';
export type { ChunkBuildOptions, ChunkBuildResult, GeometryChunk } from './chunks.js';
export { buildChunkColors, feedrateRange } from './colors.js';
export type { ColorMode, RGB } from './colors.js';
export { computeDrawState, computeOverlayDrawStates } from './ranges.js';
export type { ChunkDrawState, OverlayDrawStates } from './ranges.js';
export { buildTubeChunk, TUBES_AUTO_MAX_SEGMENTS } from './tubes.js';
export type { TubeOptions, TubeChunkGeometry } from './tubes.js';
export { ToolpathRenderer, chooseQuality, machineToVolume, resolveHitSegment } from './scene.js';
export type {
  ToolpathRendererOptions,
  RenderTargetCanvas,
  RendererEvent,
  GLRendererLike,
  ProgressPresentationMode,
  QualityMode,
  CameraMode,
  CameraView,
  CameraState
} from './scene.js';
export { createBuildVolume } from './build-volume.js';
export type { BuildVolumeDef, BuildVolumeStyle } from './build-volume.js';
export { framingFromCenterRadius, createDefaultGLRenderer } from './stage.js';
export type { Framing, DefaultGLOptions } from './stage.js';
export { DEFAULT_THEME, resolveTheme } from './theme.js';
export type { Theme, MaterialPreset, ThemeColor, ResolvedTheme, BedSurface, BedTextureSource } from './theme.js';
