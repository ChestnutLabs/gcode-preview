/**
 * @chestnutlabs/gcode-preview-vue — thin Vue 3 integration (DD-007).
 *
 * Phase 1 (issue #104): the headless `useGcodePreview` composable. Phase 2 adds the
 * `<GcodePreview>` component, which is strictly a shell over this composable (D1).
 * This package owns Vue-glue mechanics only — no parsing/rendering capability lives
 * here, and no VueKit/Pinia/router/AnyBridge code may ever enter (DD-002 §4).
 */
export * from './use-gcode-preview.js';
export { GcodePreview, type GcodePreviewSource } from './gcode-preview-component.js';
