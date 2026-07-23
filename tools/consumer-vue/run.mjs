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
import { mkdirSync, renameSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const tarballDir = join(here, 'tarballs');

const PACKAGES = [
  'toolpath-core',
  'gcode-parser',
  'gcode-dialects',
  'gcode-containers',
  'gcode-renderer-three',
  'gcode-preview-vue'
];

const run = (cmd, cwd) => {
  console.log(`\n> ${cmd}  (${cwd})`);
  execSync(cmd, { cwd, stdio: 'inherit' });
};

console.log('== consumer-vue fixture: build workspaces ==');
run('npm run build --workspaces --if-present', root);

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

console.log('\n== install fixture app from tarballs ==');
run('npm install --no-audit --no-fund', here);

console.log('\n== contract tests ==');
run('npm test', here);

console.log('\nconsumer-vue fixture: OK');
