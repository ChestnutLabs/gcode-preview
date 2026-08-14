/**
 * @chestnutlabs/gcode-preview-core — the framework-neutral preview controller and the
 * SHARED TypeScript contracts every framework adapter re-exports (DD-007 §4.6):
 * adapters are reactivity bridges over this one implementation, never parallel viewers.
 * The portable behavioral suite ships via the `./testing` subpath.
 */
export * from './controller.js';
// The renderer-agnostic seam (DD-014 D5): the mode selector + interface adapters re-export.
export type { PreviewRenderer, PreviewRendererEvent, RendererMode } from './renderer-interface.js';
export { LayerView2DRenderer, type LayerView2DRendererOptions } from './renderer-2d-adapter.js';
export { renderStill, type RenderStillOptions, type RenderStillResult, type StillCameraPose } from './render-still.js';
// Re-export the theme contract so core consumers get it three-free (#153, DD-009 D4).
export type { Theme, MaterialPreset, ThemeColor } from '@chestnutlabs/gcode-renderer-three';
// Camera contracts (three-free type re-exports): projection + preset views + serializable state (#268).
export type { CameraMode, CameraView, CameraState } from '@chestnutlabs/gcode-renderer-three';
