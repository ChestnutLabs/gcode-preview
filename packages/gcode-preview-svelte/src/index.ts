/**
 * @chestnutlabs/gcode-preview-svelte — thin Svelte integration (DD-007 D1 amendment).
 *
 * `createGcodePreview` store/action API + the raw `GcodePreview.svelte` component
 * (import from '@chestnutlabs/gcode-preview-svelte/GcodePreview.svelte' — the consumer's
 * bundler compiles it via the "svelte" export condition). Both are reactivity bridges
 * over @chestnutlabs/gcode-preview-core — never a separate viewer implementation.
 */
export * from './create-gcode-preview.js';
