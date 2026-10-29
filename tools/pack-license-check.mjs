/*
 * Licence-text gate for the published tarballs (ChestnutLabs/AnyBridge#2765, owner ruling 6a).
 *
 * The 0.20.1 tarballs shipped with `files: ["dist"]`, so none of them carried the MIT notice for the
 * inherited remcoder/gcode-preview code. npm adds a package-local LICENSE on its own, but NOTICE.md
 * only ships when `files` names it, and neither is found at the repo root. So for EVERY publishable
 * workspace package this asserts, from `npm pack --dry-run --json` (the list npm would really upload):
 *
 *   (1) the tarball lists LICENSE and NOTICE.md;
 *   (2) the package's own LICENSE / NOTICE.md are byte-identical to the repo root's, so a copy that
 *       drifted (or an empty placeholder) cannot ship as the notice.
 *
 * It needs no build: the legal files are not build output, and `--ignore-scripts` keeps `prepare`
 * (toolpath-core builds there) from running. Run before any publish; CI runs it first in the gate.
 *
 * Usage:  node tools/pack-license-check.mjs [--root <repo-dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const REQUIRED_FILES = ['LICENSE', 'NOTICE.md'];

/** The publishable (non-private) workspace packages under `<root>/packages`, found by walking. */
export function publishablePackages(root) {
  const packagesDir = path.join(root, 'packages');
  const found = [];
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    const manifest = path.join(packagesDir, entry.name, 'package.json');
    if (!entry.isDirectory() || !fs.existsSync(manifest)) continue;
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    if (pkg.private === true) continue;
    found.push({ name: pkg.name, dir: path.join(packagesDir, entry.name), files: pkg.files });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Problems with the packed file lists. `packed` is the `name`/`files` results of `npm pack --dry-run --json -w <name> ...`.
 * A package that npm did not report at all is a problem too (never "nothing listed, nothing wrong").
 */
export function listProblems(packages, packed) {
  const problems = [];
  const byName = new Map(packed.map((p) => [p.name, p]));
  for (const { name } of packages) {
    const result = byName.get(name);
    if (!result) {
      problems.push(`${name}: npm pack reported no result for this package`);
      continue;
    }
    const listed = new Set(result.files.map((f) => f.path));
    for (const required of REQUIRED_FILES) {
      if (!listed.has(required)) {
        problems.push(`${name}: tarball does not list ${required} (add it to "files" and the package dir)`);
      }
    }
  }
  return problems;
}

/**
 * Each manifest's own `files` names LICENSE and NOTICE.md. npm adds a package-local LICENSE by itself,
 * so the packed list alone would not notice `LICENSE` leaving `files`; the manifest should say it.
 */
export function manifestProblems(packages) {
  const problems = [];
  for (const { name, files } of packages) {
    for (const required of REQUIRED_FILES) {
      if (!Array.isArray(files) || !files.includes(required)) {
        problems.push(`${name}: package.json "files" does not name ${required}`);
      }
    }
  }
  return problems;
}

/** Problems with the on-disk copies: each package's legal files must equal the repo root's. */
export function copyProblems(root, packages) {
  const problems = [];
  for (const required of REQUIRED_FILES) {
    const rootFile = path.join(root, required);
    if (!fs.existsSync(rootFile)) {
      problems.push(`repo root has no ${required}`);
      continue;
    }
    const want = fs.readFileSync(rootFile);
    for (const { name, dir } of packages) {
      const copy = path.join(dir, required);
      if (!fs.existsSync(copy)) {
        problems.push(`${name}: ${required} is missing from the package directory`);
      } else if (!want.equals(fs.readFileSync(copy))) {
        problems.push(`${name}: ${required} differs from the repo root's ${required}`);
      }
    }
  }
  return problems;
}

/**
 * `npm pack --dry-run --json -w <name> ...` for the given packages, one npm start-up (npm is slow to
 * boot, especially on Windows). The JSON shape depends on the npm version (an array of results on
 * npm 10/11, an object keyed by workspace name on npm 12), so read either.
 */
function packDryRun(root, names) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = ['pack', '--dry-run', '--json', '--ignore-scripts', ...names.flatMap((n) => ['-w', n])];
  const r = spawnSync(npmCmd, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    throw new Error(`npm pack --dry-run failed (exit ${r.status}):\n${r.stdout}\n${r.stderr}`);
  }
  const parsed = JSON.parse(r.stdout);
  return Array.isArray(parsed) ? parsed : Object.values(parsed);
}

export function checkRoot(root) {
  const packages = publishablePackages(root);
  if (packages.length === 0) return ['no publishable packages found (is --root the repo root?)'];
  const packed = packDryRun(
    root,
    packages.map((p) => p.name)
  );
  return [...listProblems(packages, packed), ...manifestProblems(packages), ...copyProblems(root, packages)];
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const flag = process.argv.indexOf('--root');
  const root =
    flag === -1
      ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
      : path.resolve(process.argv[flag + 1]);
  const problems = checkRoot(root);
  if (problems.length > 0) {
    process.stderr.write(`pack-license-check: FAILED\n${problems.map((p) => `  ✗ ${p}`).join('\n')}\n`);
    process.exit(1);
  }
  process.stderr.write(
    `pack-license-check: OK (${publishablePackages(root).length} packages list ${REQUIRED_FILES.join(' + ')})\n`
  );
}
