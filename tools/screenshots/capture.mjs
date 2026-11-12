/**
 * Documentation media capture harness (manifest-driven).
 *
 * Reads `shots.manifest.json` and drives the running `tools/demo` Feature Lab through its published
 * controller (`window.viewer.preview.controls` / `getState()` / events — no renderer reach-ins) with a
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
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { launchBrowser, savePngDataUrl, encodeWebm } from './lib/browser.mjs';
import { applyUntilStable, diffApplied, findDuplicateImages } from './lib/stabilize.mjs';
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

/**
 * Install the readiness probe on a fresh Feature Lab page. It listens to the controller's public
 * `buildComplete` / `stage` events and records when the last one fired, so `settle()` can tell
 * "the geometry build is finished and quiet" without reading any private renderer state.
 */
async function installProbe(page) {
  await page.evaluate(() => {
    const probe = { last: performance.now(), builds: 0, ledger: {} };
    window.__probe = probe;
    window.viewer.preview.onEvent((e) => {
      if (e.type === 'buildComplete') probe.builds++;
      if (e.type === 'buildComplete' || e.type === 'stage') probe.last = performance.now();
    });
    // Ledger of the LAST value ANY caller (the Lab's own handlers included) wrote through the public
    // controls. getState() does not expose colour mode or layer range, so this is how the harness proves
    // the shot's settings survived the Lab re-applying its own.
    const c = window.viewer.preview.controls;
    const clone = (v) => JSON.parse(JSON.stringify(v));
    const wrap = (method, record) => {
      const orig = c[method].bind(c);
      c[method] = (...a) => {
        record(a);
        return orig(...a);
      };
    };
    wrap('setColorMode', (a) => (probe.ledger.colorMode = clone(a[0])));
    wrap('setLayerRange', (a) => (probe.ledger.layerRange = clone(a)));
    wrap('setTheme', (a) => (probe.ledger.theme = clone(a[0])));
    wrap('setCameraFov', (a) => (probe.ledger.fov = clone(a[0])));
    wrap('setBuildVolumeCage', (a) => (probe.ledger.cage = clone(a[0])));
    wrap('setKindVisible', (a) => {
      if (a[0] === 'travel') probe.ledger.travel = clone(a[1]);
    });
  });
}

/**
 * Wait until the model is parsed, the renderer reports stats for it, and no build/stage event has fired
 * for `quietMs` (the build pipeline is idle). This replaces the old "Done" status-text wait.
 */
async function settle(page, quietMs = 800) {
  await page.waitForFunction(
    (q) => {
      const p = window.viewer.preview;
      const s = p.getState();
      return (
        !s.parsing && s.segmentCount > 0 && !!p.controls.getRenderStats() && performance.now() - window.__probe.last > q
      );
    },
    quietMs,
    { timeout: 120000 }
  );
}

/**
 * Fetch a corpus file from the demo's served test-data root and parse it through the published
 * controller (`preview.parse`). The result's neutral IR is kept on `window.__ir` for framing math.
 */
async function loadFixture(page, file) {
  const err = await page.evaluate(async (f) => {
    const res = await fetch(f);
    if (!res.ok) return `fixture not served (${res.status}): ${f}`;
    const bytes = new Uint8Array(await res.arrayBuffer());
    window.__fileBytes = bytes.byteLength;
    const outcome = await window.viewer.preview.parse(bytes);
    if (!outcome.ok) return `parse failed: ${outcome.error?.message}`;
    window.__ir = outcome.result.ir;
    return null;
  }, file);
  if (err) throw new Error(err);
  await settle(page);
}

/**
 * A data URL of the live scene via the public `controls.capture()` (sRGB-correct, no repaint hack),
 * rendered at 2x the viewport's CSS size so the documentation images stay crisp.
 */
function capturePng(page, opts = {}) {
  return page.evaluate(async (o) => {
    const cv = document.getElementById('view');
    const blob = await window.viewer.preview.controls.capture({
      width: Math.round(cv.clientWidth * 2),
      height: Math.round(cv.clientHeight * 2),
      ...o
    });
    return await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
  }, opts);
}

/**
 * Hard post-condition before any pixel is captured: the last value the controller received for each
 * setting must be the shot's, so a Lab re-apply that won the race fails the shot instead of the review.
 */
async function assertApplied(page, shot, color, theme) {
  const { ledger, layers } = await page.evaluate(() => ({
    ledger: window.__probe.ledger,
    layers: window.viewer.preview.getState().layerCount
  }));
  const expected = { theme, fov: 50, cage: true };
  if (color) expected.colorMode = color;
  if (shot.travel !== undefined && shot.travel !== null) expected.travel = shot.travel;
  if (shot.layerRange === 'mid') expected.layerRange = [0, Math.max(0, Math.round(layers * 0.42))];
  else if (shot.layerRange === 'low') expected.layerRange = [0, Math.max(0, Math.round(layers * 0.18))];
  else if (Array.isArray(shot.layerRange)) expected.layerRange = shot.layerRange;
  const bad = diffApplied(ledger, expected);
  if (bad.length) throw new Error('settings lost after settle: ' + bad.join('; '));
}

/** Toolpath renders (the Feature Lab, driven through its published controller). Doc theme is applied LAST. */
async function driveToolpath(page, shot) {
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.viewer?.preview, null, { timeout: 15000 });
  // The Lab auto-loads its default fixture; let that finish before we swap in ours.
  await page.waitForFunction(() => window.viewer.preview.getState().segmentCount > 0, null, { timeout: 60000 });
  await installProbe(page);
  await loadFixture(page, shot.file);

  const color = expandColor(shot.color);

  // Every setting, the framing and the doc theme in ONE idempotent pass, repeated until a round fires no
  // further build. The Lab re-applies ITS colour mode, theme and full layer range on every buildComplete,
  // and our own calls (quality, colour, theme) can trigger that rebuild, so a single pass is not enough.
  const theme = docTheme({ withBed: !!shot.withBed });
  const applyShot = () =>
    page.evaluate(
      ({ shot, color, theme }) => {
        const p = window.viewer.preview;
        const c = p.controls;
        const ir = window.__ir;
        const layers = p.getState().layerCount;
        // Start the quiet window NOW: a rebuild these calls trigger is asynchronous, so without this a
        // settle that began before the call could return before the build has even started.
        window.__probe.last = performance.now();
        // Calls that rebuild geometry run once per shot (re-running them would rebuild every round and the
        // loop could never converge). The Lab does not touch them, so they cannot be clobbered; the
        // idempotent calls below (layer range, colour, theme, lens, cage) re-run every round.
        const done = (window.__once ??= new Set());
        const once = (key, fn) => {
          if (done.has(key)) return;
          done.add(key);
          fn();
        };
        if (shot.quality) once('quality', () => c.setQuality(shot.quality));
        if (shot.travel !== undefined && shot.travel !== null)
          once('travel', () => c.setKindVisible('travel', shot.travel));
        if (shot.retractions) once('retractions', () => c.setShowRetractions(true));
        if (shot.camera) once('camera', () => c.setCameraMode(shot.camera));
        if (shot.frameContent) once('frameContent', () => c.setFrameContent(shot.frameContent));
        if (shot.bedShape) once('bedShape', () => c.setBuildVolume(shot.bedShape));
        if (shot.layerRange) {
          if (shot.layerRange === 'mid') c.setLayerRange(0, Math.max(0, Math.round(layers * 0.42)));
          else if (shot.layerRange === 'low') c.setLayerRange(0, Math.max(0, Math.round(layers * 0.18)));
          else if (Array.isArray(shot.layerRange)) c.setLayerRange(shot.layerRange[0], shot.layerRange[1]);
        }
        if (color) c.setColorMode(color);
        c.setTheme(theme);
        // The Lab starts on its opt-in Studio look (32° lens, cage off). These images show the SDK default
        // look the docs describe: 50° lens and the build-volume cage on.
        c.setCameraFov(50);
        c.setBuildVolumeCage(true);
        // Place the camera through the public CameraState (position/target in scene coords: printer
        // (x, y, z) maps to scene (x, z, -y)); zoom and cameraMode are kept from the current state.
        const place = (position, target) => c.setCameraState({ ...c.getCameraState(), position, target });
        // Non-rectangular bed (DD-030 D3): auto-fit a round/polygon bed around the
        // model's XY footprint and frame the bed so the build surface is visible.
        if (shot.bed) {
          const b = Number.isFinite(ir.bounds.min.x) ? ir.bounds : ir.boundsWithTravel;
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
              const a = Math.PI / 2 + (i * 2 * Math.PI) / n;
              pts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
            }
            shape = { kind: 'polygon', points: pts };
          }
          once('bed', () =>
            c.setBuildVolume({ x: size, y: size, z, min: { x: cx - size / 2, y: cy - size / 2 }, shape })
          );
          // Frame the whole bed from a steeper, pulled-back 3/4 angle so the bed
          // OUTLINE (the point of the shot) reads clearly above the model.
          const t = { x: cx, y: 0, z: -cy };
          const radius = size * 1.05;
          place({ x: t.x - radius * 0.7, y: t.y + radius * 1.35, z: t.z + radius * 1.0 }, t);
          return;
        }
        if (shot.progress) {
          const now = Date.now();
          const obs =
            shot.progress === 'byte'
              ? { v: 1, timestampMs: now, state: 'printing', position: { byte: Math.round(0.55 * window.__fileBytes) } }
              : {
                  v: 1,
                  timestampMs: now,
                  state: 'printing',
                  position: { layer: Math.round(ir.layers.length * 0.5), totalLayers: ir.layers.length }
                };
          once('progress', () => p.observeProgress(obs));
        }
        if (shot.hideRoles)
          once('hideRoles', () => shot.hideRoles.forEach((role) => c.setFeatureRoleVisible(role, false)));
        c.frame();
        if (shot.view) {
          c.setView(shot.view);
        } else if (!shot.camera) {
          // Consistent slightly-lower ~22° 3/4 elevation across perspective shots.
          // frameContent:'object' frames the printed model (excludes skirt/prime); 'all'/default frames
          // the whole job. CNC cut moves aren't extrusion → extrude-only bounds can be empty; fall back.
          const useModel = shot.frameContent === 'object' && Number.isFinite(ir.modelBounds?.min?.x);
          const b = useModel ? ir.modelBounds : Number.isFinite(ir.bounds.min.x) ? ir.bounds : ir.boundsWithTravel;
          const cx = (b.min.x + b.max.x) / 2,
            cy = (b.min.y + b.max.y) / 2,
            cz = (b.min.z + b.max.z) / 2;
          const radius = Math.max(10, Math.hypot(b.max.x - cx, b.max.y - cy, b.max.z - cz));
          const t = { x: cx, y: cz, z: -cy };
          place({ x: t.x - radius * 1.75, y: t.y + radius * 1.05, z: t.z + radius * 2.05 }, t);
        }
      },
      { shot, color, theme }
    );
  const builds = () => page.evaluate(() => window.__probe.builds);
  await applyUntilStable({ apply: applyShot, builds, settle: () => settle(page) });
  await page.waitForTimeout(300);
  await assertApplied(page, shot, color, theme);

  // Animation: sweep a temporal control across frames and encode a looping WebM.
  // The camera + theme set above stay fixed; only the draw-range changes. Frames
  // are JPEG (the bundled ffmpeg can only decode mjpeg, not png — see encodeWebm).
  if (shot.output === 'webm' && shot.anim) {
    const spec = shot.anim;
    const N = spec.frames || 40;
    const hold = spec.holdFrames || 0; // repeat the final frame so the loop pauses full
    const frames = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      await page.evaluate(
        ({ kind, t }) => {
          const p = window.viewer.preview;
          const c = p.controls;
          if (kind === 'scrub') {
            const total = p.getState().segmentCount;
            c.setScrubPosition(t >= 1 ? null : Math.max(1, Math.round(t * total)));
          } else if (kind === 'layers') {
            const last = Math.max(0, p.getState().layerCount - 1);
            c.setLayerRange(0, Math.max(0, Math.round(t * last)));
          }
        },
        { kind: spec.kind, t }
      );
      await page.waitForTimeout(spec.settleMs || 30);
      frames.push(await capturePng(page, { format: 'image/jpeg', quality: spec.quality || 0.9 }));
    }
    for (let h = 0; h < hold; h++) frames.push(frames[frames.length - 1]);
    encodeWebm(frames, resolve(MEDIA, shot.name + '.webm'), { fps: spec.fps || 16, width: spec.width || 720 });
    return;
  }

  const out = resolve(MEDIA, shot.name + '.png');
  if (shot.recipe === 'transparent-checker') {
    // Prove capture({ background: 'transparent' }) yields real alpha: composite the captured
    // PNG over a checkerboard so the see-through areas are obvious (the card-compositing use case).
    // NOTE: no manifest shot uses this today — headless SwiftShader flattens the render-target readback
    // alpha to opaque, so the composite would be misleading here. Transparent capture is validated on
    // real hardware (AnyBridge RTX 4070); run this recipe on a GPU-backed browser to regenerate the shot.
    const dataUrl = await page.evaluate(async () => {
      const blob = await window.viewer.preview.controls.capture({ background: 'transparent', format: 'image/png' });
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d');
      const s = 28;
      for (let y = 0; y < c.height; y += s)
        for (let x = 0; x < c.width; x += s) {
          ctx.fillStyle = ((x / s + y / s) % 2 === 0 ? 1 : 0) ? '#dcdee1' : '#bfc2c6';
          ctx.fillRect(x, y, s, s);
        }
      ctx.drawImage(bmp, 0, 0);
      return c.toDataURL('image/png');
    });
    savePngDataUrl(out, dataUrl);
    return;
  }
  savePngDataUrl(out, await capturePng(page));
}

/** Canvas-2D fallback render (2d.html). */
async function driveCanvas2d(page, shot) {
  await page.goto(BASE + '/2d.html', { waitUntil: 'load' });
  await page.waitForFunction(() => (document.getElementById('status')?.textContent || '').includes('layers'), null, {
    timeout: 30000
  });
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

// Fail fast (before launching a browser) if a manifest fixture is not in the served corpus: the demo
// serves test-data/ as its public dir, so every toolpath shot's `file` must exist there.
const missing = shots.filter((s) => s.file && !existsSync(resolve(__dirname, '../../test-data', s.file)));
if (missing.length) {
  console.error(
    'Manifest fixtures not found under test-data/:',
    missing.map((s) => `${s.name} -> ${s.file}`).join(', ')
  );
  process.exit(1);
}

const { browser, executablePath } = await launchBrowser();
console.log('chromium:', executablePath);
const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: SCALE });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

const rendered = [];
let failed = 0;
for (const shot of shots) {
  process.stdout.write(`• ${shot.name} (${shot.page}) … `);
  try {
    if (shot.page === 'toolpath') await driveToolpath(page, shot);
    else if (shot.page === 'canvas2d') await driveCanvas2d(page, shot);
    else if (shot.page === 'model') await driveModel(page, shot);
    else throw new Error('unknown page: ' + shot.page);
    console.log('saved');
    if (shot.output !== 'webm') {
      const hash = createHash('sha256')
        .update(readFileSync(resolve(MEDIA, shot.name + '.png')))
        .digest('hex');
      rendered.push({ name: shot.name, hash });
    }
  } catch (e) {
    failed++;
    console.log('FAILED:', e.message.split('\n')[0]);
  }
}
await browser.close();
// Two different shots must never render the same pixels: that means a setting was lost.
const dupes = findDuplicateImages(rendered);
for (const group of dupes) console.error('DUPLICATE IMAGES (byte-identical):', group.join(', '));
if (failed || dupes.length) process.exitCode = 1;
console.log('done');
