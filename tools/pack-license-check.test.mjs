import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkRoot, copyProblems, listProblems, manifestProblems, publishablePackages } from './pack-license-check.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'tools', 'pack-license-check.mjs');
const scratch = [];
// Each CLI case boots npm (slow on Windows); the real-repo case packs all fourteen packages.
const NPM_MS = 90_000;

const LICENSE = 'MIT License\n\nCopyright (c) 2017-2025 Remco Veldkamp\n';
const NOTICE = '# NOTICE\n\nCopyright (c) 2026 Chestnut Labs\n';

/** A two-package workspace in a temp dir, each package shaped like the real ones. */
function makeRepo(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packlic-'));
  scratch.push(root);
  fs.writeFileSync(path.join(root, 'LICENSE'), LICENSE);
  fs.writeFileSync(path.join(root, 'NOTICE.md'), NOTICE);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'ws', version: '0.0.0', private: true, workspaces: ['packages/*'] })
  );
  for (const name of ['alpha', 'beta']) {
    const dir = path.join(root, 'packages', name);
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dist', 'index.js'), 'export {};\n');
    fs.writeFileSync(path.join(dir, 'LICENSE'), LICENSE);
    fs.writeFileSync(path.join(dir, 'NOTICE.md'), NOTICE);
    const manifest = {
      name: `@chestnutlabs/${name}`,
      version: '0.0.1',
      files: ['dist', 'LICENSE', 'NOTICE.md'],
      ...(overrides[name]?.manifest ?? {})
    };
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
    for (const [file, content] of Object.entries(overrides[name]?.files ?? {})) {
      if (content === null) fs.rmSync(path.join(dir, file));
      else fs.writeFileSync(path.join(dir, file), content);
    }
  }
  return root;
}

function runCli(root) {
  const r = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' });
  return { code: r.status, err: r.stderr };
}

afterEach(() => {
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('listProblems', () => {
  const pkgs = [{ name: '@chestnutlabs/a' }];
  const entry = (files) => ({ name: '@chestnutlabs/a', files: files.map((p) => ({ path: p })) });

  it('passes when LICENSE and NOTICE.md are both listed', () => {
    expect(listProblems(pkgs, [entry(['dist/x.js', 'LICENSE', 'NOTICE.md', 'package.json'])])).toEqual([]);
  });

  it('names the missing file', () => {
    expect(listProblems(pkgs, [entry(['dist/x.js', 'NOTICE.md'])])).toEqual([
      '@chestnutlabs/a: tarball does not list LICENSE (add it to "files" and the package dir)'
    ]);
    expect(listProblems(pkgs, [entry(['dist/x.js', 'LICENSE'])])).toEqual([
      '@chestnutlabs/a: tarball does not list NOTICE.md (add it to "files" and the package dir)'
    ]);
  });

  it('does not accept a look-alike path (a nested or differently-cased file)', () => {
    expect(listProblems(pkgs, [entry(['dist/LICENSE', 'docs/NOTICE.md', 'license', 'NOTICE.MD'])])).toHaveLength(2);
  });

  it('fails a package npm did not report at all', () => {
    expect(listProblems(pkgs, [])).toEqual(['@chestnutlabs/a: npm pack reported no result for this package']);
  });
});

describe('manifestProblems', () => {
  it('names each file `files` does not list, and treats a missing `files` as listing nothing', () => {
    expect(manifestProblems([{ name: 'p', files: ['dist', 'LICENSE', 'NOTICE.md'] }])).toEqual([]);
    expect(manifestProblems([{ name: 'p', files: ['dist', 'NOTICE.md'] }])).toEqual([
      'p: package.json "files" does not name LICENSE'
    ]);
    expect(manifestProblems([{ name: 'p', files: ['dist', 'LICENSE'] }])).toEqual([
      'p: package.json "files" does not name NOTICE.md'
    ]);
    expect(manifestProblems([{ name: 'p' }])).toHaveLength(2);
  });
});

describe('checkRoot', () => {
  it('refuses a root with no publishable packages instead of passing vacuously', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packlic-'));
    scratch.push(root);
    fs.mkdirSync(path.join(root, 'packages'));
    expect(checkRoot(root)).toEqual(['no publishable packages found (is --root the repo root?)']);
  });
});

describe('copyProblems', () => {
  it('passes when the copies equal the root files', () => {
    const root = makeRepo();
    expect(copyProblems(root, publishablePackages(root))).toEqual([]);
  });

  it('fails a copy that differs, an empty copy, and a missing copy', () => {
    const root = makeRepo({
      alpha: { files: { LICENSE: 'MIT License\n' } },
      beta: { files: { 'NOTICE.md': '' } }
    });
    expect(copyProblems(root, publishablePackages(root))).toEqual([
      "@chestnutlabs/alpha: LICENSE differs from the repo root's LICENSE",
      "@chestnutlabs/beta: NOTICE.md differs from the repo root's NOTICE.md"
    ]);
    fs.rmSync(path.join(root, 'packages', 'alpha', 'NOTICE.md'));
    expect(copyProblems(root, publishablePackages(root))).toContain(
      '@chestnutlabs/alpha: NOTICE.md is missing from the package directory'
    );
  });

  it('fails when the repo root has no LICENSE', () => {
    const root = makeRepo();
    fs.rmSync(path.join(root, 'LICENSE'));
    expect(copyProblems(root, publishablePackages(root))).toEqual(['repo root has no LICENSE']);
  });
});

describe('publishablePackages', () => {
  it('skips private packages and finds the rest by walking', () => {
    const root = makeRepo({ beta: { manifest: { private: true } } });
    expect(publishablePackages(root).map((p) => p.name)).toEqual(['@chestnutlabs/alpha']);
  });
});

describe('the CLI against a real `npm pack --dry-run`', () => {
  it(
    'passes a repo whose packages ship both files',
    () => {
      const { code, err } = runCli(makeRepo());
      expect(err).toContain('pack-license-check: OK (2 packages');
      expect(code).toBe(0);
    },
    NPM_MS
  );

  it(
    'FAILS when a package `files` drops LICENSE',
    () => {
      // The package dir still holds LICENSE and npm auto-adds a package-local LICENSE, so the packed
      // list alone stays green: the manifest check is what catches this one.
      const root = makeRepo({ alpha: { manifest: { files: ['dist', 'NOTICE.md'] } } });
      const { code, err } = runCli(root);
      expect(code).toBe(1);
      expect(err).toContain('@chestnutlabs/alpha: package.json "files" does not name LICENSE');
      expect(err).not.toContain('tarball does not list');
      expect(err).not.toContain('beta');
    },
    NPM_MS
  );

  it(
    'FAILS when a package has no LICENSE in its directory (npm cannot ship what is not there)',
    () => {
      const root = makeRepo({ beta: { files: { LICENSE: null } } });
      const { code, err } = runCli(root);
      expect(code).toBe(1);
      expect(err).toContain('@chestnutlabs/beta: tarball does not list LICENSE');
      expect(err).toContain('@chestnutlabs/beta: LICENSE is missing from the package directory');
    },
    NPM_MS
  );

  it(
    'FAILS when `files` is back to dist only (the 0.20.1 shape) and the package dir has no copies',
    () => {
      const root = makeRepo({
        alpha: { manifest: { files: ['dist'] }, files: { LICENSE: null, 'NOTICE.md': null } }
      });
      const { code, err } = runCli(root);
      expect(code).toBe(1);
      expect(err).toContain('@chestnutlabs/alpha: tarball does not list LICENSE');
      expect(err).toContain('@chestnutlabs/alpha: tarball does not list NOTICE.md');
    },
    NPM_MS
  );

  it(
    'FAILS a drifted copy even though the tarball lists it',
    () => {
      const root = makeRepo({ alpha: { files: { 'NOTICE.md': '# stale\n' } } });
      const { code, err } = runCli(root);
      expect(code).toBe(1);
      expect(err).toContain("NOTICE.md differs from the repo root's NOTICE.md");
    },
    NPM_MS
  );
});

describe('this repository', () => {
  it(
    'every publishable package ships LICENSE and NOTICE.md',
    () => {
      expect(checkRoot(repoRoot)).toEqual([]);
    },
    NPM_MS
  );

  it('covers all fourteen packages', () => {
    expect(publishablePackages(repoRoot)).toHaveLength(14);
  });
});
