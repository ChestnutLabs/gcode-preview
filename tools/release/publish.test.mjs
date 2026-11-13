// @vitest-environment node
// publish.mjs: the refusal guard, the --dry-run path, and (owner-approved, 2026-11-12) the non-dry
// branch's "already on the registry" skip and still-private stop, with every npm call stubbed.
//
// Every spawn goes through npmStub(): a logging npm stub first on PATH (proven to be what the child
// resolves before anything runs), a dead registry, and every token, OIDC and publish switch removed.
// The non-dry tests then set only GITHUB_ACTIONS=true and RELEASE_CONFIRM=publish, the two switches
// publish.mjs checks. No token, OIDC variable or .npmrc is set, read or exercised.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, isForbiddenPublishEnv, makeRepo, npmStub, pkg, read, runScript } from './testing/fixture.mjs';

// Child processes and git are slow on Windows runners; the default 5 s is too tight.
vi.setConfig({ testTimeout: 60_000 });
afterEach(cleanup);

// The dependency order publish.mjs walks (the 14 lockstep package directories).
const ORDER = [
  'toolpath-core',
  'gcode-colors',
  'gcode-dialects',
  'gcode-containers',
  'gcode-bgcode',
  'gcode-parser',
  'gcode-renderer-three',
  'gcode-renderer-2d',
  'gcode-model-renderer',
  'gcode-preview-core',
  'gcode-preview-vue',
  'gcode-preview-react',
  'gcode-preview-svelte',
  'gcode-preview-element'
];

// A fake scope: nothing here names a real package.
const nameOf = (dir) => `@release-tools-fake/${dir}`;

function repo({ privateDirs = [] } = {}) {
  const files = {};
  for (const dir of ORDER) {
    files[`packages/${dir}/package.json`] = pkg(nameOf(dir), '9.8.7', {
      ...(privateDirs.includes(dir) ? { private: true } : {}),
      dependencies: dir === 'gcode-parser' ? { '@chestnutlabs/toolpath-core': '9.8.7', lodash: '^4' } : {}
    });
  }
  return makeRepo(files);
}

describe('publish.mjs guard', () => {
  it('lists every credential, OIDC and publish switch as forbidden in the child env', () => {
    for (const k of [
      'NPM_TOKEN',
      'NODE_AUTH_TOKEN',
      'npm_config__authToken',
      'npm_config_//registry.npmjs.org/:_authToken',
      'ACTIONS_ID_TOKEN_REQUEST_URL',
      'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
      'GITHUB_ACTIONS',
      'RELEASE_CONFIRM'
    ]) {
      expect(isForbiddenPublishEnv(k)).toBe(true);
    }
    expect(isForbiddenPublishEnv('PATH')).toBe(false);
  });

  it('refuses a real publish outside the release workflow and runs no npm', () => {
    const root = repo();
    const stub = npmStub();
    const r = runScript(root, 'publish.mjs', [], stub.env);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('publish.mjs: refusing a real publish outside the protected release workflow');
    expect(stub.calls()).toEqual([]);
  });
});

describe('publish.mjs --dry-run', () => {
  it('dry-runs every package in dependency order with provenance and public access', () => {
    const root = repo();
    const stub = npmStub();
    const r = runScript(root, 'publish.mjs', ['--dry-run'], stub.env);
    expect(r.status).toBe(0);
    const calls = stub.calls();
    expect(calls.map((c) => c.name)).toEqual(ORDER.map(nameOf));
    for (const c of calls) {
      expect(c.argv).toEqual(['publish', '--access', 'public', '--provenance', '--dry-run']);
      expect(c.sawToken).toBe(false);
      expect(c.registry).toBe('http://127.0.0.1:9');
    }
  });

  it('strips private for the dry run only, and restores every manifest byte for byte', () => {
    const root = repo({ privateDirs: ['gcode-colors', 'gcode-preview-element'] });
    const before = ORDER.map((d) => read(root, `packages/${d}/package.json`));
    const stub = npmStub();
    const r = runScript(root, 'publish.mjs', ['--dry-run'], stub.env);
    expect(r.status).toBe(0);
    expect(stub.calls().every((c) => c.private === false)).toBe(true);
    expect(ORDER.map((d) => read(root, `packages/${d}/package.json`))).toEqual(before);
  });

  it('keeps going after a failed dry run, restores the manifest, and exits 1', () => {
    const root = repo({ privateDirs: ['gcode-parser'] });
    const before = read(root, 'packages/gcode-parser/package.json');
    const stub = npmStub({ fail: [nameOf('gcode-parser')] });
    const r = runScript(root, 'publish.mjs', ['--dry-run'], stub.env);
    expect(r.status).toBe(1);
    expect(stub.calls()).toHaveLength(ORDER.length);
    expect(r.stderr).toContain(`✗ ${nameOf('gcode-parser')}: publish --dry-run failed\n`);
    expect(read(root, 'packages/gcode-parser/package.json')).toBe(before);
    expect(r.stdout).not.toContain(`\`${nameOf('gcode-parser')}@9.8.7\``);
  });

  it('prints a summary row per package with files, size and exact internal deps', () => {
    const root = repo();
    const stub = npmStub();
    const r = runScript(root, 'publish.mjs', ['--dry-run'], stub.env);
    expect(r.status).toBe(0);
    expect(stub.calls()).toHaveLength(ORDER.length);
    expect(r.stdout).toContain('| Package | Files | Size | Internal deps (exact) |\n|---|--:|--:|---|\n');
    expect(r.stdout).toContain(`| \`${nameOf('toolpath-core')}@9.8.7\` | 3 | 1.5 kB | — |\n`);
    expect(r.stdout).toContain(
      `| \`${nameOf('gcode-parser')}@9.8.7\` | 3 | 1.5 kB | @chestnutlabs/toolpath-core@9.8.7 |\n`
    );
    expect(r.stderr).toContain(`✓ ${nameOf('toolpath-core')}@9.8.7 (3 files, 1.5 kB)\n`);
  });
});

describe('publish.mjs non-dry branch (stubbed npm)', () => {
  const real = (opts = {}) => npmStub({ realBranch: true, ...opts });
  const kinds = (calls) => calls.map((c) => `${c.argv[0]} ${c.name}`);

  it('needs both workflow switches: either one alone is refused before any npm call', () => {
    for (const drop of ['GITHUB_ACTIONS', 'RELEASE_CONFIRM']) {
      const root = repo();
      const stub = real();
      delete stub.env[drop];
      const r = runScript(root, 'publish.mjs', [], stub.env);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('refusing a real publish outside the protected release workflow');
      expect(stub.calls()).toEqual([]);
    }
    for (const [k, v] of [
      ['GITHUB_ACTIONS', '1'],
      ['RELEASE_CONFIRM', 'yes']
    ]) {
      const root = repo();
      const stub = real();
      stub.env[k] = v;
      expect(runScript(root, 'publish.mjs', [], stub.env).status).toBe(1);
      expect(stub.calls()).toEqual([]);
    }
  });

  it('checks the registry, then publishes every package in order without --dry-run', () => {
    const root = repo();
    const before = ORDER.map((d) => read(root, `packages/${d}/package.json`));
    const stub = real();
    const r = runScript(root, 'publish.mjs', [], stub.env);
    expect(r.status).toBe(0);
    const calls = stub.calls();
    expect(kinds(calls)).toEqual(ORDER.flatMap((d) => [`view ${nameOf(d)}`, `publish ${nameOf(d)}`]));
    for (const c of calls) {
      if (c.argv[0] === 'view') expect(c.argv).toEqual(['view', `${c.name}@9.8.7`, 'version']);
      else expect(c.argv).toEqual(['publish', '--access', 'public', '--provenance']);
      expect(c.sawToken).toBe(false);
      expect(c.registry).toBe('http://127.0.0.1:9');
    }
    expect(ORDER.map((d) => read(root, `packages/${d}/package.json`))).toEqual(before);
  });

  it('skips a package already on the registry at this version and publishes the rest', () => {
    const root = repo();
    const stub = real({ published: { [nameOf('toolpath-core')]: '', [nameOf('gcode-dialects')]: '' } });
    const r = runScript(root, 'publish.mjs', [], stub.env);
    expect(r.status).toBe(0);
    const calls = kinds(stub.calls());
    expect(calls.slice(0, 5)).toEqual([
      `view ${nameOf('toolpath-core')}`,
      `view ${nameOf('gcode-colors')}`,
      `publish ${nameOf('gcode-colors')}`,
      `view ${nameOf('gcode-dialects')}`,
      `view ${nameOf('gcode-containers')}`
    ]);
    expect(calls.filter((c) => c.startsWith('publish '))).toHaveLength(ORDER.length - 2);
    expect(r.stderr).toContain(`↷ ${nameOf('toolpath-core')}@9.8.7 already on the registry — skipping\n`);
    expect(r.stdout).not.toContain(`\`${nameOf('toolpath-core')}@9.8.7\``);
  });

  it('publishes when the registry has the package at another version', () => {
    const root = repo();
    const stub = real({ published: { [nameOf('toolpath-core')]: '9.8.6' } });
    const r = runScript(root, 'publish.mjs', [], stub.env);
    expect(r.status).toBe(0);
    expect(kinds(stub.calls()).slice(0, 2)).toEqual([
      `view ${nameOf('toolpath-core')}`,
      `publish ${nameOf('toolpath-core')}`
    ]);
    expect(r.stderr).not.toContain('already on the registry');
  });

  it('stops at a package that is still private, before checking or publishing it', () => {
    const root = repo({ privateDirs: ['gcode-parser'] });
    const stub = real();
    const r = runScript(root, 'publish.mjs', [], stub.env);
    expect(r.status).toBe(1);
    const upTo = ORDER.slice(0, ORDER.indexOf('gcode-parser'));
    expect(kinds(stub.calls())).toEqual(upTo.flatMap((d) => [`view ${nameOf(d)}`, `publish ${nameOf(d)}`]));
    expect(r.stderr).toContain(
      `✗ ${nameOf('gcode-parser')} is still private — the release phase removes the flag first.\n`
    );
    expect(read(root, 'packages/gcode-parser/package.json')).toContain('"private": true');
  });

  it('stops the line at the first failed publish', () => {
    const root = repo();
    const stub = real({ fail: [nameOf('gcode-colors')] });
    const r = runScript(root, 'publish.mjs', [], stub.env);
    expect(r.status).toBe(1);
    expect(kinds(stub.calls())).toEqual([
      `view ${nameOf('toolpath-core')}`,
      `publish ${nameOf('toolpath-core')}`,
      `view ${nameOf('gcode-colors')}`,
      `publish ${nameOf('gcode-colors')}`
    ]);
    expect(r.stderr).toContain(`✗ ${nameOf('gcode-colors')}: publish failed\n`);
    expect(r.stdout).toContain(`| \`${nameOf('toolpath-core')}@9.8.7\` | 3 | 1.5 kB | — |\n`);
  });
});
