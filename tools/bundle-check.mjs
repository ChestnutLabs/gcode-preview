/*
 * DD-014 D4 bundle gate: a 2D-only app must not ship three.js at startup.
 *
 * The core controller loads the 3D renderer on demand (`import('@chestnutlabs/gcode-renderer-three')`).
 * That only works while nothing on the startup path value-imports the renderer's MAIN entry: a bundler
 * cannot split one module between a startup chunk and a lazy chunk, so one static value import puts all
 * of three.js (about 600 KB minified) in the startup bundle (it did from v0.18.0 to v0.23.0). Static
 * imports go through the three-free `@chestnutlabs/gcode-renderer-three/lite` entry instead.
 *
 * For each fixture in tools/bundle-check/fixtures (core plus the four adapters' main entries), bundle the
 * built dists with the repo's Vite (rolldown) and with esbuild, then require:
 *   - no three.js module in any chunk loaded at startup (the entry chunks plus their static imports);
 *   - three.js present in a lazy chunk, so the check cannot pass vacuously (e.g. a fixture that never
 *     reaches the 3D loader, or a bundler that dropped the dynamic import);
 *   - at least one startup chunk, for the same reason (a bundler API change that hides the entry flag
 *     would otherwise count every chunk, three included, as lazy).
 *
 * Then, at RUNTIME, import each startup package's built entry in Node with a resolve hook
 * (tools/bundle-check/startup-hook.mjs) that throws if the renderer's main entry is resolved, calling
 * nothing. That catches an eager import() of any shape (an IIFE, a promise chain, an `if` block, a
 * template-literal specifier), which the bundle check can't see because any import() makes a lazy chunk.
 * A control import of the main entry must trip the hook, so the runtime check can't pass vacuously.
 *
 * Needs the package dists (run after the package builds, as in `npm run gate -- --ci`).
 * Usage:  node tools/bundle-check.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const fixturesDir = path.join(__dirname, 'bundle-check', 'fixtures');

/** Framework runtimes are the consumer's own; leave them out so the bundles hold only our code and three. */
export const EXTERNAL = ['react', 'react-dom', 'react/jsx-runtime', 'vue', 'svelte', /^svelte\//];

/** True for a module id inside the `three` package (either path separator). */
export function isThreeModule(id) {
  return /[\\/]node_modules[\\/]three[\\/]/.test(id);
}

/**
 * The chunks loaded at startup: every entry chunk plus everything it reaches through STATIC imports.
 * `chunks` is `[{ name, isEntry, staticImports: string[], threeBytes: number, bytes?: number }]`.
 */
export function startupChunks(chunks) {
  const byName = new Map(chunks.map((c) => [c.name, c]));
  const seen = new Set();
  const queue = chunks.filter((c) => c.isEntry).map((c) => c.name);
  while (queue.length > 0) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    const chunk = byName.get(name);
    if (chunk === undefined) continue; // an external or an asset, not a chunk of ours
    seen.add(name);
    queue.push(...chunk.staticImports);
  }
  return seen;
}

/** Split the three.js bytes into those loaded at startup and those in lazy chunks; count the startup chunks. */
export function threeSplit(chunks) {
  const startup = startupChunks(chunks);
  let startupThree = 0;
  let lazyThree = 0;
  let startupBytes = 0;
  for (const c of chunks) {
    if (startup.has(c.name)) {
      startupThree += c.threeBytes;
      startupBytes += c.bytes ?? 0;
    } else lazyThree += c.threeBytes;
  }
  return { startupThree, lazyThree, startupBytes, startupChunks: startup.size };
}

/** The verdict for one fixture under one bundler: a list of problems (empty = pass). */
export function verdict({ startupThree, lazyThree, startupChunks: startupCount }) {
  const problems = [];
  if (startupCount === 0) {
    problems.push('no entry chunk found (the bundle output is not understood, so the check is vacuous)');
  }
  if (startupThree > 0) problems.push(`${startupThree} bytes of three.js load at startup (want 0)`);
  if (lazyThree === 0) problems.push('no three.js in any lazy chunk (the 3D load is missing, so the check is vacuous)');
  return problems;
}

/** The packages whose startup path must not load the renderer's main entry. */
export const STARTUP_PACKAGES = [
  '@chestnutlabs/gcode-preview-core',
  '@chestnutlabs/gcode-preview-react',
  '@chestnutlabs/gcode-preview-vue',
  '@chestnutlabs/gcode-preview-svelte',
  '@chestnutlabs/gcode-preview-element'
];

/**
 * Import `specifier` in a fresh Node process under the startup hook, calling nothing. The element defines a
 * custom element at import time, so `HTMLElement` and `customElements` are stubbed. Returns
 * `{ loadsRenderer, ok, output }`: `loadsRenderer` means the hook fired.
 */
export function importUnderHook(specifier) {
  const hook = pathToFileURL(path.join(__dirname, 'bundle-check', 'startup-hook.mjs')).href;
  const script =
    'globalThis.HTMLElement ??= class {};' +
    'globalThis.customElements ??= { define() {}, get() { return undefined; } };' +
    `await import(${JSON.stringify(specifier)});`;
  const r = spawnSync(process.execPath, ['--import', hook, '--input-type=module', '-e', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, BUNDLE_CHECK_HOOK_LOADED: '' }
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { loadsRenderer: output.includes('STARTUP-LOADS-RENDERER'), ok: r.status === 0, output };
}

/** The runtime verdict for one package: a list of problems (empty = pass). */
export function runtimeVerdict(specifier, { loadsRenderer, ok, output }) {
  if (loadsRenderer) return [`${specifier}: importing it loads the renderer's main entry (three.js) at startup`];
  if (!ok) return [`${specifier}: could not be imported in Node: ${output.trim().split('\n')[0]}`];
  return [];
}

/** The control import of the renderer main entry MUST trip the hook; if not, the runtime check is vacuous. */
export function controlVerdict({ loadsRenderer }) {
  return loadsRenderer
    ? []
    : ['runtime control: importing the renderer main entry did not trip the hook (the check is vacuous)'];
}

async function viteChunks(entry) {
  const { build } = await import(pathToFileURL(path.join(repoRoot, 'node_modules/vite/dist/node/index.js')).href);
  const result = await build({
    configFile: false,
    logLevel: 'error',
    root: path.dirname(entry),
    build: {
      write: false,
      minify: true,
      rollupOptions: { input: entry, external: EXTERNAL, preserveEntrySignatures: 'strict' }
    }
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
  return outputs
    .filter((o) => o.type === 'chunk')
    .map((o) => ({
      name: o.fileName,
      isEntry: o.isEntry,
      staticImports: o.imports,
      bytes: o.code.length,
      threeBytes: Object.entries(o.modules)
        .filter(([id]) => isThreeModule(id))
        .reduce((sum, [, m]) => sum + m.renderedLength, 0)
    }));
}

async function esbuildChunks(entry) {
  const esbuild = await import(pathToFileURL(path.join(repoRoot, 'node_modules/esbuild/lib/main.js')).href);
  const result = await (esbuild.build ?? esbuild.default.build)({
    entryPoints: [entry],
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    minify: true,
    write: false,
    metafile: true,
    outdir: path.join(fixturesDir, 'out'),
    external: ['react', 'react-dom', 'vue', 'svelte', 'svelte/*'],
    logLevel: 'error'
  });
  return Object.entries(result.metafile.outputs)
    .filter(([name]) => name.endsWith('.js'))
    .map(([name, o]) => ({
      name,
      isEntry: o.entryPoint !== undefined && path.resolve(repoRoot, o.entryPoint) === path.resolve(entry),
      staticImports: o.imports.filter((i) => i.kind === 'import-statement' && !i.external).map((i) => i.path),
      bytes: o.bytes,
      threeBytes: Object.entries(o.inputs)
        .filter(([id]) => isThreeModule(path.resolve(repoRoot, id)))
        .reduce((sum, [, v]) => sum + v.bytesInOutput, 0)
    }));
}

async function main() {
  const fixtures = fs
    .readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.mjs'))
    .sort();
  let failed = 0;
  for (const f of fixtures) {
    const entry = path.join(fixturesDir, f);
    for (const [bundler, run] of [
      ['vite', viteChunks],
      ['esbuild', esbuildChunks]
    ]) {
      const split = threeSplit(await run(entry));
      const problems = verdict(split);
      const tag = `${f} [${bundler}]`;
      if (problems.length === 0) {
        console.log(`ok   ${tag}: startup ${split.startupBytes} B with no three.js, lazy three ${split.lazyThree} B`);
      } else {
        failed++;
        for (const p of problems) console.error(`FAIL ${tag}: ${p}`);
      }
    }
  }
  // Runtime half: the control must trip the hook, then no startup package may.
  for (const p of controlVerdict(importUnderHook('@chestnutlabs/gcode-renderer-three'))) {
    failed++;
    console.error(`FAIL ${p}`);
  }
  for (const pkg of STARTUP_PACKAGES) {
    const problems = runtimeVerdict(pkg, importUnderHook(pkg));
    if (problems.length === 0) console.log(`ok   ${pkg} [runtime]: importing it loads no renderer main entry`);
    else {
      failed++;
      for (const p of problems) console.error(`FAIL ${p}`);
    }
  }
  if (failed > 0) {
    console.error(
      `\nbundle-check: ${failed} failure(s). A static value import of '@chestnutlabs/gcode-renderer-three'`
    );
    console.error(
      "pulls three.js into startup; import three-free pieces from '@chestnutlabs/gcode-renderer-three/lite'."
    );
    process.exit(1);
  }
  console.log(
    `\nbundle-check: ${fixtures.length} fixtures x 2 bundlers and ${STARTUP_PACKAGES.length} packages at runtime, no three.js at startup.`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
