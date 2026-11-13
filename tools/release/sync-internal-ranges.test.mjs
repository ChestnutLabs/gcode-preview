// @vitest-environment node
// Lockstep internal ranges, run as a child process against a fixture repo.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, makeRepo, pkg, read, runScript } from './testing/fixture.mjs';

// Child processes and git are slow on Windows runners; the default 5 s is too tight.
vi.setConfig({ testTimeout: 60_000 });
afterEach(cleanup);

function repo() {
  return makeRepo({
    'packages/core/package.json': pkg('@chestnutlabs/core', '3.1.0'),
    'packages/ui/package.json': pkg('@chestnutlabs/ui', '3.1.0', {
      dependencies: { '@chestnutlabs/core': '*', three: '^0.170.0' },
      devDependencies: { '@chestnutlabs/core': '3.0.0', vitest: '^4.0.0' },
      peerDependencies: { react: '>=18' }
    }),
    'packages/synced/package.json': pkg('@chestnutlabs/synced', '3.1.0', {
      dependencies: { '@chestnutlabs/core': '3.1.0' }
    }),
    'packages/notes/README.md': 'not a package\n'
  });
}

const run = (root, args = []) => runScript(root, 'sync-internal-ranges.mjs', args);

describe('sync-internal-ranges', () => {
  it('pins internal dependency and devDependency ranges to the exact sibling version', () => {
    const root = repo();
    const synced = read(root, 'packages/synced/package.json');
    const r = run(root);
    expect(r.status).toBe(0);
    // The exact output format: 2-space JSON plus a trailing newline; other ranges untouched.
    expect(read(root, 'packages/ui/package.json')).toBe(
      JSON.stringify(
        pkg('@chestnutlabs/ui', '3.1.0', {
          dependencies: { '@chestnutlabs/core': '3.1.0', three: '^0.170.0' },
          devDependencies: { '@chestnutlabs/core': '3.1.0', vitest: '^4.0.0' },
          peerDependencies: { react: '>=18' }
        }),
        null,
        2
      ) + '\n'
    );
    expect(read(root, 'packages/synced/package.json')).toBe(synced);
    expect(r.stderr).toContain('@chestnutlabs/ui: dependencies.@chestnutlabs/core * -> 3.1.0\n');
    expect(r.stderr).toContain('@chestnutlabs/ui: devDependencies.@chestnutlabs/core 3.0.0 -> 3.1.0\n');
    expect(r.stderr).toContain('sync-internal-ranges: 1 manifest(s) updated\n');
  });

  it('with --check, writes nothing and exits 1 when out of sync', () => {
    const root = repo();
    const before = read(root, 'packages/ui/package.json');
    const r = run(root, ['--check']);
    expect(r.status).toBe(1);
    expect(read(root, 'packages/ui/package.json')).toBe(before);
    expect(r.stderr).toContain('sync-internal-ranges: 1 manifest(s) OUT OF SYNC');
  });

  it('with --check, exits 0 once in sync', () => {
    const root = repo();
    expect(run(root).status).toBe(0);
    const r = run(root, ['--check']);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('sync-internal-ranges: in sync\n');
  });

  it('a second run changes nothing', () => {
    const root = repo();
    run(root);
    const r = run(root);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('sync-internal-ranges: 0 manifest(s) updated\n');
  });
});
