/*
 * DD-008 §15 registry-mode consumer verification (#133 / #134). The post-publish
 * counterpart to run.mjs: instead of packing local tarballs, install the ACTUALLY
 * PUBLISHED @chestnutlabs versions from the npm registry into a scratch app and run
 * the identical contract tests. This is an explicit v0.1.0 release GATE — it can
 * only pass once the line is published, so it is NOT part of the normal PR CI; the
 * release-publish workflow runs it after publishing.
 *
 * Usage:
 *   node tools/consumer-vue/run-registry.mjs [version]
 *     version — the published line to verify (default: the workspace's current
 *               gcode-preview-vue version). `latest` resolves the dist-tag.
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

// The seven published packages the fixture consumes (dependency order not required
// for a registry install — npm resolves the graph).
const PACKAGES = [
  'toolpath-core',
  'gcode-colors',
  'gcode-dialects',
  'gcode-containers',
  'gcode-parser',
  'gcode-renderer-three',
  'gcode-renderer-2d',
  'gcode-preview-core',
  'gcode-preview-vue'
];

const argVersion = process.argv[2];
const workspaceVersion = JSON.parse(
  readFileSync(join(root, 'packages', 'gcode-preview-vue', 'package.json'), 'utf8')
).version;
const version = argVersion ?? workspaceVersion;

const run = (cmd, cwd) => {
  console.log(`\n> ${cmd}  (${cwd})`);
  execSync(cmd, { cwd, stdio: 'inherit' });
};

console.log(`== registry-mode consumer verification: @chestnutlabs/* @ ${version} ==`);

const app = mkdtempSync(join(tmpdir(), 'consumer-registry-'));
try {
  const deps = { vue: '^3.4.0' };
  for (const p of PACKAGES) deps[`@chestnutlabs/${p}`] = version;
  writeFileSync(
    join(app, 'package.json'),
    JSON.stringify(
      {
        name: 'consumer-registry-fixture',
        private: true,
        type: 'module',
        scripts: { test: 'vitest run' },
        dependencies: deps,
        devDependencies: { 'happy-dom': '^15.0.0', vitest: '^4.0.0' }
      },
      null,
      2
    ) + '\n'
  );

  // Reuse the exact contract tests + vitest config from the tarball fixture.
  mkdirSync(join(app, 'test'), { recursive: true });
  cpSync(join(here, 'test'), join(app, 'test'), { recursive: true });
  cpSync(join(here, 'vitest.config.mjs'), join(app, 'vitest.config.mjs'));

  console.log('\n== install from the npm registry (published versions only) ==');
  try {
    run('npm install --no-audit --no-fund', app);
  } catch {
    console.error(
      `\nregistry install failed. If this is pre-publication, the @chestnutlabs line ${version} ` +
        'is not on the registry yet — this gate runs AFTER the publish step (release-publish.yml).'
    );
    process.exit(1);
  }

  // Assert every @chestnutlabs dep resolved from the registry, never a stray file:/link.
  const lock = JSON.parse(readFileSync(join(app, 'package-lock.json'), 'utf8'));
  const chestnut = Object.entries(lock.packages ?? {}).filter(([k]) => k.includes('node_modules/@chestnutlabs/'));
  if (chestnut.length !== PACKAGES.length) {
    throw new Error(`expected ${PACKAGES.length} @chestnutlabs packages, found ${chestnut.length}`);
  }
  for (const [key, entry] of chestnut) {
    if (!(entry.resolved ?? '').startsWith('https://')) {
      throw new Error(`${key} resolved from '${entry.resolved}' — expected the npm registry`);
    }
  }
  console.log(`resolution shape OK: ${chestnut.length}/${PACKAGES.length} @chestnutlabs packages from the registry`);

  console.log('\n== contract tests against the published artifacts ==');
  run('npm test', app);
  console.log('\nconsumer-registry fixture: OK');
} finally {
  rmSync(app, { recursive: true, force: true });
}
