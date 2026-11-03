// @vitest-environment node
/**
 * Pins the flat ESLint config (eslint.config.mjs) to the rules the old ESLint 8 `.eslintrc.js` setup
 * enforced (#445). The ESLint 8 effective rules are frozen in lint-config.eslint8-baseline.json; the only
 * allowed differences are listed literally below. Changing a lint rule on purpose means updating the
 * baseline (or the lists here) in the same PR.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { builtinRules } from 'eslint/use-at-your-own-risk';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tools', 'lint-config.eslint8-baseline.json'), 'utf8'));
const eslint = new ESLint({ cwd: repoRoot });

// ESLint 9/10 upstream changes to `eslint:recommended` (not ours).
const REMOVED_UPSTREAM = ['no-extra-semi', 'no-inner-declarations', 'no-mixed-spaces-and-tabs', 'no-new-symbol'];
const ADDED_UPSTREAM = [
  'no-constant-binary-expression',
  'no-empty-static-block',
  'no-unassigned-vars',
  'no-unused-private-class-members',
  'no-useless-assignment',
  'preserve-caught-error'
];
// no-new-symbol's successor, switched on wherever no-new-symbol was.
const SUCCESSOR = { 'no-new-symbol': 'no-new-native-nonconstructor' };
// src/**/*.ts now follows the typescript-eslint preset like every other TS file: the core rules the old
// src/.eslintrc.js switched back on (and that misfire on TS syntax under ESLint 10) stay off there.
const SRC_TS_CORE_OFF = [
  'constructor-super',
  'getter-return',
  'no-class-assign',
  'no-const-assign',
  'no-dupe-args',
  'no-dupe-class-members',
  'no-dupe-keys',
  'no-func-assign',
  'no-import-assign',
  'no-new-symbol',
  'no-obj-calls',
  'no-redeclare',
  'no-setter-return',
  'no-this-before-super',
  'no-undef',
  'no-unreachable',
  'no-unsafe-negation',
  'no-unused-vars',
  'no-with'
];

const defaults = {};
for (const [name, rule] of builtinRules) defaults[name] = rule.meta?.defaultOptions;
for (const [name, rule] of Object.entries(tseslint.plugin.rules)) {
  defaults[`@typescript-eslint/${name}`] = rule.meta?.defaultOptions;
}

const SEVERITY = { off: 0, warn: 1, error: 2 };
/** Severity as a number, options dropped when they equal the rule's defaults, off rules dropped. */
function normalize(rules) {
  const out = {};
  for (const [name, value] of Object.entries(rules ?? {})) {
    const entry = Array.isArray(value) ? [...value] : [value];
    entry[0] = SEVERITY[entry[0]] ?? entry[0];
    if (entry[0] === 0) continue;
    const opts = entry.slice(1);
    if (opts.length > 0 && JSON.stringify(opts) === JSON.stringify((defaults[name] ?? []).slice(0, opts.length))) {
      entry.length = 1;
    }
    out[name] = entry;
  }
  return out;
}

function expectedFor(sample) {
  const rules = { ...baseline.common, ...baseline.paths[sample] };
  if (/^src\/.*\.ts$/.test(sample)) for (const name of SRC_TS_CORE_OFF) delete rules[name];
  for (const [old, next] of Object.entries(SUCCESSOR)) if (rules[old]) rules[next] = rules[old];
  for (const name of REMOVED_UPSTREAM) delete rules[name];
  for (const name of ADDED_UPSTREAM) rules[name] = [2];
  return Object.fromEntries(Object.entries(rules).sort(([a], [b]) => (a < b ? -1 : 1)));
}

const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));

describe('flat ESLint config keeps the ESLint 8 rule set', () => {
  it('covers one sample path per old override block', () => {
    expect(Object.keys(baseline.paths)).toHaveLength(27);
  });

  for (const sample of Object.keys(baseline.paths)) {
    it(sample, async () => {
      const config = await eslint.calculateConfigForFile(sample);
      expect(sorted(normalize(config.rules))).toEqual(expectedFor(sample));
    });
  }
});

describe('flat ESLint config globals and ignores', () => {
  const globalsOf = async (file) => (await eslint.calculateConfigForFile(file)).languageOptions.globals ?? {};
  const on = (g, name) => name in g && g[name] !== 'off';

  it('browser globals everywhere by default', async () => {
    const g = await globalsOf('tools/demo/src/main.js');
    expect([on(g, 'window'), on(g, 'process')]).toEqual([true, false]);
  });

  it('node + browser globals for node-side .mjs scripts and src/babel.config.js', async () => {
    for (const file of [
      'rollup.config.mjs',
      'tools/benchmark/parse-bench.mjs',
      'tools/screenshots/capture.mjs',
      'packages/gcode-preview-svelte/copy-svelte.mjs',
      'packages/gcode-containers/fuzz/limits.mjs',
      'src/babel.config.js'
    ]) {
      const g = await globalsOf(file);
      expect([file, on(g, 'process'), on(g, 'window')]).toEqual([file, true, true]);
    }
  });

  it('node-only globals (browser off) for release tooling and the Electron main process', async () => {
    for (const file of ['tools/release/publish.mjs', 'tools/consumer-smoke/electron-app/main.js']) {
      const g = await globalsOf(file);
      expect([file, on(g, 'process'), on(g, 'window')]).toEqual([file, true, false]);
    }
    const electron = await eslint.calculateConfigForFile('tools/consumer-smoke/electron-app/main.js');
    expect(electron.languageOptions.sourceType).toBe('commonjs');
  });

  it('ignores build output, dot-dirs, and nested node_modules, but lints tools .mjs', async () => {
    const ignored = {};
    for (const file of [
      'dist/a.js',
      'packages/toolpath-core/dist/a.js',
      'docs-site/a.js',
      'docs-api/a.js',
      '.claude/worktrees/x/src/a.ts',
      '.changeset/a.js',
      '.github/a.js',
      'tools/svelte-compat/svelte4/node_modules/svelte/a.mjs',
      'tools/svelte-compat/check.mjs',
      'eslint.config.mjs'
    ]) {
      ignored[file] = await eslint.isPathIgnored(file);
    }
    expect(ignored).toEqual({
      'dist/a.js': true,
      'packages/toolpath-core/dist/a.js': true,
      'docs-site/a.js': true,
      'docs-api/a.js': true,
      '.claude/worktrees/x/src/a.ts': true,
      '.changeset/a.js': true,
      '.github/a.js': true,
      'tools/svelte-compat/svelte4/node_modules/svelte/a.mjs': true,
      'tools/svelte-compat/check.mjs': false,
      'eslint.config.mjs': false
    });
  });
});
