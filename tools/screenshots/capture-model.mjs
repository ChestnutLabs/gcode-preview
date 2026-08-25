/**
 * Model-renderer documentation-media capture.
 *
 * Drives the running `tools/demo` model harness (http://localhost:5199/model.html)
 * with a headless Chromium and writes the presentation-still screenshot used in the
 * README to `docs/media/`. Both inputs are fully synthetic and MIT-clean (an in-page
 * STL and the generated colored 3MF from tools/fixtures/make-model-3mf.mjs) — the
 * image is a real render of a real ModelScene through the packaged renderModelStill,
 * nothing is mocked.
 *
 * Prerequisites (see tools/screenshots/README.md):
 *   1. Build the workspace packages so the demo can resolve them.
 *   2. Start the demo:  cd tools/demo && npm install && npm run dev
 *   3. Have Google Chrome / Chromium installed (CHROME_PATH overrides the path).
 *   4. npm i -D playwright-core
 *
 * Run:  node tools/screenshots/capture-model.mjs
 */
/* eslint-env node, browser */
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEDIA = resolve(__dirname, '../../docs/media');
const BASE = process.env.DEMO_URL || 'http://localhost:5199';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome-stable';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader']
});
const page = await browser.newPage({ viewport: { width: 700, height: 420 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

process.stdout.write('• model-render … ');
await page.goto(BASE + '/model.html', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__modelResult, null, { timeout: 30000 });
const result = await page.evaluate(() => window.__modelResult);

// Honesty guard: the 3MF must render its declared colors, the STL must not fabricate any.
if (result.threemf.materials !== 'known' || result.stl.materials !== 'unavailable') {
  throw new Error('unexpected materials tiers: ' + JSON.stringify(result));
}
await page.waitForTimeout(300);

const out = resolve(MEDIA, 'model-render-stl-3mf.png');
await page.locator('#cards').screenshot({ path: out });
console.log('saved', out, JSON.stringify(result));

await browser.close();
console.log('done');
