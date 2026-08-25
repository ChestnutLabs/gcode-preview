/*
 * Interactive model-viewer harness (DD-021). Drives `createModelViewer` — the interactive analogue of
 * `renderModelStill` — against SOURCE MODELS (an STL and a colored 3MF) in a real, orbit-able canvas.
 * This is the interactive sibling of model.html (which renders static presentation stills).
 *
 * Both inputs are fully synthetic and MIT-clean: the STL is generated here in-page; the 3MF comes from
 * tools/fixtures/make-model-3mf.mjs (real basematerials colors → the capability-honest `materials:'known'`
 * path). The STL carries no material, so it renders on the neutral default → `materials:'unavailable'`.
 *
 * window.viewerLoad('stl'|'3mf') loads a source and resolves its ready info; window.__viewer is the live
 * handle; window.__viewerResult holds the last ready info — for the screenshot/capture harness.
 */
import { createModelViewer } from '@chestnutlabs/gcode-model-renderer';
import { TOWER_3MF_BASE64 } from './model-fixture.js';

/** Binary STL from a triangle list, with computed face normals. */
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

const STL_BYTES = buildStl([...box(-16, -16, 0, 16, 16, 10), ...box(-9, -9, 10, 9, 9, 26)]);
const THREEMF_BYTES = Uint8Array.from(atob(TOWER_3MF_BASE64), (ch) => ch.charCodeAt(0));

const SOURCES = {
  stl: { kind: 'stl', bytes: STL_BYTES },
  '3mf': { kind: '3mf', bytes: THREEMF_BYTES }
};

const stageEl = document.getElementById('stage');
const canvas = document.getElementById('viewer');
const infoEl = document.getElementById('info');
const eventsEl = document.getElementById('events');

// Size the drawing buffer to the CSS box (a card-colored background is set on the container, and the
// viewer defaults to a transparent render so it composites onto it).
function fitCanvasToBox() {
  const r = stageEl.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width));
  const h = Math.max(1, Math.round(r.height));
  canvas.width = w;
  canvas.height = h;
  return { w, h };
}
const { w, h } = fitCanvasToBox();

const viewer = createModelViewer(canvas, { background: '#f4f5f7', interactionQuality: 'auto' });
window.__viewer = viewer;

const eventLog = [];
const pushEvent = (line) => {
  eventLog.unshift(line);
  if (eventLog.length > 8) eventLog.length = 8;
  eventsEl.textContent = eventLog.join('\n');
};

viewer.onEvent((e) => {
  if (e.type === 'ready') {
    const b = e.info.bounds;
    const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((n) => n.toFixed(1));
    infoEl.innerHTML =
      `objectCount: ${e.info.objectCount}\n` +
      `materials:   <span class="tier-${e.info.materials}">${e.info.materials}</span>\n` +
      `bounds size: ${size.join(' × ')} mm`;
    window.__viewerResult = e.info;
    pushEvent(`ready · ${e.info.objectCount} obj · materials:${e.info.materials}`);
  } else if (e.type === 'camera-changed') {
    const p = e.state.position;
    pushEvent(`camera-changed · [${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}] · ${e.state.cameraMode}`);
  } else if (e.type === 'error') {
    pushEvent(`error · ${e.code}: ${e.message}`);
    infoEl.textContent = `error: ${e.code}\n${e.message}`;
  } else if (e.type === 'renderer-unsupported') {
    pushEvent(`renderer-unsupported · ${e.feature}`);
    infoEl.textContent = `renderer-unsupported: ${e.feature}\n${e.message}`;
  } else {
    pushEvent(e.type);
  }
});

viewer.resize(w, h);

async function load(kind) {
  const src = SOURCES[kind];
  if (!src) throw new Error(`unknown source '${kind}'`);
  document.getElementById('load-stl').classList.toggle('active', kind === 'stl');
  document.getElementById('load-3mf').classList.toggle('active', kind === '3mf');
  return viewer.setSource(src);
}
window.viewerLoad = load;

// Controls.
document.getElementById('load-stl').addEventListener('click', () => load('stl'));
document.getElementById('load-3mf').addEventListener('click', () => load('3mf'));
document.getElementById('refit').addEventListener('click', () => viewer.frame());
document.getElementById('reset-view').addEventListener('click', () => viewer.setView('iso'));
for (const btn of document.querySelectorAll('button[data-view]')) {
  btn.addEventListener('click', () => viewer.setView(btn.dataset.view));
}

// Keep the drawing buffer matched to the (responsive) container.
const ro = new ResizeObserver(() => {
  const { w: nw, h: nh } = fitCanvasToBox();
  viewer.resize(nw, nh);
});
ro.observe(stageEl);

load('stl').catch((e) => {
  infoEl.textContent = 'ERROR: ' + (e && e.stack ? e.stack : e);
});
