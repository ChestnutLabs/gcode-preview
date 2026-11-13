// @vitest-environment node
// publish.mjs: ONLY the refusal guard and the --dry-run path.
//
// The real-publish branch (the "already on the registry" skip, the still-private stop) is NOT driven
// here, even with npm stubbed: this suite runs inside release-publish.yml, where real publish
// credentials are present, so exercising that branch is an owner security-boundary decision.
//
// Every spawn goes through npmStub(): a logging npm stub first on PATH (proven to be what the child
// resolves before anything runs), a dead registry, and every token, OIDC and publish switch removed.
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
    expect(r.stdout).toContain(`| \`${nameOf('gcode-parser')}@9.8.7\` | 3 | 1.5 kB | @chestnutlabs/toolpath-core@9.8.7 |\n`);
    expect(r.stderr).toContain(`✓ ${nameOf('toolpath-core')}@9.8.7 (3 files, 1.5 kB)\n`);
  });
});
