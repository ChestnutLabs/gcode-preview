import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runtimeDepProblems } from './check-no-runtime-deps.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'tools', 'check-no-runtime-deps.mjs');
const scratch = [];

/** A workspace in a temp dir with one package per entry of `manifests` (dir name -> manifest fields). */
function makeRepo(manifests) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noruntimedeps-'));
  scratch.push(root);
  for (const [dir, fields] of Object.entries(manifests)) {
    fs.mkdirSync(path.join(root, 'packages', dir), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'packages', dir, 'package.json'),
      JSON.stringify({ name: `@chestnutlabs/${dir}`, version: '0.0.1', ...fields })
    );
  }
  fs.mkdirSync(path.join(root, 'packages', 'not-a-package'), { recursive: true }); // no manifest: skipped
  fs.writeFileSync(path.join(root, 'packages', 'README.md'), '# not a package\n'); // a plain file: skipped
  return root;
}

afterEach(() => {
  while (scratch.length) fs.rmSync(scratch.pop(), { recursive: true, force: true });
});

describe('runtimeDepProblems', () => {
  it('passes sibling deps, and ignores peer and dev deps', () => {
    const root = makeRepo({
      alpha: {
        dependencies: { '@chestnutlabs/beta': '0.0.1' },
        optionalDependencies: { '@chestnutlabs/gamma': '0.0.1' },
        peerDependencies: { three: '>=0.160.0', svelte: '^4.0.0 || ^5.0.0' },
        devDependencies: { 'left-pad': '1.0.0' }
      },
      beta: {}
    });
    expect(runtimeDepProblems(root)).toEqual([]);
  });

  it('names the package, the field and the dependency for each third-party runtime dep', () => {
    const root = makeRepo({
      alpha: { dependencies: { '@chestnutlabs/beta': '0.0.1', 'left-pad': '1.0.0' } },
      beta: { optionalDependencies: { fsevents: '^2.3.0' } },
      // A look-alike scope is still third-party.
      gamma: { dependencies: { '@chestnutlabsx/evil': '1.0.0' } }
    });
    expect(runtimeDepProblems(root).sort()).toEqual([
      '@chestnutlabs/alpha (packages/alpha/package.json): third-party dependencies entry "left-pad": "1.0.0"',
      '@chestnutlabs/beta (packages/beta/package.json): third-party optionalDependencies entry "fsevents": "^2.3.0"',
      '@chestnutlabs/gamma (packages/gamma/package.json): third-party dependencies entry "@chestnutlabsx/evil": "1.0.0"'
    ]);
  });
});

describe('check-no-runtime-deps CLI', () => {
  it('exits 1 and prints the offender', () => {
    const root = makeRepo({ alpha: { dependencies: { 'left-pad': '1.0.0' } } });
    const run = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('"left-pad": "1.0.0"');
  });

  it('passes on the real repository', () => {
    const run = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
  });
});
