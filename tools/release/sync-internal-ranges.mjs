/*
 * DD-008 §4.3/#130: pin every internal @chestnutlabs/* dependency range to the EXACT
 * version of that workspace package. Runs after `changeset version` in the release
 * flow (see the root `version` script), so the committed manifests — and therefore the
 * published tarballs — never carry the development-time "*" wildcard.
 *
 * Local workspace resolution is unaffected: the linked package's version always
 * satisfies its own exact range.
 *
 * Usage: node tools/release/sync-internal-ranges.mjs [--check]
 *   --check  exit 1 if any internal range is out of sync (used by CI)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkgsDir = path.join(repoRoot, 'packages');
const CHECK = process.argv.includes('--check');

const dirs = fs.readdirSync(pkgsDir).filter((d) => fs.existsSync(path.join(pkgsDir, d, 'package.json')));
const versions = new Map();
for (const d of dirs) {
  const p = JSON.parse(fs.readFileSync(path.join(pkgsDir, d, 'package.json'), 'utf8'));
  versions.set(p.name, p.version);
}

let changed = 0;
for (const d of dirs) {
  const file = path.join(pkgsDir, d, 'package.json');
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  let dirty = false;
  for (const field of ['dependencies', 'devDependencies']) {
    const deps = p[field];
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      const v = versions.get(name);
      if (v !== undefined && deps[name] !== v) {
        process.stderr.write(`${p.name}: ${field}.${name} ${deps[name]} -> ${v}\n`);
        deps[name] = v;
        dirty = true;
      }
    }
  }
  if (dirty) {
    changed++;
    if (!CHECK) fs.writeFileSync(file, JSON.stringify(p, null, 2) + '\n');
  }
}

if (CHECK && changed > 0) {
  process.stderr.write(
    `sync-internal-ranges: ${changed} manifest(s) OUT OF SYNC (run: node tools/release/sync-internal-ranges.mjs)\n`
  );
  process.exit(1);
}
process.stderr.write(`sync-internal-ranges: ${CHECK ? 'in sync' : `${changed} manifest(s) updated`}\n`);
