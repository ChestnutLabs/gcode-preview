/*
 * DD-007 phase 4 fixture runner (issue #107): pack → install → test.
 *
 * 1. Builds every workspace package and `npm pack`s the six @chestnutlabs tarballs
 *    into tarballs/ under STABLE names (version stripped), matching the committed
 *    package.json/lockfile references.
 * 2. `npm install`s the fixture app (npm, not ci: freshly packed tarballs get new
 *    integrity hashes each run; the committed lockfile pins the RESOLUTION SHAPE —
 *    every @chestnutlabs range satisfied from the local tarballs, nothing from a
 *    registry — which is the reproducibility claim under test).
 * 3. Runs the contract tests against the INSTALLED packages.
 *
 * Usage: node tools/consumer-vue/run.mjs   (repo root or anywhere)
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const tarballDir = join(here, 'tarballs');

// Dependency order (build relies on it): core first; dialects/containers before the
// parser (its batteries worker imports them); the Vue adapter last.
const PACKAGES = [
  'toolpath-core',
  'gcode-colors',
  'gcode-dialects',
  'gcode-containers',
  'gcode-bgcode',
  'gcode-parser',
  'gcode-renderer-three',
  'gcode-model-renderer',
  'gcode-renderer-2d',
  'gcode-preview-core',
  'gcode-preview-vue'
];

const run = (cmd, cwd) => {
  console.log(`\n> ${cmd}  (${cwd})`);
  execSync(cmd, { cwd, stdio: 'inherit' });
};

console.log('== consumer-vue fixture: build workspaces (dependency order) ==');
// NOT `--workspaces`: npm runs those alphabetically, so gcode-preview-vue would
// compile before gcode-renderer-three has a dist on a clean runner. PACKAGES is
// dependency-ordered — build one at a time.
for (const pkg of PACKAGES) {
  run(`npm run build --workspace=@chestnutlabs/${pkg}`, root);
}

console.log('\n== pack tarballs (stable names) ==');
rmSync(tarballDir, { recursive: true, force: true });
mkdirSync(tarballDir, { recursive: true });
for (const pkg of PACKAGES) {
  const pkgDir = join(root, 'packages', pkg);
  run(`npm pack --pack-destination "${tarballDir}"`, pkgDir);
  const packed = readdirSync(tarballDir).find((f) => f.startsWith(`chestnutlabs-${pkg}-`) && f.endsWith('.tgz'));
  if (packed === undefined) throw new Error(`pack produced no tarball for ${pkg}`);
  renameSync(join(tarballDir, packed), join(tarballDir, `chestnutlabs-${pkg}.tgz`));
}

console.log('\n== reconcile lockfile with fresh tarballs (bytes differ; shape must not) ==');
// npm pack is not byte-reproducible (tar timestamps), so the committed lockfile's
// tarball integrity hashes can never match a fresh pack. Strip integrity for the
// file: tarball entries only — the reproducibility claim under test is the RESOLUTION
// SHAPE (everything @chestnutlabs from local tarballs, nothing from a registry),
// asserted explicitly after install.
const lockPath = join(here, 'package-lock.json');
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
for (const [key, entry] of Object.entries(lock.packages ?? {})) {
  if (key.includes('node_modules/@chestnutlabs/') || entry.resolved?.startsWith('file:')) {
    delete entry.integrity;
  }
}
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');

console.log('\n== install fixture app from tarballs ==');
run('npm install --no-audit --no-fund', here);

console.log('\n== assert resolution shape (the D3 reproducibility claim) ==');
const after = JSON.parse(readFileSync(lockPath, 'utf8'));
const chestnut = Object.entries(after.packages ?? {}).filter(([k]) => k.includes('node_modules/@chestnutlabs/'));
if (chestnut.length !== PACKAGES.length) {
  throw new Error(`expected ${PACKAGES.length} @chestnutlabs packages resolved, found ${chestnut.length}`);
}
for (const [key, entry] of chestnut) {
  if (!(entry.resolved ?? '').includes('tarballs/')) {
    throw new Error(`${key} resolved from '${entry.resolved}' — expected the local tarball, never a registry`);
  }
}
console.log(`resolution shape OK: ${chestnut.length}/${PACKAGES.length} @chestnutlabs packages from local tarballs`);

console.log('\n== contract tests ==');
run('npm test', here);

console.log('\nconsumer-vue fixture: OK');
