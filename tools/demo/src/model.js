/*
 * Model-renderer presentation harness (DD-018). Renders SOURCE MODELS — an STL
 * and a colored 3MF — through the packaged `renderModelStill`, into OffscreenCanvases
 * blitted to visible canvases. This is the *presentation* renderer (thumbnails of the
 * object), distinct from the toolpath renderer the rest of the demo drives.
 *
 * Both inputs are fully synthetic and MIT-clean: the STL is generated here in-page;
 * the 3MF comes from tools/fixtures/make-model-3mf.mjs (three blocks with real
 * basematerials colors → the capability-honest `materials: 'known'` path). The STL
 * carries no material, so it renders on the neutral default → `materials: 'unavailable'`.
 *
 * window.modelRun() renders both and resolves the honesty tiers, for the screenshot harness.
 */
import { renderModelStill } from '@chestnutlabs/gcode-model-renderer';
import { TOWER_3MF_BASE64 } from './model-fixture.js';

const SIZE = 512;
const CARD_BG = '#f4f5f7';

const log = document.getElementById('log');
const print = (s) => {
  log.textContent = s;
};

/** Binary STL from a triangle list ([[x,y,z],[x,y,z],[x,y,z]] each), with computed face normals. */
function buildStl(triangles) {
  const buf = new ArrayBuffer(84 + triangles.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, triangles.length, true);
  let o = 84;
  for (const [a, b, c] of triangles) {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2];
    const vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    dv.setFloat32(o, nx, true);
    dv.setFloat32(o + 4, ny, true);
    dv.setFloat32(o + 8, nz, true);
    o += 12;
    for (const p of [a, b, c]) {
      dv.setFloat32(o, p[0], true);
      dv.setFloat32(o + 4, p[1], true);
      dv.setFloat32(o + 8, p[2], true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return new Uint8Array(buf);
}

/** An axis-aligned box as 12 triangles. */
function box(x0, y0, z0, x1, y1, z1) {
  const v = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1]
  ];
  const f = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7]
  ];
  return f.map(([a, b, c]) => [v[a], v[b], v[c]]);
}

// A neutral single-object STL: a two-tier pedestal (no material info in STL).
const STL_BYTES = buildStl([...box(-16, -16, 0, 16, 16, 10), ...box(-9, -9, 10, 9, 9, 26)]);
const THREEMF_BYTES = Uint8Array.from(atob(TOWER_3MF_BASE64), (ch) => ch.charCodeAt(0));

async function renderInto(targetId, source) {
  const offscreen = new OffscreenCanvas(SIZE, SIZE);
  const result = await renderModelStill(source, {
    canvas: offscreen,
    width: SIZE,
    height: SIZE,
    background: 'transparent'
  });
  // Blit onto a card-colored visible canvas so the transparent render reads as a thumbnail.
  const bmp = offscreen.transferToImageBitmap();
  const el = document.getElementById(targetId);
  const ctx = el.getContext('2d');
  ctx.fillStyle = CARD_BG;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(bmp, 0, 0);
  return { objectCount: result.objectCount, materials: result.materials };
}

async function run() {
  print('rendering models…');
  const stl = await renderInto('stl', { kind: 'stl', bytes: STL_BYTES });
  const threemf = await renderInto('threemf', { kind: '3mf', bytes: THREEMF_BYTES });
  const report = { stl, threemf };
  window.__modelResult = report;
  document.getElementById('stl-cap').textContent = `STL · 1 object · materials: ${stl.materials}`;
  document.getElementById('threemf-cap').textContent =
    `3MF · ${threemf.objectCount} objects · materials: ${threemf.materials}`;
  print(JSON.stringify(report, null, 2));
  return report;
}

window.modelRun = run;
run().catch((e) => print('ERROR: ' + (e && e.stack ? e.stack : e)));
