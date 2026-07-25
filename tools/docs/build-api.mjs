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
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { sep } from 'node:path';

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

// Inject the Chestnut Labs theme. typedoc's `customCss` is ignored in packages mode, so:
//  (1) append the theme's override rules to the generated style.css — loaded by every page
//      at the right relative path and, appended last, winning by source order;
//  (2) inject a NON-BLOCKING web-font <link> into each page's <head> (an @import inside
//      style.css would block the whole sheet until the font CDN responds; a <link> with an
//      absolute URL loads independently and works from any page depth).
console.log('\n== docs:build — injecting Chestnut Labs theme ==');
const outDir = new URL('../../docs-site/api/', import.meta.url);
const themePath = new URL('./typedoc-theme.css', import.meta.url);
const stylePath = new URL('assets/style.css', outDir);
const theme = readFileSync(themePath, 'utf8').trim();
const style = readFileSync(stylePath, 'utf8');
writeFileSync(stylePath, `${style}\n\n/* --- Chestnut Labs theme (E11 phase 2, DD-013) --- */\n${theme}\n`);

const FONT_LINKS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?' +
  'family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">';

let patched = 0;
for (const rel of readdirSync(outDir, { recursive: true })) {
  if (!String(rel).endsWith('.html')) continue;
  const p = new URL(String(rel).split(sep).join('/'), outDir);
  const html = readFileSync(p, 'utf8');
  if (html.includes('</head>') && !html.includes('IBM+Plex+Sans')) {
    writeFileSync(p, html.replace('</head>', `${FONT_LINKS}</head>`));
    patched++;
  }
}
console.log(`   theme merged into style.css; web-font links injected into ${patched} pages`);

console.log('\n✅ API reference generated at docs-site/api');
