/*
 * DD-008 §4.3/#130: publish orchestration for the nine-package lockstep line.
 * Publishes in dependency order with npm provenance. Guards:
 *   - a REAL publish runs only inside GitHub Actions (protected workflow) with
 *     RELEASE_CONFIRM=publish set by the workflow — never from a workstation.
 *   - `--dry-run` works anywhere: it temporarily strips the pre-release
 *     `private: true` flag (restored afterwards) so `npm publish --dry-run`
 *     exercises the full pack + validation path and prints exactly what a real
 *     release would upload, including the synced internal dependency ranges.
 *
 * Usage:  node tools/release/publish.mjs --dry-run
 *         node tools/release/publish.mjs            (CI only)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRY = process.argv.includes('--dry-run');

// Dependency order (same list pack-check builds in).
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

if (!DRY) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RELEASE_CONFIRM !== 'publish') {
    process.stderr.write(
      'publish.mjs: refusing a real publish outside the protected release workflow ' +
        '(GITHUB_ACTIONS + RELEASE_CONFIRM=publish required). Use --dry-run locally.\n'
    );
    process.exit(1);
  }
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let failed = false;
const summary = [];

for (const name of ORDER) {
  const dir = path.join(repoRoot, 'packages', name);
  const manifestPath = path.join(dir, 'package.json');
  const original = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(original);

  if (!DRY && manifest.private) {
    process.stderr.write(`✗ ${manifest.name} is still private — the release phase removes the flag first.\n`);
    failed = true;
    break;
  }

  // Idempotent recovery (DD-008 §6): a rerun publishes only the not-yet-published
  // remainder at the same version. If this exact name@version is already on the
  // registry, skip it rather than failing the whole line on "cannot publish over
  // existing version".
  if (!DRY) {
    const seen = spawnSync(npmCmd, ['view', `${manifest.name}@${manifest.version}`, 'version'], {
      cwd: dir,
      encoding: 'utf8',
      shell: process.platform === 'win32'
    });
    if (seen.status === 0 && seen.stdout.trim() === manifest.version) {
      process.stderr.write(`↷ ${manifest.name}@${manifest.version} already on the registry — skipping\n`);
      continue;
    }
  }

  try {
    if (DRY && manifest.private) {
      const stripped = { ...manifest };
      delete stripped.private;
      fs.writeFileSync(manifestPath, JSON.stringify(stripped, null, 2) + '\n');
    }
    const args = ['publish', '--access', 'public', '--provenance'];
    if (DRY) args.push('--dry-run');
    const r = spawnSync(npmCmd, args, { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' });
    const out = `${r.stdout}\n${r.stderr}`;
    if (r.status !== 0) {
      // In --dry-run without a registry session, provenance generation is skipped
      // with a warning but pack/validation still runs; a hard failure is real.
      process.stderr.write(`✗ ${manifest.name}: publish${DRY ? ' --dry-run' : ''} failed\n${out}\n`);
      failed = true;
      if (!DRY) break;
    } else {
      const internal = Object.entries({ ...manifest.dependencies })
        .filter(([n]) => n.startsWith('@chestnutlabs/'))
        .map(([n, v]) => `${n}@${v}`);
      const files = (out.match(/total files:\s*(\d+)/i) || [])[1] ?? '?';
      const size = (out.match(/package size:\s*([\d.]+\s*\w+)/i) || [])[1] ?? '?';
      summary.push({ name: `${manifest.name}@${manifest.version}`, files, size, internal });
      process.stderr.write(`✓ ${manifest.name}@${manifest.version} (${files} files, ${size})\n`);
    }
  } finally {
    if (DRY) fs.writeFileSync(manifestPath, original);
  }
}

if (summary.length > 0) {
  process.stdout.write('\n| Package | Files | Size | Internal deps (exact) |\n|---|--:|--:|---|\n');
  for (const s of summary) {
    process.stdout.write(`| \`${s.name}\` | ${s.files} | ${s.size} | ${s.internal.join('<br>') || '—'} |\n`);
  }
}

process.exit(failed ? 1 : 0);
