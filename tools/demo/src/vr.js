/**
 * E3 visual-regression + real-GL benchmark harness (issue #61, governance §10.2).
 *
 * Deterministic renders of the MIT corpus at a fixed camera in both quality
 * modes. For each capture it computes compact metrics (16×16 grayscale grid +
 * lit-pixel ratio) and compares them against the committed baseline
 * (`vr-baseline.json`) with tolerances; PNG dataURLs are exposed for committing
 * as baseline images. Also measures the §8 GL-side budgets that Node cannot:
 * orbit fps and real build-tick stalls.
 *
 * Drive via `window.vrRun()` / `window.perfRun()`; results land on
 * `window.vrResults` / `window.perfResults` and in the on-page report.
 */
import { parseGcodeToIR } from '@chestnutlabs/gcode-parser';
import { ToolpathRenderer } from '@chestnutlabs/gcode-renderer-three';
import baseline from './vr-baseline.json';

const CORPUS = [
  '3DBenchy.gcode',
  'calicat.gcode',
  'vase.gcode',
  'screw.gcode',
  'plant-sign.gcode',
  'easel.gcode',
  'mach3.gcode'
];
const GRID = 16;
const GRID_TOLERANCE = 10; // mean |Δ| per 0-255 grayscale cell
const LIT_TOLERANCE = 0.05; // absolute lit-pixel-ratio delta

const canvas = document.getElementById('vr');
const out = document.getElementById('out');
const log = (s) => {
  out.textContent += `\n${s}`;
};
out.textContent = 'ready';

let renderer = null;
let tickTimes = [];
function makeRenderer() {
  renderer?.dispose();
  tickTimes = [];
  renderer = new ToolpathRenderer({
    canvas,
    buildVolume: { x: 220, y: 220, z: 250 },
    quality: 'lines',
    // Same rAF + timeout backstop as the renderer default (this pane can
    // suspend rAF), instrumented to record per-tick work time.
    scheduleFrame: (cb) => {
      let ran = false;
      const run = () => {
        if (ran) return;
        ran = true;
        const t0 = performance.now();
        cb();
        tickTimes.push(performance.now() - t0);
      };
      requestAnimationFrame(run);
      setTimeout(run, 50);
    }
  });
  return renderer;
}

/** True when requestAnimationFrame actually fires (panes may suspend it). */
function rafAlive() {
  return new Promise((res) => {
    let fired = false;
    requestAnimationFrame(() => {
      fired = true;
      res(true);
    });
    setTimeout(() => res(fired), 300);
  });
}

function fixedCamera(r) {
  // Deterministic view: frame() places the camera purely from the model bounds.
  r.frame();
}

function capture() {
  renderer.render();
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const cellW = c.width / GRID;
  const cellH = c.height / GRID;
  const grid = new Array(GRID * GRID).fill(0);
  const counts = new Array(GRID * GRID).fill(0);
  let lit = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const cell = Math.min(GRID - 1, Math.floor(y / cellH)) * GRID + Math.min(GRID - 1, Math.floor(x / cellW));
      grid[cell] += gray;
      counts[cell]++;
      if (gray > 12) lit++;
    }
  }
  const meanGrid = grid.map((g, i) => Math.round(g / counts[i]));
  return {
    grid: meanGrid,
    litRatio: Math.round((lit / (c.width * c.height)) * 1000) / 1000,
    png: c.toDataURL('image/png')
  };
}

function compare(name, cur, base) {
  if (!base) return { name, status: 'NO_BASELINE' };
  let sum = 0;
  for (let i = 0; i < cur.grid.length; i++) sum += Math.abs(cur.grid[i] - base.grid[i]);
  const meanAbs = sum / cur.grid.length;
  const litDelta = Math.abs(cur.litRatio - base.litRatio);
  const pass = meanAbs <= GRID_TOLERANCE && litDelta <= LIT_TOLERANCE;
  return { name, status: pass ? 'PASS' : 'FAIL', meanAbsGrid: Math.round(meanAbs * 100) / 100, litDelta };
}

async function loadIR(file) {
  const buf = await (await fetch(`./gcodes/${file}`)).arrayBuffer();
  return parseGcodeToIR(new Uint8Array(buf)).ir;
}

/** Deterministic MappedProgress states over an IR (DD-006 phase 3 overlay baselines). */
function overlayStates(ir) {
  const count = ir.segments.count;
  const seg = Math.floor(count * 0.55);
  const layer = ir.segments.layer[seg];
  const entry = ir.layers[layer];
  const base = { layerIndex: layer, stale: false, notes: [] };
  return {
    'overlay-exact': { ...base, segIndex: seg, basis: 'byte', confidence: 'known', band: [seg, seg] },
    'overlay-band': {
      ...base,
      segIndex: entry.segEnd,
      basis: 'layer',
      confidence: 'inferred',
      band: [entry.segStart, entry.segEnd]
    },
    'overlay-stale': { ...base, segIndex: seg, basis: 'byte', confidence: 'known', band: [seg, seg], stale: true }
  };
}
const OVERLAY_FILE = 'calicat.gcode';

window.vrRun = async () => {
  const results = [];
  const captures = {};
  const record = (key, cap) => {
    captures[key] = cap;
    const verdict = compare(key, cap, baseline[key]);
    results.push(verdict);
    log(
      `${key}: ${verdict.status}${verdict.meanAbsGrid !== undefined ? ` (grid Δ ${verdict.meanAbsGrid}, lit Δ ${verdict.litDelta})` : ''}`
    );
  };
  for (const file of CORPUS) {
    const ir = await loadIR(file);
    for (const quality of ['lines', 'tubes']) {
      const key = `${file}:${quality}`;
      const r = makeRenderer();
      r.setQuality(quality);
      r.setIR(ir);
      r.flushBuild();
      fixedCamera(r);
      record(key, capture());
      await new Promise((res) => setTimeout(res, 30));
    }
  }
  // Live-progress overlay states (DD-006 §4.5): marker/ghost, band, stale — lines mode.
  {
    const ir = await loadIR(OVERLAY_FILE);
    const states = overlayStates(ir);
    for (const [name, progress] of Object.entries(states)) {
      const key = `${OVERLAY_FILE}:lines:${name}`;
      const r = makeRenderer();
      r.setIR(ir);
      r.flushBuild();
      fixedCamera(r);
      r.setProgress(progress);
      record(key, capture());
      await new Promise((res) => setTimeout(res, 30));
    }
  }
  window.vrResults = { results, captures };
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const missing = results.filter((r) => r.status === 'NO_BASELINE').length;
  log(`\nVR: ${results.length - failed - missing} pass, ${failed} fail, ${missing} no-baseline`);
  return { failed, missing, total: results.length };
};

async function measureFps(frames = 90) {
  const cam = renderer.camera;
  const r0 = Math.hypot(cam.position.x, cam.position.z);
  const useRaf = await rafAlive();
  const gl = useRaf ? null : canvas.getContext('webgl2') || canvas.getContext('webgl');
  const px = new Uint8Array(4);
  const times = [];
  let last = performance.now();
  for (let i = 0; i < frames; i++) {
    if (useRaf) {
      await new Promise((res) => requestAnimationFrame(res));
    }
    const a = (i / frames) * Math.PI;
    cam.position.x = Math.cos(a) * r0;
    cam.position.z = Math.sin(a) * r0;
    renderer.render();
    if (!useRaf && gl) {
      // Forced GPU sync: measures true per-frame cost without vsync.
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    const now = performance.now();
    times.push(now - last);
    last = now;
  }
  times.splice(0, 5); // warmup frames
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const worst = Math.max(...times);
  return {
    avgFps: Math.round(1000 / avg),
    worstFrameMs: Math.round(worst * 10) / 10,
    method: useRaf ? 'rAF-vsync' : 'forced-sync (rAF suspended: vsync-independent frame cost)'
  };
}

/** Synthetic 250MB-tier IR (7.7M segments) built directly — §8 interaction target. */
function syntheticIR(n, perLayer) {
  const f32 = () => new Float32Array(n);
  const seg = {
    count: n,
    x0: f32(),
    y0: f32(),
    z0: f32(),
    x1: f32(),
    y1: f32(),
    z1: f32(),
    e: f32(),
    feedrate: f32(),
    kind: new Uint8Array(n).fill(1),
    tool: new Uint16Array(n),
    layer: new Uint32Array(n),
    feature: new Uint8Array(n),
    object: new Uint32Array(n),
    srcByte: new Uint32Array(n)
  };
  const layers = [];
  for (let i = 0; i < n; i++) {
    const layer = Math.floor(i / perLayer);
    const t = (i % perLayer) / perLayer;
    const a = t * Math.PI * 80;
    const r = 30 + 60 * t;
    const z = 0.2 * (layer + 1);
    seg.x0[i] = 110 + r * Math.cos(a);
    seg.y0[i] = 110 + r * Math.sin(a);
    seg.z0[i] = z;
    seg.x1[i] = 110 + r * Math.cos(a + 0.02);
    seg.y1[i] = 110 + r * Math.sin(a + 0.02);
    seg.z1[i] = z;
    seg.e[i] = 0.01;
    seg.layer[i] = layer;
    if (i % perLayer === 0) layers.push({ z, segStart: i, segEnd: Math.min(i + perLayer - 1, n - 1) });
  }
  return {
    header: {
      irSchemaVersion: 1,
      parserVersion: 'bench',
      source: { byteLength: n * 30 },
      units: 'mm',
      unitsSource: 'known',
      originOffset: { x: 0, y: 0, z: 0 },
      complete: true,
      dialects: [],
      warnings: [],
      capabilities: { geometry: 'known', layers: 'known', featureRoles: 'unavailable' }
    },
    segments: seg,
    layers,
    tools: [{ id: 0 }],
    objects: [],
    bounds: { min: { x: 20, y: 20, z: 0.2 }, max: { x: 200, y: 200, z: 0.2 * layers.length } },
    boundsWithTravel: { min: { x: 20, y: 20, z: 0.2 }, max: { x: 200, y: 200, z: 0.2 * layers.length } },
    sourceIndex: { byteOffsets: new Uint32Array(0), segmentIndices: new Uint32Array(0) }
  };
}

window.perfRun = async () => {
  const results = {};

  // Benchy tubes (≤10MB tier): fps target ≥60, plus real build-tick stalls.
  const benchy = await loadIR('3DBenchy.gcode');
  let r = makeRenderer();
  r.setQuality('tubes');
  const tb0 = performance.now();
  r.setIR(benchy);
  await new Promise((res) => {
    const off = r.onEvent((e) => {
      if (e.type === 'buildComplete') {
        off();
        res();
      }
    });
    setTimeout(res, 30000);
  });
  fixedCamera(r);
  results.benchyTubes = {
    buildWallMs: Math.round(performance.now() - tb0),
    maxTickMs: Math.round(Math.max(...tickTimes) * 10) / 10,
    ticks: tickTimes.length,
    quality: r.activeQuality,
    ...(await measureFps())
  };

  // 250MB-tier synthetic lines (decimation reported): fps target ≥30.
  const big = syntheticIR(7_700_000, 32_000);
  r = makeRenderer();
  r.setQuality('lines');
  const t0 = performance.now();
  r.setIR(big);
  await new Promise((res) => {
    const off = r.onEvent((e) => {
      if (e.type === 'buildComplete') {
        off();
        res();
      }
    });
    setTimeout(res, 60000);
  });
  fixedCamera(r);
  results.tier250Lines = {
    buildWallMs: Math.round(performance.now() - t0),
    maxTickMs: Math.round(Math.max(...tickTimes) * 10) / 10,
    ticks: tickTimes.length,
    ...(await measureFps())
  };

  window.perfResults = results;
  log(`\nPERF ${JSON.stringify(results)}`);
  return results;
};

log('harness ready: vrRun() / perfRun()');
