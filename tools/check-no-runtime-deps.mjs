/*
 * No-third-party-runtime-deps gate (Packet D, lane D1).
 *
 * Every published @chestnutlabs/* package depends only on its siblings, plus peers the consumer
 * supplies (three, vue, react, svelte). That is why the toolchain's Dependabot alerts never reach a
 * consumer. This check keeps it that way: it fails when any `packages/<pkg>/package.json` lists a
 * non-@chestnutlabs entry in `dependencies` or `optionalDependencies` (npm installs both for the
 * consumer). `peerDependencies` and `devDependencies` are not checked.
 *
 * Adding a third-party runtime dependency therefore needs a deliberate, reviewed change to this check.
 *
 * Usage:  node tools/check-no-runtime-deps.mjs [--root <repo-dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ALLOWED_SCOPE = '@chestnutlabs/';
export const CHECKED_FIELDS = ['dependencies', 'optionalDependencies'];

/** One message per third-party runtime dependency found under `<root>/packages/*`. */
export function runtimeDepProblems(root) {
  const packagesDir = path.join(root, 'packages');
  const problems = [];
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    const manifest = path.join(packagesDir, entry.name, 'package.json');
    if (!fs.existsSync(manifest)) continue; // also skips plain files
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    for (const field of CHECKED_FIELDS) {
      for (const [dep, range] of Object.entries(pkg[field] ?? {})) {
        if (dep.startsWith(ALLOWED_SCOPE)) continue;
        problems.push(
          `${pkg.name} (packages/${entry.name}/package.json): third-party ${field} entry "${dep}": "${range}"`
        );
      }
    }
  }
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const flag = process.argv.indexOf('--root');
  const root =
    flag === -1
      ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
      : path.resolve(process.argv[flag + 1]);
  const problems = runtimeDepProblems(root);
  if (problems.length > 0) {
    console.error('check:no-runtime-deps FAILED. Published packages may depend only on @chestnutlabs/* packages:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      'Move it to peerDependencies or devDependencies, or bundle it. A real new runtime dependency needs review.'
    );
    process.exit(1);
  }
  console.log('check:no-runtime-deps OK: no third-party runtime dependencies in packages/*.');
}
