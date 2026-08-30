/**
 * @chestnutlabs/gcode-preview-element/model — the framework-free `<gcode-model-viewer>` Web Component
 * for interactive source-model viewing (STL / 3MF), the Prepare-side counterpart to `<gcode-preview>`
 * (DD-031). Registration is a function (`defineGcodeModelViewer`) so this entry stays side-effect-free;
 * import `.../model/define` to auto-register. A thin shell over `createModelPreviewController`.
 */
export { GcodeModelViewerElement, defineGcodeModelViewer, DEFAULT_MODEL_TAG } from './gcode-model-viewer-element.js';

// Shared contracts pass through unchanged (re-export, never redeclare).
export type {
  ModelPreviewControls,
  ModelPreviewState,
  ModelViewer,
  ModelViewerEvent,
  ModelReadyInfo,
  ModelSourceInput
} from '@chestnutlabs/gcode-model-renderer';
