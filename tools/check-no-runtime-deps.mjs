/*
 * No-third-party-runtime-deps gate (Packet D, lane D1).
 *
 * Every published @chestnutlabs/* package depends only on its siblings, plus peers the consumer
 * supplies (three, vue, react, svelte). That is why the toolchain's Dependabot alerts never reach a
 * consumer. This check keeps it that way. For every `packages/<pkg>/package.json`:
 *
 *   (1) `dependencies` and `optionalDependencies` (npm installs both for the consumer) may only name
 *       a workspace sibling: an @chestnutlabs/* name that some packages/* manifest declares, with a
 *       plain version spec (no npm: alias, git, github:, http(s):, file: or link: source);
 *   (2) `peerDependencies` may only name the allow-listed framework peers below.
 *
 * `devDependencies` are not checked. Adding a third-party runtime dependency or a new peer therefore
 * needs a deliberate, reviewed change to this check.
 *
 * Usage:  node tools/check-no-runtime-deps.mjs [--root <repo-dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNTIME_FIELDS = ['dependencies', 'optionalDependencies'];
// npm >= 7 auto-installs non-optional peers into consumers, so each allowed peer is a reviewed runtime dep.
export const ALLOWED_PEERS = new Set(['three', 'vue', 'react', 'svelte']);
const NON_REGISTRY_SPEC = /^(npm:|git\+|git:|github:|https?:|file:|link:)/;

/** The workspace manifests under `<root>/packages`, in a stable (name-sorted) order. */
function readManifests(root) {
  const packagesDir = path.join(root, 'packages');
  const manifests = [];
  const entries = fs.readdirSync(packagesDir).sort((a, b) => a.localeCompare(b));
  for (const dir of entries) {
    const manifest = path.join(packagesDir, dir, 'package.json');
    if (!fs.existsSync(manifest)) continue; // also skips plain files
    manifests.push({ dir, pkg: JSON.parse(fs.readFileSync(manifest, 'utf8')) });
  }
  return manifests;
}

/** One message per runtime-dependency problem found under `<root>/packages/*`. */
export function runtimeDepProblems(root) {
  const manifests = readManifests(root);
  const siblings = new Set(manifests.map(({ pkg }) => pkg.name));
  const problems = [];
  for (const { dir, pkg } of manifests) {
    const where = `${pkg.name} (packages/${dir}/package.json)`;
    for (const field of RUNTIME_FIELDS) {
      for (const [dep, spec] of Object.entries(pkg[field] ?? {})) {
        if (!siblings.has(dep)) {
          problems.push(`${where}: ${field} entry "${dep}": "${spec}" is not a workspace sibling package`);
        } else if (NON_REGISTRY_SPEC.test(spec)) {
          problems.push(`${where}: ${field} entry "${dep}": "${spec}" must be a plain version, not an alias or URL`);
        }
      }
    }
    for (const [dep, spec] of Object.entries(pkg.peerDependencies ?? {})) {
      if (ALLOWED_PEERS.has(dep)) continue;
      problems.push(
        `${where}: peerDependencies entry "${dep}": "${spec}" is not an allowed peer; a new peer needs review`
      );
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
    console.error(
      'check:no-runtime-deps FAILED. Published packages may depend only on their @chestnutlabs/* siblings, ' +
        `with peers limited to ${[...ALLOWED_PEERS].join(', ')}:`
    );
    for (const p of problems) console.error(`  - ${p}`);
    console.error('Move it to devDependencies, or bundle it. A real new runtime dependency or peer needs review.');
    process.exit(1);
  }
  console.log('check:no-runtime-deps OK: no third-party runtime dependencies or unreviewed peers in packages/*.');
}
