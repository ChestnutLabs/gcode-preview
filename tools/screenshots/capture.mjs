/**
 * Documentation media capture harness.
 *
 * Drives the running `tools/demo` app (http://localhost:5199) with a headless
 * Chromium and writes the toolpath renders used in the root README and the
 * user manual to `docs/media/`. Every image is a real render of a real file
 * from the tracked MIT demo corpus — nothing is mocked or hand-edited.
 *
 * Prerequisites (see tools/screenshots/README.md):
 *   1. Build the workspace packages so the demo can resolve them.
 *   2. Start the demo:  cd tools/demo && npm install && npm run dev
 *   3. Have Google Chrome / Chromium installed (CHROME_PATH overrides the path).
 *   4. npm i -D playwright-core   (kept out of the repo dependency tree)
 *
 * Run:  node tools/screenshots/capture.mjs [shotName ...]
 * With no args it captures every shot; pass names to capture a subset.
 */
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEDIA = resolve(__dirname, '../../docs/media');
const BASE = process.env.DEMO_URL || 'http://localhost:5199';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome-stable';
const VIEW = { width: 1320, height: 760 };
const SCALE = 2;

// Palettes mirror the demo (tools/demo/src/main.js) so colors match the app.
const PAL = {
  feature: [[0.9,0.4,0.7],[0.35,0.7,0.95],[0.95,0.75,0.3],[0.5,0.9,0.5],[0.8,0.5,0.95]],
  tool: [[0.9,0.4,0.7],[0.35,0.7,0.95],[0.95,0.75,0.3],[0.5,0.9,0.5]],
  height: [[0.15,0.4,0.9],[0.2,0.85,0.45],[0.95,0.85,0.2],[0.9,0.3,0.2]],
  speed: [[0.13,0.35,0.92],[0.96,0.85,0.22],[0.9,0.22,0.16]]
};

/** Each shot: name, corpus file, quality, and a `setup` body run in-page after parse. */
const SHOTS = [
  { name: 'viewer-benchy-tubes', file: 'gcodes/3DBenchy.gcode', quality: 'tubes',
    color: { mode: 'feature', palette: PAL.feature, fallback: [0.55,0.55,0.55] } },

  { name: 'layer-clip-benchy', file: 'gcodes/3DBenchy.gcode', quality: 'tubes',
    color: { mode: 'feature', palette: PAL.feature, fallback: [0.55,0.55,0.55] },
    layerRange: 'mid' },

  { name: 'color-speed-calicat', file: 'gcodes/calicat.gcode', quality: 'tubes',
    color: { mode: 'feedrate', ramp: PAL.speed, fallback: [0.55,0.6,0.62] } },

  { name: 'color-layerheight', file: 'fixtures/annotations/variable-layers.gcode', quality: 'tubes',
    color: { mode: 'layerHeight', ramp: PAL.height, fallback: [0.6,0.6,0.6] } },

  { name: 'cnc-cut-vs-rapid', file: 'gcodes/easel.gcode', quality: 'lines',
    color: { mode: 'moveKind', cut: [0.95,0.45,0.6], travel: [0.3,0.55,0.65], fallback: [0.6,0.6,0.6] },
    travel: true },

  { name: 'progress-known', file: 'gcodes/calicat.gcode', quality: 'lines',
    progress: 'byte' },

  { name: 'progress-approximated', file: 'gcodes/calicat.gcode', quality: 'lines',
    progress: 'layer' },

  { name: 'camera-top', file: 'gcodes/3DBenchy.gcode', quality: 'lines',
    color: { mode: 'single', color: [0.55,0.75,0.95] }, camera: 'orthographic', view: 'top' },
  { name: 'camera-front', file: 'gcodes/3DBenchy.gcode', quality: 'lines',
    color: { mode: 'single', color: [0.55,0.75,0.95] }, camera: 'orthographic', view: 'front' },
  { name: 'camera-iso', file: 'gcodes/3DBenchy.gcode', quality: 'lines',
    color: { mode: 'single', color: [0.55,0.75,0.95] } },

  { name: 'retraction-markers', file: 'gcodes/calicat.gcode', quality: 'tubes',
    color: { mode: 'feature', palette: PAL.feature, fallback: [0.55,0.55,0.55] },
    retractions: true, layerRange: 'low' },

  // Full-app frame: sidebar controls + live render (embeddable inspection UI).
  { name: 'app-control-panel', file: 'gcodes/3DBenchy.gcode', quality: 'tubes',
    color: { mode: 'feature', palette: PAL.feature, fallback: [0.55,0.55,0.55] },
    view: 'iso', fullPage: true }
];

async function parse(page, file) {
  await page.evaluate((f) => {
    const sel = document.getElementById('fixture');
    sel.value = f;
    document.getElementById('parse').click();
  }, file);
  await page.waitForFunction(() => {
    const s = document.getElementById('status')?.textContent || '';
    return s.startsWith('Done') || s.startsWith('Partial') || s.includes('failed');
  }, null, { timeout: 90000 });
  await page.waitForTimeout(400);
}

async function apply(page, shot) {
  // Geometry uploads incrementally; watch for buildComplete so we never capture
  // a half-built model.
  await page.evaluate(() => {
    window.__built = false;
    window.viewer.renderer.onEvent((e) => { if (e.type === 'buildComplete') window.__built = true; });
  });
  await page.evaluate((shot) => {
    const r = window.viewer.renderer;
    if (shot.quality) r.setQuality(shot.quality);
    if (shot.color) r.setColorMode(shot.color);
    if (shot.travel !== undefined) r.setKindVisible('travel', shot.travel);
    if (shot.retractions) r.setShowRetractions(true);
    if (shot.camera) r.setCameraMode(shot.camera);
    if (shot.layerRange) {
      const n = r.layerCount;
      if (shot.layerRange === 'mid') r.setLayerRange(0, Math.max(0, Math.round(n * 0.42)));
      else if (shot.layerRange === 'low') r.setLayerRange(0, Math.max(0, Math.round(n * 0.18)));
    }
  }, shot);
  // Wait for the full geometry to finish uploading (setQuality triggers a rebuild).
  await page.waitForFunction(() => window.__built === true, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.evaluate((shot) => {
    const r = window.viewer.renderer;
    if (shot.progress) {
      const m = window.viewer.sim.mapper;
      const ir = r.ir;
      const now = Date.now();
      const obs = shot.progress === 'byte'
        ? { v:1, timestampMs: now, state:'printing', position:{ byte: Math.round(0.55 * window.viewer.sim.fileBytes) } }
        : { v:1, timestampMs: now, state:'printing', position:{ layer: Math.round(ir.layers.length * 0.5), totalLayers: ir.layers.length } };
      r.setProgress(m.observe(obs));
    }
    r.frame();
    if (shot.view) {
      r.setView(shot.view);
    } else if (!shot.camera) {
      // Consistent, slightly-lower 3/4 elevation (~22°) across every perspective
      // shot — frame()'s default sits steeper. Uses the same bounds→scene mapping.
      // CNC/laser cut moves aren't extrusion, so extrude-only bounds are null —
      // fall back to travel-inclusive bounds so the toolpath frames.
      const b = Number.isFinite(r.ir.bounds.min.x) ? r.ir.bounds : r.ir.boundsWithTravel;
      const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2, cz = (b.min.z + b.max.z) / 2;
      const radius = Math.max(10, Math.hypot(b.max.x - cx, b.max.y - cy, b.max.z - cz));
      const t = { x: cx, y: cz, z: -cy };
      const cam = r.activeCamera;
      cam.position.set(t.x - radius * 1.75, t.y + radius * 1.05, t.z + radius * 2.05);
      cam.lookAt(t.x, t.y, t.z);
      if (r.controls) { r.controls.target.set(t.x, t.y, t.z); r.controls.update(); }
    }
    r.render();
  }, shot);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.viewer.renderer.render());
  await page.waitForTimeout(200);
}

const want = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: SCALE });
page.on('pageerror', e => console.log('  [pageerror]', e.message));

for (const shot of SHOTS) {
  if (want.length && !want.includes(shot.name)) continue;
  process.stdout.write(`• ${shot.name} … `);
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.viewer, null, { timeout: 15000 });
  await parse(page, shot.file);
  await apply(page, shot);
  const out = resolve(MEDIA, shot.name + '.png');
  if (shot.fullPage) {
    // page.screenshot stalls on a live WebGL surface under headless SwiftShader.
    // Freeze the GL frame into a static <img> overlay first, then screenshot the
    // DOM (real sidebar + frozen render).
    await page.evaluate(() => {
      const src = document.getElementById('view');
      window.viewer.renderer.render();
      const c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
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
    // Copy the GL backing store into a 2D canvas in the same task and read it
    // as a PNG — the approach the repo's own VR harness uses. Deterministic and
    // free of the compositor stability wait a live rAF loop would stall on.
    const dataUrl = await page.evaluate(() => {
      const gl = window.viewer.renderer;
      gl.render();
      const src = document.getElementById('view');
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      c.getContext('2d').drawImage(src, 0, 0);
      return c.toDataURL('image/png');
    });
    writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
  console.log('saved', out);
}
await browser.close();
console.log('done');
