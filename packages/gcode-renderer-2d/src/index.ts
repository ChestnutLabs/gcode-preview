/**
 * @chestnutlabs/gcode-renderer-2d — low-resource Canvas 2D layer renderer (DD-014 / E8).
 *
 * An opt-in current/adjacent-layer 2D view over the existing `ToolpathIR`, for low-GPU,
 * low-memory, or WebGL-blocked devices (old mobile, embedded printer UIs, locked-down browsers).
 * One parse, one IR, a second lightweight view — no second parser path, no `three`, no framework.
 * Per-segment color is single-sourced with the 3D renderer via `@chestnutlabs/gcode-colors`.
 *
 * Re-exports the color model so 2D consumers get `ColorMode`/`RGB` from one import.
 */
export {
  LayerView2D,
  drawLayer,
  drawLayers,
  computeLayerFit,
  layerBounds2D,
  modelBounds2D,
  describe2DDisclosures,
  rgbToCss
} from './layer-view.js';
export type {
  LayerView2DOptions,
  DrawLayerOptions,
  DrawLayerResult,
  DrawLayersOptions,
  DrawLayersResult,
  LayerProgress,
  LayerFit,
  LayerBounds2D,
  TravelStyle,
  CanvasContext2DLike
} from './layer-view.js';
export type { ColorMode, RGB } from '@chestnutlabs/gcode-colors';
