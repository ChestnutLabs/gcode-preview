/**
 * @chestnutlabs/gcode-preview-element — the framework-free `<gcode-preview>` Web Component
 * adapter (DD-009 D5), a thin shell over @chestnutlabs/gcode-preview-core. Registration is a
 * function (`defineGcodePreview`) so the `.` entry stays side-effect-free; import
 * `@chestnutlabs/gcode-preview-element/define` to auto-register.
 */
export {
  GcodePreviewElement,
  defineGcodePreview,
  DEFAULT_TAG,
  type GcodePreviewSource,
  type ElementRendererOptions
} from './gcode-preview-element.js';

// Shared contracts pass through unchanged (re-export, never redeclare — the D1 drift firewall).
// RendererMode/PreviewRenderer added for cross-adapter export parity (DD-031 E4).
export type {
  GcodePreviewControls,
  GcodePreviewState,
  ParseOutcome,
  PreviewEvent,
  PreviewRenderer,
  RendererMode
} from '@chestnutlabs/gcode-preview-core';
