/*
 * DD-008 §8/§9 packaged-artifact gate (#128): for every publishable package,
 * (1) build it (dependency order), (2) snapshot `npm pack --dry-run --json`
 * file lists against tools/pack-check-snapshots.json (regenerate deliberately
 * with UPDATE_PACK_SNAPSHOTS=1), (3) run publint, (4) run
 * @arethetypeswrong/cli with the esm-only profile.
 *
 * The snapshot is the "nothing ships by accident" lock: any file entering or
 * leaving a tarball is a reviewed diff, not a surprise at publish time.
 *
 * Usage:  node tools/pack-check.mjs
 *         UPDATE_PACK_SNAPSHOTS=1 node tools/pack-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const snapshotFile = path.join(__dirname, 'pack-check-snapshots.json');
const UPDATE = process.env.UPDATE_PACK_SNAPSHOTS === '1';

// Dependency order matters: later packages compile against earlier dists.
const PACKAGES = [
  'toolpath-core',
  'gcode-colors',
  'gcode-dialects',
  'gcode-containers',
  'gcode-bgcode',
  'gcode-parser',
  'gcode-renderer-three',
  'gcode-renderer-2d',
  'gcode-preview-core',
  'gcode-preview-vue',
  'gcode-preview-react',
  'gcode-preview-svelte',
  'gcode-preview-element'
];

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Documented attw exceptions (DD-008 §8 allows these when recorded with a reason).
const ATTW_EXTRA_ARGS = {
  // The raw `.svelte` component ships under the `"svelte"` export condition and is
  // compiled by the CONSUMER's Svelte toolchain (DD-007 phase 7). attw only models
  // node/bundler resolution, so that entrypoint legitimately does not resolve for it.
  // The JS/TS surface (`.`) is still fully checked.
  'gcode-preview-svelte': ['--exclude-entrypoints', './GcodePreview.svelte']
};

function run(args, cwd, label) {
  const r = spawnSync(npmCmd, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    process.stderr.write(`\n${label} failed (exit ${r.status}):\n${r.stdout}\n${r.stderr}\n`);
    process.exit(1);
  }
  return r.stdout;
}

function runNpx(args, cwd, label) {
  const r = spawnSync(npmCmd, ['exec', '--no', '--', ...args], {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  return { ok: r.status === 0, out: `${r.stdout}\n${r.stderr}`, label };
}

const snapshots = fs.existsSync(snapshotFile) ? JSON.parse(fs.readFileSync(snapshotFile, 'utf8')) : {};
const next = {};
let failed = false;

for (const name of PACKAGES) {
  const dir = path.join(repoRoot, 'packages', name);
  process.stderr.write(`— ${name}: build\n`);
  run(['run', 'build', '--workspace', `@chestnutlabs/${name}`], repoRoot, `${name} build`);

  // 1) pack contents snapshot
  const packJson = run(['pack', '--dry-run', '--json'], dir, `${name} pack`);
  const parsed = JSON.parse(packJson);
  const files = parsed[0].files.map((f) => f.path.replace(/\\/g, '/')).sort();
  next[name] = files;
  const allowedRoots = /^(dist\/|package\.json$|README(\.md)?$|LICENSE(\.md)?$|CHANGELOG\.md$|GcodePreview\.svelte$)/;
  const stray = files.filter((f) => !allowedRoots.test(f));
  if (stray.length > 0) {
    process.stderr.write(`  ✗ unexpected tarball contents: ${stray.join(', ')}\n`);
    failed = true;
  }
  if (!UPDATE) {
    const want = snapshots[name];
    if (!want) {
      process.stderr.write(`  ✗ no committed snapshot (run with UPDATE_PACK_SNAPSHOTS=1 and review the diff)\n`);
      failed = true;
    } else if (JSON.stringify(want) !== JSON.stringify(files)) {
      const added = files.filter((f) => !want.includes(f));
      const removed = want.filter((f) => !files.includes(f));
      process.stderr.write(`  ✗ pack contents drifted (added: [${added}] removed: [${removed}])\n`);
      failed = true;
    } else {
      process.stderr.write(`  ✓ pack snapshot (${files.length} files)\n`);
    }
  }

  // 2) publint
  const pl = runNpx(['publint', '--strict'], dir, `${name} publint`);
  if (!pl.ok) {
    process.stderr.write(`  ✗ publint:\n${pl.out}\n`);
    failed = true;
  } else {
    process.stderr.write(`  ✓ publint\n`);
  }

  // 3) arethetypeswrong (ESM-only packages; node10 resolution is out of scope)
  const attw = runNpx(
    ['attw', '--pack', '.', '--profile', 'esm-only', ...(ATTW_EXTRA_ARGS[name] ?? [])],
    dir,
    `${name} attw`
  );
  if (!attw.ok) {
    process.stderr.write(`  ✗ attw:\n${attw.out}\n`);
    failed = true;
  } else {
    process.stderr.write(`  ✓ attw (esm-only profile)\n`);
  }
}

if (UPDATE) {
  fs.writeFileSync(snapshotFile, JSON.stringify(next, null, 2) + '\n');
  process.stderr.write(`\nsnapshots written to ${path.relative(repoRoot, snapshotFile)} — review and commit.\n`);
}

if (failed) {
  process.stderr.write('\npack-check: FAILED\n');
  process.exit(1);
}
process.stderr.write('\npack-check: OK\n');
