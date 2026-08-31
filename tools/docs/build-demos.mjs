/*
 * docs:demos (DD-031 docs/demo parity) — build the LIVE, interactive demos and stage them into the
 * GitHub Pages artifact (`docs-site/demos/<slug>/`), so the published product docs link real running
 * apps, not raw source. Each app is a real Vite build of the PUBLISHED adapter surface (the same code
 * a consumer installs) — the Feature Lab on the core controller, and a two-tier example per framework.
 *
 * Run AFTER `docs:build` (which creates docs-site/). The Pages workflow runs both; PR-verify and the
 * release doc-gate stay on the fast `docs:build` alone. A demos landing page (docs-site/demos/) gives
 * each demo a product label + context.
 *
 * Reproducibility: the app→slug map + corpus scope live here; re-run `npm run docs:demos` any time.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, cpSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(repoRoot, 'docs-site', 'demos');

// Publishable packages in dependency order — built first so each example's `file:` deps resolve to a
// fresh dist (the examples are standalone npm projects, not workspaces).
const PACKAGES = [
  'toolpath-core',
  'gcode-colors',
  'gcode-dialects',
  'gcode-containers',
  'gcode-bgcode',
  'gcode-parser',
  'gcode-renderer-three',
  'gcode-model-renderer',
  'gcode-renderer-2d',
  'gcode-preview-core',
  'gcode-preview-vue',
  'gcode-preview-react',
  'gcode-preview-svelte',
  'gcode-preview-element'
];

// The live demos. `label`/`blurb` are product-facing (they drive the landing page). `entries` are the
// HTML pages a visitor should be pointed at.
const DEMOS = [
  {
    dir: 'tools/demo',
    slug: 'feature-lab',
    label: 'Feature Lab',
    blurb: 'Explore the complete capability surface — Preview (sliced G-code) and Prepare (source model), color modes, layer/segment scrub, feature visibility, camera, and live render diagnostics.',
    entries: [{ href: 'index.html', label: 'Open Feature Lab' }]
  },
  {
    dir: 'tools/example-react',
    slug: 'react',
    label: 'React',
    blurb: 'The published @chestnutlabs/gcode-preview-react adapter — a full Preview/Prepare showcase plus minimal getting-started pages.',
    entries: [
      { href: 'showcase.html', label: 'Showcase' },
      { href: 'minimal.html', label: 'Minimal (G-code)' },
      { href: 'model.html', label: 'Minimal (model)' }
    ]
  },
  {
    dir: 'tools/example-vue',
    slug: 'vue',
    label: 'Vue',
    blurb: 'The published @chestnutlabs/gcode-preview-vue adapter — a full Preview/Prepare showcase plus minimal getting-started pages.',
    entries: [
      { href: 'showcase.html', label: 'Showcase' },
      { href: 'minimal.html', label: 'Minimal (G-code)' },
      { href: 'model.html', label: 'Minimal (model)' }
    ]
  },
  {
    dir: 'tools/example-svelte',
    slug: 'svelte',
    label: 'Svelte',
    blurb: 'The published @chestnutlabs/gcode-preview-svelte adapter — a full Preview/Prepare showcase plus minimal getting-started pages.',
    entries: [
      { href: 'showcase.html', label: 'Showcase' },
      { href: 'minimal.html', label: 'Minimal (G-code)' },
      { href: 'model.html', label: 'Minimal (model)' }
    ]
  },
  {
    dir: 'tools/example-webcomponent',
    slug: 'webcomponent',
    label: 'Web Component',
    blurb: 'The framework-free @chestnutlabs/gcode-preview-element (<gcode-preview> / <gcode-model-viewer>) — a full Preview/Prepare showcase plus minimal getting-started pages.',
    entries: [
      { href: 'showcase.html', label: 'Showcase' },
      { href: 'minimal.html', label: 'Minimal (G-code)' },
      { href: 'model.html', label: 'Minimal (model)' }
    ]
  }
];

// Corpus scope: publicDir copies the whole test-data tree into each dist; keep only what the demos
// actually fetch (the MIT sample G-code + container/annotation fixtures), drop goldens/baselines/etc.
const CORPUS_KEEP = new Set(['gcodes', 'fixtures']);
const KEEP_TOP = new Set(['assets', 'index.html', 'minimal.html', 'showcase.html', 'model.html', 'model-viewer.html', '2d.html', 'still.html', 'validate.html', 'favicon.ico', 'vite.svg']);

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

if (!existsSync(path.join(repoRoot, 'docs-site'))) {
  console.error('docs-site/ not found — run `npm run docs:build` first.');
  process.exit(1);
}

console.log('== docs:demos — building publishable packages (dependency order) ==');
for (const pkg of PACKAGES) run(`npm run build --workspace @chestnutlabs/${pkg}`, repoRoot);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const demo of DEMOS) {
  const appDir = path.join(repoRoot, demo.dir);
  console.log(`\n== docs:demos — ${demo.label} (${demo.dir}) ==`);
  run('npm install --no-audit --no-fund', appDir);
  run('npm run build', appDir);

  const dist = path.join(appDir, 'dist');
  const dest = path.join(outDir, demo.slug);
  cpSync(dist, dest, { recursive: true });

  // Prune the copied corpus: keep only gcodes/ + fixtures/, plus the app's own pages/assets.
  for (const entry of readdirSync(dest, { withFileTypes: true })) {
    const name = entry.name;
    if (CORPUS_KEEP.has(name) || KEEP_TOP.has(name)) continue;
    rmSync(path.join(dest, name), { recursive: true, force: true });
  }
  console.log(`   staged → docs-site/demos/${demo.slug}/`);
}

// ---- product-facing landing page ----
const card = (d) => {
  const links = d.entries
    .map((e) => `<a class="lnk" href="./${d.slug}/${e.href}">${e.label}</a>`)
    .join('');
  return `<article class="card">
      <h2>${d.label}</h2>
      <p>${d.blurb}</p>
      <div class="links">${links}</div>
    </article>`;
};
const landing = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Live demos — G-code Preview</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; font-family:'Inter',system-ui,sans-serif; background:#16181d; color:#e7eaef; line-height:1.5; }
  header { padding:2.5rem 1.5rem 1rem; max-width:1040px; margin:0 auto; }
  h1 { font-size:1.7rem; margin:0 0 .4rem; }
  header p { color:#9aa2ae; margin:0; max-width:60ch; }
  header a.back { color:#6cb0ff; text-decoration:none; font-size:.85rem; }
  main { max-width:1040px; margin:0 auto; padding:1rem 1.5rem 3rem; display:grid; gap:1rem; grid-template-columns:1fr 1fr; }
  .card { border:1px solid #363b44; border-radius:12px; background:#1e2127; padding:1.25rem 1.4rem; }
  .card h2 { font-size:1.1rem; margin:0 0 .4rem; }
  .card p { color:#9aa2ae; font-size:.9rem; margin:0 0 .9rem; }
  .card.feature { grid-column:1/-1; border-color:#4f9df2; background:#1b2330; }
  .links { display:flex; flex-wrap:wrap; gap:.5rem; }
  a.lnk { display:inline-block; padding:.4rem .8rem; border:1px solid #454b56; border-radius:6px; background:#262a31; color:#e7eaef; text-decoration:none; font-size:.85rem; font-weight:550; }
  a.lnk:hover { border-color:#4f9df2; color:#6cb0ff; }
  @media (max-width:640px){ main { grid-template-columns:1fr; } }
</style></head>
<body>
  <header>
    <p><a class="back" href="../">← G-code Preview docs</a></p>
    <h1>Live demos</h1>
    <p>Interactive, in-browser demos of the published SDK — the same <code>@chestnutlabs/*</code> packages you install. Parsing runs in a Web Worker; rendering is client-side WebGL. Nothing is uploaded.</p>
  </header>
  <main>
    ${DEMOS.map((d, i) => card(d).replace('class="card"', i === 0 ? 'class="card feature"' : 'class="card"')).join('\n    ')}
  </main>
</body></html>
`;
writeFileSync(path.join(outDir, 'index.html'), landing);
console.log('\n✅ Live demos staged at docs-site/demos/ (landing at /demos/)');
