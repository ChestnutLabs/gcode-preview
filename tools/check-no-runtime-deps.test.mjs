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

/**
 * A workspace in a temp dir with one package per entry of `manifests` (dir name -> manifest fields;
 * the package name defaults to `@chestnutlabs/<dir>`). Stray entries without a manifest are skipped.
 */
function makeRepo(manifests, strays = ['not-a-package']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noruntimedeps-'));
  scratch.push(root);
  for (const [dir, fields] of Object.entries(manifests)) {
    fs.mkdirSync(path.join(root, 'packages', dir), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'packages', dir, 'package.json'),
      JSON.stringify({ name: `@chestnutlabs/${dir}`, version: '0.0.1', ...fields })
    );
  }
  for (const stray of strays) fs.mkdirSync(path.join(root, 'packages', stray), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'README.md'), '# not a package\n'); // a plain file: skipped
  return root;
}

afterEach(() => {
  while (scratch.length) fs.rmSync(scratch.pop(), { recursive: true, force: true });
});

describe('runtimeDepProblems', () => {
  it('passes sibling deps with plain versions, the allowed peers, and ignores dev deps', () => {
    const root = makeRepo({
      alpha: {
        dependencies: { '@chestnutlabs/beta': '0.0.1' },
        optionalDependencies: { '@chestnutlabs/beta': '^0.0.1' },
        peerDependencies: { three: '>=0.160.0', vue: '^3.4.0', react: '^18 || ^19', svelte: '^4.0.0 || ^5.0.0' },
        devDependencies: { 'left-pad': '1.0.0' }
      },
      beta: {}
    });
    expect(runtimeDepProblems(root)).toEqual([]);
  });

  it('names the package, field and dependency, in name-sorted order, past a manifest-less dir that sorts first', () => {
    // `_0-stray` sorts first by localeCompare (an early exit there would hide every package), and
    // `_zeta` sorts before `alpha` by localeCompare but after it in NTFS readdir order.
    const root = makeRepo(
      {
        alpha: { dependencies: { '@chestnutlabs/_zeta': '0.0.1', 'left-pad': '1.0.0' } },
        _zeta: {
          optionalDependencies: { fsevents: '^2.3.0' },
          // A look-alike scope is still third-party.
          dependencies: { '@chestnutlabsx/evil': '1.0.0' }
        }
      },
      ['_0-stray']
    );
    expect(runtimeDepProblems(root)).toEqual([
      '@chestnutlabs/_zeta (packages/_zeta/package.json): dependencies entry "@chestnutlabsx/evil": "1.0.0" is not a workspace sibling package',
      '@chestnutlabs/_zeta (packages/_zeta/package.json): optionalDependencies entry "fsevents": "^2.3.0" is not a workspace sibling package',
      '@chestnutlabs/alpha (packages/alpha/package.json): dependencies entry "left-pad": "1.0.0" is not a workspace sibling package'
    ]);
  });

  it('fails an @chestnutlabs name that no packages/* manifest declares', () => {
    const root = makeRepo({ alpha: { dependencies: { '@chestnutlabs/ghost': '0.0.1' } } });
    expect(runtimeDepProblems(root)).toEqual([
      '@chestnutlabs/alpha (packages/alpha/package.json): dependencies entry "@chestnutlabs/ghost": "0.0.1" is not a workspace sibling package'
    ]);
  });

  it('fails a sibling name whose spec is an alias, git, URL or local path', () => {
    const specs = [
      'npm:left-pad@1',
      'git+https://example.com/x.git',
      'git://example.com/x.git',
      'github:someone/x',
      'https://example.com/x.tgz',
      'http://example.com/x.tgz',
      'file:../beta',
      'link:../beta'
    ];
    for (const spec of specs) {
      const root = makeRepo({ alpha: { dependencies: { '@chestnutlabs/beta': spec } }, beta: {} });
      expect(runtimeDepProblems(root)).toEqual([
        `@chestnutlabs/alpha (packages/alpha/package.json): dependencies entry "@chestnutlabs/beta": "${spec}" must be a plain version, not an alias or URL`
      ]);
    }
  });

  it('fails a peer that is not on the allow-list and names the package', () => {
    const root = makeRepo({ alpha: { peerDependencies: { vue: '^3.4.0', lodash: '^4.17.0' } } });
    expect(runtimeDepProblems(root)).toEqual([
      '@chestnutlabs/alpha (packages/alpha/package.json): peerDependencies entry "lodash": "^4.17.0" is not an allowed peer; a new peer needs review'
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
