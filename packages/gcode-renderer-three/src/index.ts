/**
 * @chestnutlabs/gcode-renderer-three — Three.js toolpath renderer (DD-004).
 *
 * Phase 1 (#56): the pure geometry layer — chunk builders, colors, draw-range
 * math. No three.js import yet; the scene layer arrives in phase 2 (#57).
 * Consumes ToolpathIR only (never raw G-code, never parser internals).
 */
export { buildChunks, autoDecimation, TUBE_SEGMENT_BUDGET } from './chunks.js';
export type { ChunkBuildOptions, ChunkBuildResult, GeometryChunk } from './chunks.js';
export { buildChunkColors, feedrateRange } from './colors.js';
export type { ColorMode, RGB } from './colors.js';
export { computeDrawState, computeOverlayDrawStates } from './ranges.js';
export type { ChunkDrawState, OverlayDrawStates } from './ranges.js';
export {
  buildTubeChunk,
  tubeRadialForBudget,
  tubeSegmentBytes,
  TUBES_AUTO_MAX_SEGMENTS,
  TUBE_CPU_BYTE_BUDGET,
  MIN_RADIAL_SEGMENTS
} from './tubes.js';
export type { TubeOptions, TubeChunkGeometry } from './tubes.js';
export { ToolpathRenderer, chooseQuality, machineToVolume, resolveHitSegment } from './scene.js';
export type {
  ToolpathRendererOptions,
  RenderTargetCanvas,
  RendererEvent,
  GLRendererLike,
  ProgressPresentationMode,
  QualityMode,
  ProgressivePreview,
  CameraMode,
  CameraView,
  CameraState
} from './scene.js';
export { createBuildVolume } from './build-volume.js';
export type { BuildVolumeDef, BuildVolumeStyle } from './build-volume.js';
export { framingFromCenterRadius, createDefaultGLRenderer } from './stage.js';
export type { Framing, DefaultGLOptions } from './stage.js';
export { InteractionQualityController } from './interaction-quality.js';
export type { InteractionQualityDeps } from './interaction-quality.js';
export { InteractiveStage } from './interactive-stage.js';
export type { InteractiveStageOptions, ControlsLike } from './interactive-stage.js';
export { DEFAULT_THEME, resolveTheme } from './theme.js';
export type { Theme, MaterialPreset, ThemeColor, ResolvedTheme, BedSurface, BedTextureSource } from './theme.js';
export type { LoadStage, LoadUnit, LoadProgress } from './progress.js';
export { classifyRenderer, detectRenderCapability, resolveCapability } from './capability.js';
export type {
  RenderCapability,
  CapabilityHint,
  QualityPolicy,
  RendererInfoContext,
  DetectedCapability
} from './capability.js';
