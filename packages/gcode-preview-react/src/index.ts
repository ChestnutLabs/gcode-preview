/**
 * @chestnutlabs/gcode-preview-react — thin React integration (DD-007 D1 amendment).
 *
 * `useGcodePreview` hook + `<GcodePreview>` component, both reactivity bridges over
 * @chestnutlabs/gcode-preview-core — never a separate viewer implementation. Shared
 * contracts are re-exported from core.
 */
export * from './use-gcode-preview.js';
export { GcodePreview, type GcodePreviewProps, type GcodePreviewSource } from './gcode-preview-component.js';
