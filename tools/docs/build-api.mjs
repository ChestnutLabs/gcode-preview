#!/usr/bin/env node
/**
 * Build the generated API reference (E11 phase 1, DD-013 D1/D6).
 *
 * typedoc runs in packages mode over the ten public `@chestnutlabs/*` packages, so each package's
 * `dist/*.d.ts` must exist first for cross-package type resolution. npm `--workspaces` builds
 * ALPHABETICALLY, which would compile an adapter before its dependency has a dist on a clean runner
 * (the same trap tools/consumer-vue/run.mjs documents), so we build in dependency order here.
 *
 * Output: docs-site/api (git-ignored). Warnings are baselined to warn (typedoc exits 0); the D5
 * accuracy gate flips them to errors in E11 phase 4.
 */
import { execSync } from 'node:child_process';

// Dependency order: core first; dialects/containers/renderer + parser before preview-core;
// the framework adapters (which depend on preview-core) last.
const PACKAGES = [
  'toolpath-core',
  'gcode-dialects',
  'gcode-containers',
  'gcode-parser',
  'gcode-renderer-three',
  'gcode-preview-core',
  'gcode-preview-vue',
  'gcode-preview-react',
  'gcode-preview-svelte',
  'gcode-preview-element'
];

const run = (cmd) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

console.log('== docs:build — building @chestnutlabs/* in dependency order ==');
for (const pkg of PACKAGES) {
  run(`npm run build --workspace=@chestnutlabs/${pkg}`);
}

console.log('\n== docs:build — generating API reference (typedoc, packages mode) ==');
run('npx typedoc');

console.log('\n✅ API reference generated at docs-site/api');
