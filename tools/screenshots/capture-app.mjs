/*
 * App-UI documentation capture (DD-031 docs/demo parity) — the sibling of capture.mjs.
 *
 * capture.mjs captures mid-grey capability RENDERS (what the toolpath looks like). This captures the
 * actual Feature Lab APPLICATION surface — control/inspector rail, color-mode selector, tabs,
 * diagnostics, and the Preview/Prepare modes — so the README/docs show the interactive product, not
 * only pretty renders. Manifest: app-shots.manifest.json.
 *
 * Because page.screenshot cannot grab a WebGL canvas without preserveDrawingBuffer, we composite the
 * real render into the DOM: copy the live canvas (drawImage → toDataURL) → set as the viewport-wrap
 * background → hide the live canvas → screenshot the full page. We copy the live canvas rather than
 * controls.capture(), whose render-to-target readback is LINEAR and would darken the mid-grey theme
 * (see the composite step). The dark chrome IS the shipped product look; the viewport is the shared
 * documentation mid-grey, matching capture.mjs's capability renders.
 *
 * Prerequisites (same as capture.mjs):
 *   1. Build the workspace packages.  2. Start the Feature Lab:  npm run dev --prefix tools/demo (:5199).
 *   3. Chromium from the Playwright cache (CHROME_PATH overrides).  4. npm i playwright-core.
 *
 * Run:  node tools/screenshots/capture-app.mjs [shotName ...]   (no args → all)
 */
/* eslint-env node, browser */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { launchBrowser, savePngDataUrl } from './lib/browser.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEDIA = resolve(__dirname, '../../docs/media');
const BASE = process.env.DEMO_URL || 'http://localhost:5199';
const manifest = JSON.parse(readFileSync(resolve(__dirname, 'app-shots.manifest.json'), 'utf8'));

const only = process.argv.slice(2);
const shots = manifest.shots.filter((s) => only.length === 0 || only.includes(s.name));

/** Drive the Feature Lab into the shot's state, composite the render, and screenshot the full UI. */
async function captureApp(page, shot) {
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.viewer?.preview, null, { timeout: 15000 });
  // Initial toolpath load (Feature Lab auto-loads its default fixture).
  await page.waitForFunction(() => window.viewer.preview.getState().segmentCount > 0, null, { timeout: 30000 });

  const prepare = shot.mode === 'prepare';

  if (prepare) {
    await page.evaluate((fx) => {
      [...document.querySelectorAll('#modeSeg button')].find((b) => b.dataset.mode === 'prepare').click();
      const sel = document.getElementById('fixture');
      sel.value = fx;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, shot.fixture);
    await page.waitForFunction(() => window.viewer.model?.()?.getState?.()?.ready === true, null, { timeout: 30000 });
  } else {
    await page.evaluate(
      ({ fx, color }) => {
        const sel = document.getElementById('fixture');
        sel.value = fx;
        document.getElementById('parse').click();
        if (color) {
          const cm = document.getElementById('colorMode');
          cm.value = color;
          cm.dispatchEvent(new Event('change', { bubbles: true }));
        }
      },
      { fx: shot.fixture, color: shot.color }
    );
    await page.waitForFunction(
      () => {
        const s = document.getElementById('status')?.textContent || '';
        return s.startsWith('Loaded') || s.startsWith('Done') || s.startsWith('Partial') || s.includes('failed');
      },
      null,
      { timeout: 90000 }
    );
    if (shot.tab) await page.evaluate((t) => document.querySelector(`[data-tab="${t}"]`)?.click(), shot.tab);
    // Wait for the FINAL geometry build to settle so render diagnostics aren't stale (a heavy fixture's
    // build lags the "Loaded" status): poll until getRenderStats reflects the loaded segment count.
    await page
      .waitForFunction(
        () => {
          const st = window.viewer.preview.getState();
          const rs = window.viewer.preview.controls.getRenderStats();
          return st.segmentCount > 0 && rs && rs.sourceSegmentCount === st.segmentCount;
        },
        null,
        { timeout: 60000 }
      )
      .catch(() => {});
  }

  // Frame + preset view on whichever viewer is active.
  await page.evaluate((v) => {
    const c =
      window.viewer.model && document.getElementById('modelView') && !document.getElementById('modelView').hidden
        ? window.viewer.model().controls
        : window.viewer.preview.controls;
    c.setView(v || 'iso');
    c.frame();
  }, shot.view);
  await page.waitForTimeout(700);
  // Read render diagnostics AFTER the build has settled (so the panel matches the shown model).
  if (shot.readStats) await page.evaluate(() => document.getElementById('showStats')?.click());
  await page.waitForTimeout(150);

  // Composite the real render into the viewport-wrap, then screenshot the whole app.
  //
  // Copy the LIVE canvas backing store (drawImage → toDataURL) rather than `controls.capture()`.
  // capture() renders to an off-screen WebGLRenderTarget and reads the pixels back in LINEAR colour
  // space — no sRGB output encoding — which darkens the mid-grey documentation workspace to its linear
  // value (#6d7176 → ~#272a2e). The live canvas the visitor actually sees is sRGB-correct, so copying
  // it (repaint first, since the demo runs without preserveDrawingBuffer) yields the true colours.
  await page.evaluate(() => {
    const prepare = !!document.getElementById('modelView') && !document.getElementById('modelView').hidden;
    const src = document.getElementById(prepare ? 'modelView' : 'view');
    // Repaint the live canvas right before copying so its backing store is current: the toolpath stage
    // runs without preserveDrawingBuffer, and the model's preserved buffer can hold only a background
    // clear by copy time. frame() re-renders the model synchronously (there is no bare render()).
    if (prepare) window.viewer.model()?.controls.frame();
    else window.viewer.preview.raw.renderer().render();
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    const wrap = document.querySelector('.gp-viewport-wrap');
    wrap.style.backgroundImage = `url(${c.toDataURL('image/png')})`;
    wrap.style.backgroundSize = 'cover';
    wrap.style.backgroundPosition = 'center';
    for (const cv of wrap.querySelectorAll('canvas')) cv.style.opacity = '0';
  });
  await page.waitForTimeout(200);
  const png = await page.screenshot({ type: 'png' });
  const out = resolve(MEDIA, `${shot.name}.png`);
  savePngDataUrl(out, 'data:image/png;base64,' + png.toString('base64'));
  console.log(`  ✓ ${shot.name}.png`);
}

const run = async () => {
  const { browser } = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 880 }, deviceScaleFactor: 1.5 });
  for (const shot of shots) {
    console.log(`— ${shot.name} (${shot.mode})`);
    await captureApp(page, shot);
  }
  await browser.close();
  console.log(`\n✅ ${shots.length} app-UI shot(s) written to docs/media/`);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
