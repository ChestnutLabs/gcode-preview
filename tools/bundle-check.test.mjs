import { describe, expect, it } from 'vitest';
import { isThreeModule, startupChunks, threeSplit, verdict } from './bundle-check.mjs';

const chunk = (name, { isEntry = false, staticImports = [], threeBytes = 0, bytes = 0 } = {}) => ({
  name,
  isEntry,
  staticImports,
  threeBytes,
  bytes
});

describe('bundle-check classifier', () => {
  it('recognizes three.js module ids on both path separators, and nothing else', () => {
    expect(isThreeModule('/repo/node_modules/three/build/three.module.js')).toBe(true);
    expect(isThreeModule('C:\\repo\\node_modules\\three\\build\\three.core.js')).toBe(true);
    expect(isThreeModule('/repo/node_modules/three-mesh-bvh/index.js')).toBe(false);
    expect(isThreeModule('/repo/packages/gcode-renderer-three/dist/scene.js')).toBe(false);
  });

  it('startup = the entries plus everything they reach through static imports, transitively', () => {
    const chunks = [
      chunk('entry.js', { isEntry: true, staticImports: ['shared.js'] }),
      chunk('shared.js', { staticImports: ['deep.js'] }),
      chunk('deep.js'),
      chunk('lazy.js', { staticImports: ['shared.js'] })
    ];
    expect([...startupChunks(chunks)].sort()).toEqual(['deep.js', 'entry.js', 'shared.js']);
  });

  it('ignores a static import that is not one of the chunks (an external), and survives a cycle', () => {
    const chunks = [
      chunk('entry.js', { isEntry: true, staticImports: ['react', 'a.js'] }),
      chunk('a.js', { staticImports: ['entry.js'] })
    ];
    expect([...startupChunks(chunks)].sort()).toEqual(['a.js', 'entry.js']);
  });

  it('three in a chunk the entry imports statically counts as startup (the v0.18.0-v0.23.0 esbuild shape)', () => {
    const split = threeSplit([
      chunk('entry.js', { isEntry: true, staticImports: ['chunk-three.js'], bytes: 29 }),
      chunk('chunk-three.js', { threeBytes: 540, bytes: 612 }),
      chunk('dist-lazy.js', { staticImports: ['chunk-three.js'], bytes: 1 })
    ]);
    expect(split).toEqual({ startupThree: 540, lazyThree: 0, startupBytes: 641, startupChunks: 2 });
    expect(verdict(split)).toEqual([
      '540 bytes of three.js load at startup (want 0)',
      'no three.js in any lazy chunk (the 3D load is missing, so the check is vacuous)'
    ]);
  });

  it('passes only with zero three at startup AND some three in a lazy chunk', () => {
    const good = threeSplit([
      chunk('entry.js', { isEntry: true, bytes: 35 }),
      chunk('lazy.js', { threeBytes: 856, bytes: 900 })
    ]);
    expect(good).toEqual({ startupThree: 0, lazyThree: 856, startupBytes: 35, startupChunks: 1 });
    expect(verdict(good)).toEqual([]);
    // Vacuous: no three anywhere (a fixture that never reaches the 3D loader).
    expect(verdict({ startupThree: 0, lazyThree: 0, startupBytes: 1, startupChunks: 1 })).toEqual([
      'no three.js in any lazy chunk (the 3D load is missing, so the check is vacuous)'
    ]);
    // One stray byte at startup fails.
    expect(verdict({ startupThree: 1, lazyThree: 856, startupBytes: 1, startupChunks: 1 })).toEqual([
      '1 bytes of three.js load at startup (want 0)'
    ]);
  });

  it('fails when the bundler reports no entry chunk, instead of counting all of three as lazy', () => {
    const split = threeSplit([chunk('a.js', { threeBytes: 856, bytes: 900 })]);
    expect(split).toEqual({ startupThree: 0, lazyThree: 856, startupBytes: 0, startupChunks: 0 });
    expect(verdict(split)).toEqual([
      'no entry chunk found (the bundle output is not understood, so the check is vacuous)'
    ]);
  });
});
