/**
 * @chestnutlabs/toolpath-core — neutral ToolpathIR and capability model (DD-001).
 *
 * Public entry point. This package depends on nothing (no `three`, DOM, Vue, or AnyBridge)
 * and is the replacement seam for the whole toolpath stack: the parser writes it, renderers
 * and analyzers read it.
 */
export * from './ir.js';
export * from './builder.js';
export * from './bounds.js';
export * from './classify.js';
export * from './source-index.js';
export * from './metadata.js';
export * from './progress.js';
export * from './time.js';
export * from './source-map.js';
