/*
 * demo-kit — shared, UNPUBLISHED showcase/control logic for the Chestnut Labs G-code Preview
 * development surfaces (DD-031 §4.6/§12). Consumed by the Feature Lab demo and the framework showcase
 * examples via relative import; NOT an npm package and NOT a library default. It carries no engine
 * handles — only pure data + pure helpers — so examples still consume the real published adapter and
 * the demo-kit can never leak renderer lifecycle into them.
 *
 * Import the design tokens once per app: `import 'demo-kit/tokens.css'` (or link the file).
 */
export * from './capabilities.js';
export * from './fixtures.js';
export * from './format.js';
