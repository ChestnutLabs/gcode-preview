import { describe, expect, it, vi } from 'vitest';
import {
  SIDE_EFFECT_IMPORTS,
  childRun,
  cli,
  controlVerdict,
  importUnderHook,
  isThreeModule,
  main,
  parseDefined,
  runSideEffectBundle,
  runtimeVerdict,
  sideEffectVerdict,
  startupChunks,
  threeSplit,
  verdict
} from './bundle-check.mjs';
import { isRendererMain } from './bundle-check/startup-hook.mjs';

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

  it('runtime: the hook matches only the renderer main entry, on both separators', () => {
    expect(isRendererMain('file:///C:/r/node_modules/@chestnutlabs/gcode-renderer-three/dist/index.js')).toBe(true);
    expect(isRendererMain('file:///r/packages/gcode-renderer-three/dist/index.js')).toBe(true);
    expect(isRendererMain('C:\\r\\packages\\gcode-renderer-three\\dist\\index.js')).toBe(true);
    expect(isRendererMain('file:///r/packages/gcode-renderer-three/dist/lite.js')).toBe(false);
    expect(isRendererMain('file:///r/packages/gcode-preview-core/dist/index.js')).toBe(false);
  });

  it('runtime control: the main-entry import must trip the hook, or the check is vacuous', () => {
    expect(controlVerdict({ loadsRenderer: true, ok: false, output: '' })).toEqual([]);
    expect(controlVerdict({ loadsRenderer: false, ok: true, output: '' })).toEqual([
      'runtime control: importing the renderer main entry did not trip the hook (the check is vacuous)'
    ]);
  });

  it('runtime verdict: a tripped hook fails, an import error fails, a clean import passes', () => {
    expect(runtimeVerdict('pkg', { loadsRenderer: true, ok: false, output: 'STARTUP-LOADS-RENDERER: x' })).toEqual([
      "pkg: importing it loads the renderer's main entry (three.js) at startup"
    ]);
    const failed = { loadsRenderer: false, ok: false, output: 'ReferenceError: window is not defined\n  at x' };
    expect(runtimeVerdict('pkg', failed)).toEqual([
      'pkg: could not be imported in Node: ReferenceError: window is not defined'
    ]);
    expect(runtimeVerdict('pkg', { loadsRenderer: false, ok: true, output: '' })).toEqual([]);
  });
});

describe('bundle-check side-effect imports', () => {
  it('checks both element registration entries, each for its own tag', () => {
    expect(SIDE_EFFECT_IMPORTS.map((s) => [s.fixture, s.specifier, s.defines])).toEqual([
      ['element-define.mjs', '@chestnutlabs/gcode-preview-element/define', 'gcode-preview'],
      ['element-model-define.mjs', '@chestnutlabs/gcode-preview-element/model/define', 'gcode-model-viewer']
    ]);
  });

  it('reads one name per DEFINED line, only whole lines', () => {
    expect(parseDefined('DEFINED gcode-preview\nnoise DEFINED x\nDEFINED gcode-model-viewer\n')).toEqual([
      'gcode-preview',
      'gcode-model-viewer'
    ]);
    expect(parseDefined('')).toEqual([]);
  });

  it('passes only when the bundle registered the expected tag', () => {
    const s = { specifier: 'pkg/define', defines: 'gcode-preview' };
    expect(sideEffectVerdict(s, { defined: ['gcode-preview'], ok: true, output: '' })).toEqual([]);
    expect(sideEffectVerdict(s, { defined: [], ok: true, output: '' })).toEqual([
      'pkg/define: the production bundle never registers <gcode-preview> (registered: nothing); ' +
        'the bundler dropped the side-effect import, so check "sideEffects" in the package.json'
    ]);
    // Registering a different tag does not count.
    expect(sideEffectVerdict(s, { defined: ['gcode-model-viewer'], ok: true, output: '' })).toEqual([
      'pkg/define: the production bundle never registers <gcode-preview> (registered: gcode-model-viewer); ' +
        'the bundler dropped the side-effect import, so check "sideEffects" in the package.json'
    ]);
  });

  it('main counts a dropped side-effect import as a failure (and a kept one as none)', async () => {
    const quiet = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {})
    ];
    try {
      const opts = {
        fixtures: [],
        importUnder: () => ({ loadsRenderer: true, ok: false, output: '' }),
        startupPackages: []
      };
      const imports = [{ fixture: 'x.mjs', specifier: 'pkg/define', defines: 'gcode-preview' }];
      const dropped = async () => ({ defined: [], ok: true, output: '' });
      const kept = async () => ({ defined: ['gcode-preview'], ok: true, output: '' });
      expect(await main({ ...opts, sideEffectImports: imports, runSideEffect: dropped })).toBe(1);
      expect(await main({ ...opts, sideEffectImports: [...imports, ...imports], runSideEffect: dropped })).toBe(2);
      expect(await main({ ...opts, sideEffectImports: imports, runSideEffect: kept })).toBe(0);
      // The runtime control still runs (and counts) when the side-effect half is all that's driven.
      const untripped = () => ({ loadsRenderer: false, ok: true, output: '' });
      expect(await main({ ...opts, importUnder: untripped, sideEffectImports: [] })).toBe(1);
    } finally {
      for (const s of quiet) s.mockRestore();
    }
  });

  it('main checks the default lists: 5 startup packages and 2 side-effect imports', async () => {
    const quiet = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {})
    ];
    try {
      // Every import "loads the renderer" (the control passes, each package fails) and every bundle registers nothing.
      const tripped = () => ({ loadsRenderer: true, ok: false, output: '' });
      const dropped = async () => ({ defined: [], ok: true, output: '' });
      expect(await main({ fixtures: [], importUnder: tripped, runSideEffect: dropped })).toBe(7);
    } finally {
      for (const s of quiet) s.mockRestore();
    }
  });

  it('cli exits 1 on failures or a crash, 0 when clean', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const codes = [];
      const exit = (c) => codes.push(c);
      await cli(async () => 2, exit);
      await cli(async () => 1, exit);
      await cli(async () => 0, exit);
      await cli(async () => {
        throw new Error('boom');
      }, exit);
      expect(codes).toEqual([1, 1, 0, 1]);
    } finally {
      quiet.mockRestore();
    }
  });

  it('childRun: only a clean exit is ok, and the output is stdout then stderr', () => {
    // A bundle that registers the tag and then throws must not pass.
    expect(childRun({ status: 1, stdout: 'DEFINED gcode-preview\n', stderr: 'Error: boom\n' })).toEqual({
      ok: false,
      output: 'DEFINED gcode-preview\nError: boom\n'
    });
    // Killed by a signal: status is null.
    expect(childRun({ status: null, signal: 'SIGTERM', stdout: 'DEFINED gcode-preview\n', stderr: '' })).toEqual({
      ok: false,
      output: 'DEFINED gcode-preview\n'
    });
    expect(childRun({ status: 0, stdout: 'a\n', stderr: 'b\n' })).toEqual({ ok: true, output: 'a\nb\n' });
    expect(childRun({ status: 0, stdout: null, stderr: undefined })).toEqual({ ok: true, output: '' });
  });

  it('a real bundle that registers the tag and then throws is not ok (the end-to-end S6 case)', async () => {
    const run = await runSideEffectBundle('test-defines-then-throws.mjs');
    expect(run.defined).toEqual(['gcode-preview']);
    expect(run.ok).toBe(false);
    expect(run.output).toContain('boom after define');
    expect(sideEffectVerdict({ specifier: 'x', defines: 'gcode-preview' }, run)).toHaveLength(1);
  }, 60_000);

  it('a real import that throws is not ok (importUnderHook)', () => {
    const run = importUnderHook('data:text/javascript,throw new Error("boom in import")');
    expect(run.ok).toBe(false);
    expect(run.loadsRenderer).toBe(false);
    expect(run.output).toContain('boom in import');
  });

  it('a bundle that cannot run fails, even if it printed the tag first', () => {
    const s = { specifier: 'pkg/define', defines: 'gcode-preview' };
    const crashed = { defined: ['gcode-preview'], ok: false, output: 'ReferenceError: window is not defined\n  at x' };
    expect(sideEffectVerdict(s, crashed)).toEqual([
      'pkg/define: the production bundle could not be run in Node: ReferenceError: window is not defined'
    ]);
  });
});
