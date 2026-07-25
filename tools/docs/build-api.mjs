#!/usr/bin/env node
/**
 * Build the documentation site (E11 phases 1–3, DD-013).
 *
 * Two typedoc projects, one output tree:
 *   - the SDK MANUAL (getting-started + guides + concepts, authored under docs/manual/) →
 *     docs-site/           (the site home);
 *   - the API REFERENCE (packages mode over the ten @chestnutlabs/* packages) →
 *     docs-site/api/.
 * They are separate projects because typedoc's `readme`/`projectDocuments`/`customCss` are
 * ignored in packages mode, and packages mode gives the API its nice per-package names — so the
 * manual gets its own normal-mode project (an empty entry point + the documents) and the API keeps
 * packages mode. Both are themed by appending typedoc-theme.css to their generated style.css, with
 * IBM Plex loaded via a NON-BLOCKING <link> injected into every page's <head>.
 *
 * typedoc needs each package's dist/*.d.ts for cross-package type resolution, and npm --workspaces
 * builds ALPHABETICALLY (which would compile an adapter before its dependency has a dist), so we
 * build in dependency order first.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
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

// Accuracy gate (E11 phase 4, DD-013 D5). typedoc exits 0 on warnings; we run it, echo the
// output, and FAIL the build if the warning count exceeds a known-benign baseline. This catches
// every NEW warning — a broken `@link`, a rewritten reference, an undocumented export once that
// check is enabled — while tolerating unavoidable external noise (@types/three .d.ts comment
// quirks, and one media-copy note for an absolute doc link that packages mode still probes).
// A warning budget is used instead of `treatWarningsAsErrors` precisely because those external
// warnings cannot be config-suppressed in packages mode; lower the baseline as they are removed.
const typedocChecked = (cmd, label, allowedWarnings) => {
  console.log(`\n$ ${cmd}`);
  const output = execSync(`${cmd} 2>&1`, { encoding: 'utf8' });
  process.stdout.write(output);
  // Read the authoritative count from typedoc's "Found N errors and M warnings" summary (that
  // summary line itself carries a [warning] prefix, so counting [warning] occurrences over-counts).
  const summary = output.match(/Found \d+ errors and (\d+) warnings/);
  const warnings = summary ? Number(summary[1]) : 0;
  if (warnings > allowedWarnings) {
    throw new Error(
      `${label}: ${warnings} typedoc warnings exceed the allowed ${allowedWarnings}. ` +
        `A new warning was introduced (broken @link, rewritten reference, undocumented export, …). ` +
        `Fix it, or if it is genuinely benign raise the baseline in tools/docs/build-api.mjs.`
    );
  }
  console.log(`   ✓ ${label}: ${warnings}/${allowedWarnings} typedoc warnings (within budget)`);
};

console.log('== docs:build — building @chestnutlabs/* in dependency order ==');
for (const pkg of PACKAGES) {
  run(`npm run build --workspace=@chestnutlabs/${pkg}`);
}

const outDir = new URL('../../docs-site/', import.meta.url);
rmSync(outDir, { recursive: true, force: true });

// Manual first (out = docs-site root), then the API reference into the api/ subdir.
console.log('\n== docs:build — generating SDK manual ==');
typedocChecked('npx typedoc --options tools/docs/typedoc.manual.json', 'manual', 0);

console.log('\n== docs:build — generating API reference (typedoc, packages mode) ==');
typedocChecked('npx typedoc', 'API reference', 3);

// Theme both sub-sites. typedoc's `customCss` is ignored in packages mode, so we append the theme
// to every generated style.css (appended last → wins by source order) and inject a non-blocking
// web-font <link> into every page's <head> (an @import inside style.css would block the whole sheet
// until the font CDN responds; a <link> with an absolute URL loads independently, at any depth).
console.log('\n== docs:build — injecting Chestnut Labs theme ==');
const theme = readFileSync(new URL('./typedoc-theme.css', import.meta.url), 'utf8').trim();
const FONT_LINKS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?' +
  'family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">';

// Version stamp (DD-013 D4): read the lockstep version from any package and footer every page.
const REPO = 'https://github.com/ChestnutLabs/gcode-preview';
const version = JSON.parse(
  readFileSync(new URL('../../packages/toolpath-core/package.json', import.meta.url), 'utf8')
).version;
const FOOTER =
  `<footer class="gp-docs-footer">Chestnut Labs G-code Preview · v${version} · ` +
  `<a href="${REPO}/releases">changelog</a> · <a href="${REPO}/blob/dev/LICENSE">MIT</a></footer>`;

let styled = 0;
let patched = 0;
for (const entry of readdirSync(outDir, { recursive: true })) {
  const rel = String(entry).split(sep).join('/');
  const p = new URL(rel, outDir);
  if (rel.endsWith('assets/style.css')) {
    const css = readFileSync(p, 'utf8');
    if (!css.includes('Chestnut Labs theme')) {
      writeFileSync(p, `${css}\n\n/* --- Chestnut Labs theme (E11, DD-013) --- */\n${theme}\n`);
      styled++;
    }
  } else if (rel.endsWith('.html')) {
    let html = readFileSync(p, 'utf8');
    let touched = false;
    if (html.includes('</head>') && !html.includes('IBM+Plex+Sans')) {
      html = html.replace('</head>', `${FONT_LINKS}</head>`);
      touched = true;
    }
    if (html.includes('</body>') && !html.includes('gp-docs-footer')) {
      html = html.replace('</body>', `${FOOTER}</body>`);
      touched = true;
    }
    if (touched) {
      writeFileSync(p, html);
      patched++;
    }
  }
}
console.log(`   themed ${styled} stylesheets; font + v${version} footer injected into ${patched} pages`);

console.log('\n✅ Docs site generated at docs-site (manual at /, API reference at /api)');
