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
 * (see the composite step). The dark chrome IS the shipped product look. The Feature Lab starts on the
 * opt-in Studio look (DD-032), so these shots show it; `look` / `lens` / `plate` in the manifest pick another
 * look, lens or plate. The SDK's own default look is unchanged: Studio is a preset a consumer opts into.
 *
 * Prerequisites (same as capture.mjs):
 *   1. Build the workspace packages.  2. Start the Feature Lab:  npm run dev --prefix tools/demo (:5199).
 *   3. Chromium from the Playwright cache (CHROME_PATH overrides).  4. npm i playwright-core.
 *
 * Run:  node tools/screenshots/capture-app.mjs [shotName ...]   (no args → all)
 */
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
  if (shot.kind === 'lens-compare') return captureLensCompare(page, shot);

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

  // Look / lens / plate (the Feature Lab's own controls, driven the way a visitor would).
  await page.evaluate(
    ({ look, lens, plate }) => {
      const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
      if (look) {
        const t = document.getElementById('theme');
        t.value = look;
        fire(t, 'change');
      }
      if (lens) {
        const l = document.getElementById('lens');
        l.value = String(lens);
        fire(l, 'input');
      }
      if (plate) {
        const sel = document.getElementById('plateSelect');
        sel.value = String(plate);
        fire(sel, 'change');
      }
    },
    { look: shot.look, lens: shot.lens, plate: shot.plate }
  );
  if (shot.plate) {
    await page.waitForFunction(
      () => !/placement: known/.test(document.getElementById('placementInfo').textContent),
      null,
      { timeout: 10000 }
    );
  }

  // Frame + preset view on whichever viewer is active.
  await page.evaluate(
    ([v, dolly]) => {
      const c =
        window.viewer.model && document.getElementById('modelView') && !document.getElementById('modelView').hidden
          ? window.viewer.model().controls
          : window.viewer.preview.controls;
      c.setView(v || 'iso');
      c.frame();
      // The model viewer frames the part, not the plate: pull back so a small part's plate is in view.
      if (dolly) {
        const cs = c.getCameraState();
        if (cs) {
          const t = cs.target;
          const k = (a, b) => b + (a - b) * dolly;
          c.setCameraState({
            ...cs,
            position: { x: k(cs.position.x, t.x), y: k(cs.position.y, t.y), z: k(cs.position.z, t.z) }
          });
        }
      }
    },
    [shot.view, shot.dolly]
  );
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
  await page.evaluate((keepCamera) => {
    const prepare = !!document.getElementById('modelView') && !document.getElementById('modelView').hidden;
    const src = document.getElementById(prepare ? 'modelView' : 'view');
    // Repaint the live canvas right before copying so its backing store is current: the toolpath stage
    // runs without preserveDrawingBuffer, and the model's preserved buffer can hold only a background
    // clear by copy time. frame() re-renders the model synchronously (there is no bare render()).
    if (prepare && !keepCamera) window.viewer.model()?.controls.frame();
    // A dollied camera must survive, and frame() would undo it: resize() repaints without moving it.
    else if (prepare) window.viewer.model()?.controls.resize(src.clientWidth, src.clientHeight);
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
  }, !!shot.dolly);
  await page.waitForTimeout(200);
  const png = await page.screenshot({ type: 'png' });
  const out = resolve(MEDIA, `${shot.name}.png`);
  savePngDataUrl(out, 'data:image/png;base64,' + png.toString('base64'));
  console.log(`  ✓ ${shot.name}.png`);
}

/**
 * Two real renders of the same file side by side, one per lens: the SDK default 50 degrees and the Studio
 * preset's 32 degrees. Each half is the live canvas of the Feature Lab (not a mock-up); only the layout and
 * the two labels are added.
 */
async function captureLensCompare(page, shot) {
  await page.evaluate((fx) => {
    const sel = document.getElementById('fixture');
    sel.value = fx;
    document.getElementById('parse').click();
  }, shot.fixture);
  await page.waitForFunction(() => (document.getElementById('status')?.textContent || '').startsWith('Loaded'), null, {
    timeout: 90000
  });
  // Hide the inspector rail so the viewport is the whole frame, like the single-render shots.
  const halves = [];
  for (const lens of shot.lenses) {
    await page.evaluate(
      ({ lens, view }) => {
        const l = document.getElementById('lens');
        l.value = String(lens);
        l.dispatchEvent(new Event('input', { bubbles: true }));
        const c = window.viewer.preview.controls;
        c.setView(view || 'iso');
        c.frame();
      },
      { lens, view: shot.view }
    );
    await page.waitForTimeout(900);
    halves.push(
      await page.evaluate(() => {
        window.viewer.preview.raw.renderer().render();
        const src = document.getElementById('view');
        const c = document.createElement('canvas');
        c.width = src.width;
        c.height = src.height;
        c.getContext('2d').drawImage(src, 0, 0);
        return c.toDataURL('image/png');
      })
    );
  }
  const url = await page.evaluate(
    async ({ halves, labels }) => {
      const imgs = await Promise.all(
        halves.map(
          (h) =>
            new Promise((ok) => {
              const i = new Image();
              i.onload = () => ok(i);
              i.src = h;
            })
        )
      );
      const w = imgs[0].width,
        h = imgs[0].height,
        gap = 8,
        bar = 44;
      const out = document.createElement('canvas');
      out.width = w * imgs.length + gap * (imgs.length - 1);
      out.height = h + bar;
      const x = out.getContext('2d');
      x.fillStyle = '#111419';
      x.fillRect(0, 0, out.width, out.height);
      imgs.forEach((im, k) => {
        x.drawImage(im, k * (w + gap), bar);
        x.fillStyle = '#e8eaee';
        x.font = '600 24px system-ui, sans-serif';
        x.textBaseline = 'middle';
        x.fillText(labels[k], k * (w + gap) + 14, bar / 2);
      });
      return out.toDataURL('image/png');
    },
    { halves, labels: shot.labels }
  );
  savePngDataUrl(resolve(MEDIA, `${shot.name}.png`), url);
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
