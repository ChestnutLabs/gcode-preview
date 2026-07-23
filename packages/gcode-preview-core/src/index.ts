/**
 * @chestnutlabs/gcode-preview-core — the framework-neutral preview controller and the
 * SHARED TypeScript contracts every framework adapter re-exports (DD-007 §4.6):
 * adapters are reactivity bridges over this one implementation, never parallel viewers.
 * The portable behavioral suite ships via the `./testing` subpath.
 */
export * from './controller.js';
