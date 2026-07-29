/**
 * @chestnutlabs/gcode-colors — renderer-agnostic per-segment color model (DD-014 D3).
 *
 * The single home for the toolpath color subsystem: the {@link ColorMode} union and an
 * honest, capability-gated mapping from a `ToolpathIR` segment to an {@link RGB}. Both the
 * Three.js renderer and the low-resource 2D renderer depend on this package so color/kind
 * semantics never drift between them. Depends only on `@chestnutlabs/toolpath-core` — no
 * `three`, no canvas, no framework.
 */
export type { RGB, ColorMode, SegmentColorer } from './colors.js';
export {
  DEFAULT_FALLBACK,
  feedrateRange,
  toolPowerRange,
  layerHeights,
  layerHeightRange,
  rampColor,
  createSegmentColorer,
  segmentColor
} from './colors.js';
