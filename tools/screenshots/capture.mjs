/**
 * Documentation media capture harness (manifest-driven).
 *
 * Reads `shots.manifest.json` and drives the running `tools/demo` app with a
 * headless Chromium, writing every documentation image to `docs/media/`. Each
 * image is a real render of a real file from the tracked MIT demo corpus on the
 * shared mid-grey documentation presentation (`lib/presentation.mjs`) — nothing
 * is mocked or hand-edited.
 *
 * Prerequisites (see tools/screenshots/README.md):
 *   1. Build the workspace packages so the demo can resolve them.
 *   2. Start the demo:  cd tools/demo && npm install && npm run dev   (:5199)
 *   3. A Chromium is auto-located from the Playwright cache; CHROME_PATH overrides.
 *   4. npm i playwright-core   (kept out of the repo dependency tree)
 *
 * Run:  node tools/screenshots/capture.mjs [shotName ...]
 *   No args  → every shot in the manifest.
 *   Names    → just those shots.
 */
/* eslint-env node, browser */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { launchBrowser, readCanvasPng, savePngDataUrl } from './lib/browser.mjs';
import { docTheme, VIEW, SCALE, PAL, DOC_BACKGROUND_CSS } from './lib/presentation.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEDIA = resolve(__dirname, '../../docs/media');
const BASE = process.env.DEMO_URL || 'http://localhost:5199';
const manifest = JSON.parse(readFileSync(resolve(__dirname, 'shots.manifest.json'), 'utf8'));

/** Expand a compact color spec from the manifest into the ColorMode the demo expects. */
function expandColor(spec) {
  if (!spec) return null;
  const out = { mode: spec.mode, fallback: spec.fallback };
  if (spec.color) out.color = spec.color;
  if (spec.mode === 'feature' || spec.mode === 'tool' || spec.mode === 'object') out.palette = PAL[spec.mode];
  if (spec.mode === 'feedrate') out.ramp = PAL.speed;
  if (spec.mode === 'layerHeight') out.ramp = PAL.height;
  if (spec.mode === 'moveKind') {
    out.cut = spec.cut;
    out.travel = spec.travel;
  }
  return out;
}

async function parseCorpus(page, file) {
  await page.evaluate((f) => {
    const sel = document.getElementById('fixture');
    sel.value = f;
    if (sel.value !== f) throw new Error('fixture not in corpus select: ' + f);
    document.getElementById('parse').click();
  }, file);
  await page.waitForFunction(
    () => {
      const s = document.getElementById('status')?.textContent || '';
      return s.startsWith('Done') || s.startsWith('Partial') || s.includes('failed');
    },
    null,
    { timeout: 90000 }
  );
  await page.waitForTimeout(300);
}

/** Toolpath renders (the main demo). Applies params, then the doc theme LAST so it wins. */
async function driveToolpath(page, shot) {
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.viewer, null, { timeout: 15000 });
  await parseCorpus(page, shot.file);

  await page.evaluate(() => {
    window.__built = false;
    window.viewer.renderer.onEvent((e) => {
      if (e.type === 'buildComplete') window.__built = true;
    });
  });

  const color = expandColor(shot.color);
  await page.evaluate(
    ({ shot, color }) => {
      const r = window.viewer.renderer;
      if (shot.quality) r.setQuality(shot.quality);
      if (color) r.setColorMode(color);
      if (shot.travel !== undefined && shot.travel !== null) r.setKindVisible('travel', shot.travel);
      if (shot.retractions) r.setShowRetractions(true);
      if (shot.camera) r.setCameraMode(shot.camera);
      if (shot.frameContent) r.setFrameContent(shot.frameContent);
      if (shot.bedShape) r.setBuildVolume(shot.bedShape);
      if (shot.layerRange) {
        const n = r.layerCount;
        if (shot.layerRange === 'mid') r.setLayerRange(0, Math.max(0, Math.round(n * 0.42)));
        else if (shot.layerRange === 'low') r.setLayerRange(0, Math.max(0, Math.round(n * 0.18)));
        else if (Array.isArray(shot.layerRange)) r.setLayerRange(shot.layerRange[0], shot.layerRange[1]);
      }
    },
    { shot, color }
  );

  await page.waitForFunction(() => window.__built === true, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(300);

  // Progress overlay, framing, camera, and the doc theme (applied last so it wins).
  await page.evaluate(
    ({ shot, theme }) => {
      const r = window.viewer.renderer;
      r.setTheme(theme);
      // Non-rectangular bed (DD-030 D3): auto-fit a round/polygon bed around the
      // model's XY footprint and frame the bed so the build surface is visible.
      if (shot.bed) {
        const b = Number.isFinite(r.ir.bounds.min.x) ? r.ir.bounds : r.ir.boundsWithTravel;
        const cx = (b.min.x + b.max.x) / 2,
          cy = (b.min.y + b.max.y) / 2;
        const ext = Math.max(b.max.x - b.min.x, b.max.y - b.min.y);
        const size = Math.max(40, ext * (shot.bed.fit || 1.9));
        const z = Math.max(60, b.max.z + 20);
        let shape;
        if (shot.bed.shape === 'circular') {
          shape = { kind: 'circular', center: { x: cx, y: cy }, diameter: size };
        } else {
          const n = shot.bed.sides || 6;
          const R = size / 2;
          const pts = [];
          for (let i = 0; i < n; i++) {
            const a = (Math.PI / 2) + (i * 2 * Math.PI) / n;
            pts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
          }
          shape = { kind: 'polygon', points: pts };
        }
        r.setBuildVolume({ x: size, y: size, z, min: { x: cx - size / 2, y: cy - size / 2 }, shape });
        // Frame the whole bed from a steeper, pulled-back 3/4 angle so the bed
        // OUTLINE (the point of the shot) reads clearly above the model.
        const t = { x: cx, y: 0, z: -cy };
        const radius = size * 1.05;
        const cam = r.camera;
        cam.position.set(t.x - radius * 0.7, t.y + radius * 1.35, t.z + radius * 1.0);
        cam.lookAt(t.x, t.y, t.z);
        if (r.controls) {
          r.controls.target.set(t.x, t.y, t.z);
          r.controls.update();
        }
        r.render();
        return;
      }
      if (shot.progress) {
        const m = window.viewer.sim.mapper;
        const ir = r.ir;
        const now = Date.now();
        const obs =
          shot.progress === 'byte'
            ? { v: 1, timestampMs: now, state: 'printing', position: { byte: Math.round(0.55 * window.viewer.sim.fileBytes) } }
            : { v: 1, timestampMs: now, state: 'printing', position: { layer: Math.round(ir.layers.length * 0.5), totalLayers: ir.layers.length } };
        r.setProgress(m.observe(obs));
      }
      r.frame();
      if (shot.view) {
        r.setView(shot.view);
      } else if (!shot.camera) {
        // Consistent slightly-lower ~22° 3/4 elevation across perspective shots.
        // CNC/laser cut moves aren't extrusion → extrude-only bounds can be empty;
        // fall back to travel-inclusive bounds so the toolpath frames.
        const b = Number.isFinite(r.ir.bounds.min.x) ? r.ir.bounds : r.ir.boundsWithTravel;
        const cx = (b.min.x + b.max.x) / 2,
          cy = (b.min.y + b.max.y) / 2,
          cz = (b.min.z + b.max.z) / 2;
        const radius = Math.max(10, Math.hypot(b.max.x - cx, b.max.y - cy, b.max.z - cz));
        const t = { x: cx, y: cz, z: -cy };
        const cam = r.camera;
        cam.position.set(t.x - radius * 1.75, t.y + radius * 1.05, t.z + radius * 2.05);
        cam.lookAt(t.x, t.y, t.z);
        if (r.controls) {
          r.controls.target.set(t.x, t.y, t.z);
          r.controls.update();
        }
      }
      r.render();
    },
    { shot, theme: docTheme({ withBed: !!shot.withBed }) }
  );
  await page.waitForTimeout(400);

  const out = resolve(MEDIA, shot.name + '.png');
  if (shot.fullPage) {
    // page.screenshot stalls on a live WebGL surface under headless SwiftShader.
    // Freeze the GL frame into a static <img> overlay, then screenshot the DOM.
    await page.evaluate(() => {
      const src = document.getElementById('view');
      window.viewer.renderer.render();
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      c.getContext('2d').drawImage(src, 0, 0);
      const img = document.createElement('img');
      img.src = c.toDataURL('image/png');
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
      src.parentElement.appendChild(img);
      src.style.visibility = 'hidden';
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: out, timeout: 30000 });
  } else {
    savePngDataUrl(out, await readCanvasPng(page, 'view'));
  }
}

/** Canvas-2D fallback render (2d.html). */
async function driveCanvas2d(page, shot) {
  await page.goto(BASE + '/2d.html', { waitUntil: 'load' });
  await page.waitForFunction(() => (document.getElementById('status')?.textContent || '').includes('layers'), null, { timeout: 30000 });
  await page.waitForTimeout(300);
  const url = await page.evaluate((bg) => {
    const layer = document.getElementById('layer');
    const ghost = document.getElementById('ghost');
    layer.value = String(Math.round(Number(layer.max) * 0.5));
    layer.dispatchEvent(new Event('input'));
    ghost.value = '2';
    ghost.dispatchEvent(new Event('input'));
    const c = document.getElementById('view');
    // Tight bbox of lit pixels, padded.
    const s = document.createElement('canvas');
    s.width = c.width;
    s.height = c.height;
    const sx = s.getContext('2d');
    sx.drawImage(c, 0, 0);
    const d = sx.getImageData(0, 0, c.width, c.height).data;
    let minX = c.width,
      minY = c.height,
      maxX = 0,
      maxY = 0;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i] + d[i + 1] + d[i + 2] > 40 && d[i + 3] > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    const pad = Math.round((maxX - minX) * 0.12) + 8;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(c.width, maxX + pad);
    maxY = Math.min(c.height, maxY + pad);
    const sw = maxX - minX,
      sh = maxY - minY;
    const OW = 1000,
      OH = 750;
    const o = document.createElement('canvas');
    o.width = OW;
    o.height = OH;
    const ox = o.getContext('2d');
    ox.fillStyle = bg;
    ox.fillRect(0, 0, OW, OH);
    const scale = Math.min(OW / sw, OH / sh);
    const dw = sw * scale,
      dh = sh * scale;
    ox.imageSmoothingEnabled = true;
    ox.drawImage(c, minX, minY, sw, sh, (OW - dw) / 2, (OH - dh) / 2, dw, dh);
    return o.toDataURL('image/png');
  }, DOC_BACKGROUND_CSS);
  savePngDataUrl(resolve(MEDIA, shot.name + '.png'), url);
}

/** Model presentation still (model.html) — asserts the honesty tiers before saving. */
async function driveModel(page, shot) {
  await page.goto(BASE + '/model.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__modelResult, null, { timeout: 30000 });
  const result = await page.evaluate(() => window.__modelResult);
  if (result.threemf.materials !== 'known' || result.stl.materials !== 'unavailable') {
    throw new Error('unexpected materials tiers: ' + JSON.stringify(result));
  }
  await page.waitForTimeout(300);
  await page.locator('#cards').screenshot({ path: resolve(MEDIA, shot.name + '.png') });
}

const want = process.argv.slice(2);
const shots = manifest.shots.filter((s) => !want.length || want.includes(s.name));
if (!shots.length) {
  console.error('No matching shots. Names:', manifest.shots.map((s) => s.name).join(', '));
  process.exit(1);
}

const { browser, executablePath } = await launchBrowser();
console.log('chromium:', executablePath);
const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: SCALE });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

for (const shot of shots) {
  process.stdout.write(`• ${shot.name} (${shot.page}) … `);
  try {
    if (shot.page === 'toolpath') await driveToolpath(page, shot);
    else if (shot.page === 'canvas2d') await driveCanvas2d(page, shot);
    else if (shot.page === 'model') await driveModel(page, shot);
    else throw new Error('unknown page: ' + shot.page);
    console.log('saved');
  } catch (e) {
    console.log('FAILED:', e.message.split('\n')[0]);
  }
}
await browser.close();
console.log('done');
