/**
 * @chestnutlabs/toolpath-core — neutral ToolpathIR and capability model (DD-001).
 *
 * Public entry point. This package depends on nothing (no `three`, DOM, Vue, or AnyBridge)
 * and is the replacement seam for the whole toolpath stack: the parser writes it, renderers
 * and analyzers read it.
 */
export * from './ir';
export * from './builder';
export * from './bounds';
export * from './source-index';
