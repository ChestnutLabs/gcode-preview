/*
 * E5 live-progress benchmark (DD-006 §8, issue #94).
 *
 * Node-measurable dimensions:
 *   - mapper observe() latency per tier (byte / layer / percent-bytes / percent-job)
 *     at the DD-003 corpus tiers up to 10 M segments — budget: p95 < 0.1 ms at 10 M.
 *   - steady-state allocation over a simulated 10 Hz soak (heapUsed drift after warmup).
 *   - renderer setProgress() draw-state walk vs. the DD-004 scrub budget (≤ 0.5 ms
 *     steady-state; ≤ 16 ms hard) on the built lines scene, including the ghost/band
 *     overlay pass updates, plus the one-time overlay warm-up cost.
 * GPU-side frame cost (ghost overdraw) needs a real GPU — reference-machine item,
 * same caveat as the E3 orbit-fps budgets.
 *
 * Usage: node tools/benchmark/progress-bench.mjs
 */
import { createProgressMapper } from '../../packages/toolpath-core/dist/index.js';
import { ToolpathRenderer } from '../../packages/gcode-renderer-three/dist/index.js';

/** Synthetic layered IR with a sorted source index (typed arrays, no parse). */
function syntheticIR(segments, segsPerLayer, bytesPerSeg = 30) {
  const n = segments;
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
    const layer = Math.floor(i / segsPerLayer);
    const t = (i % segsPerLayer) / segsPerLayer;
    const a = t * Math.PI * 2 * 40;
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
    seg.srcByte[i] = i * bytesPerSeg;
    if (i % segsPerLayer === 0) layers.push({ z, segStart: i, segEnd: Math.min(i + segsPerLayer - 1, n - 1) });
  }
  // srcByte is already ascending — the identity ordering IS the source index.
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const byteLength = n * bytesPerSeg + bytesPerSeg;
  return {
    header: {
      irSchemaVersion: 1,
      parserVersion: 'bench',
      source: { byteLength },
      units: 'mm',
      unitsSource: 'known',
      originOffset: { x: 0, y: 0, z: 0 },
      complete: true,
      dialects: [],
      warnings: [],
      capabilities: {}
    },
    segments: seg,
    layers,
    tools: [],
    objects: [],
    bounds: { min: { x: 20, y: 20, z: 0.2 }, max: { x: 200, y: 200, z: 0.2 * layers.length } },
    boundsWithTravel: { min: { x: 20, y: 20, z: 0.2 }, max: { x: 200, y: 200, z: 0.2 * layers.length } },
    sourceIndex: { byteOffsets: seg.srcByte, segmentIndices: idx }
  };
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function stats(times) {
  const s = [...times].sort((a, b) => a - b);
  const r = (v) => Math.round(v * 1000) / 1000;
  return { p50: r(percentile(s, 0.5)), p95: r(percentile(s, 0.95)), max: r(s[s.length - 1]) };
}

/** Deterministic PRNG (mulberry32) — no Math.random, reproducible runs. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function benchMapper(ir, label) {
  const byteLength = ir.header.source.byteLength;
  const layerCount = ir.layers.length;
  const mapper = createProgressMapper(ir, { fileSizeBytes: byteLength });
  const rand = prng(42);
  const tiers = {
    byte: (f) => ({ v: 1, timestampMs: 1, position: { byte: Math.round(f * byteLength) } }),
    layer: (f) => ({
      v: 1,
      timestampMs: 1,
      position: { layer: Math.floor(f * layerCount), totalLayers: layerCount }
    }),
    'percent-bytes': (f) => ({ v: 1, timestampMs: 1, position: { percent: f, percentBasis: 'bytes' } }),
    'percent-job': (f) => ({ v: 1, timestampMs: 1, position: { percent: f, percentBasis: 'job' } }),
    'byte+layer-crosscheck': (f) => ({
      v: 1,
      timestampMs: 1,
      position: { byte: Math.round(f * byteLength), layer: Math.floor(rand() * layerCount) }
    })
  };
  const out = { label, segments: ir.segments.count, tiers: {} };
  for (const [tier, make] of Object.entries(tiers)) {
    for (let i = 0; i < 2000; i++) mapper.observe(make(rand())); // warmup/JIT
    const times = [];
    for (let i = 0; i < 10000; i++) {
      const obs = make(rand());
      const t0 = performance.now();
      mapper.observe(obs);
      times.push(performance.now() - t0);
    }
    out.tiers[tier] = stats(times);
  }
  // Steady-state allocation: heapUsed drift across a long soak after warmup.
  for (let i = 0; i < 5000; i++) mapper.observe(tiers.byte(rand()));
  globalThis.gc?.();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 50000; i++) mapper.observe(tiers.byte(rand()));
  globalThis.gc?.();
  const after = process.memoryUsage().heapUsed;
  out.soak = {
    observations: 50000,
    heapDriftKB: Math.round((after - before) / 1024),
    perObsBytes: Math.round((after - before) / 50000)
  };
  return out;
}

function makeCanvas() {
  const listeners = {};
  return {
    width: 800,
    height: 600,
    clientWidth: 800,
    clientHeight: 600,
    style: {},
    addEventListener: (t, cb) => (listeners[t] = cb),
    removeEventListener: () => undefined,
    dispatchEvent: () => undefined,
    getContext: () => null,
    getRootNode: () => ({}),
    ownerDocument: { defaultView: null }
  };
}

function benchRenderer(ir, label) {
  const canvas = makeCanvas();
  const ticks = [];
  const renderer = new ToolpathRenderer({
    canvas,
    buildVolume: { x: 220, y: 220, z: 250 },
    quality: 'lines',
    createRenderer: () => ({
      render: () => undefined,
      setSize: () => undefined,
      dispose: () => undefined,
      domElement: canvas
    }),
    scheduleFrame: (cb) => ticks.push(cb)
  });
  renderer.setIR(ir);
  while (ticks.length > 0) ticks.shift()();
  const count = ir.segments.count;
  const mk = (f) => {
    const seg = Math.min(count - 1, Math.round(f * count));
    return { segIndex: seg, basis: 'byte', confidence: 'known', band: [seg, seg], layerIndex: null, stale: false, notes: [] };
  };
  // One-time overlay warm-up (ghost/band mesh creation across all chunks).
  const tw = performance.now();
  renderer.setProgress(mk(0.01));
  const warmupMs = performance.now() - tw;
  const rand = prng(7);
  for (let i = 0; i < 200; i++) renderer.setProgress(mk(rand()));
  const times = [];
  for (let i = 0; i < 2000; i++) {
    const p = mk(rand());
    const t0 = performance.now();
    renderer.setProgress(p);
    times.push(performance.now() - t0);
  }
  // Band-presentation update (widened band → three ranges per chunk).
  const bandTimes = [];
  for (let i = 0; i < 2000; i++) {
    const seg = Math.round(rand() * (count - 1));
    const layer = ir.segments.layer[seg];
    const entry = ir.layers[layer];
    const p = {
      segIndex: entry.segEnd,
      basis: 'layer',
      confidence: 'inferred',
      band: [entry.segStart, entry.segEnd],
      layerIndex: layer,
      stale: false,
      notes: []
    };
    const t0 = performance.now();
    renderer.setProgress(p);
    bandTimes.push(performance.now() - t0);
  }
  const chunks = renderer.chunkMeshes.length;
  renderer.dispose();
  return { label, segments: count, chunks, warmupMs: Math.round(warmupMs * 100) / 100, exact: stats(times), band: stats(bandTimes) };
}

const TIERS = [
  ['10MB-tier (310k)', 310_000, 1600],
  ['100MB-tier (3.15M)', 3_150_000, 3200],
  ['250MB-tier (7.7M)', 7_700_000, 4200],
  ['10M', 10_000_000, 5000]
];

console.log('E5 progress benchmark (DD-006 §8) — node', process.version);
console.log('machine noise-band caveat: paired-median methodology, ~5% deltas unresolvable here\n');

const results = { mapper: [], renderer: [] };
for (const [label, n, perLayer] of TIERS) {
  const ir = syntheticIR(n, perLayer);
  const m = benchMapper(ir, label);
  results.mapper.push(m);
  console.log(`mapper ${label}:`, JSON.stringify(m.tiers), 'soak', JSON.stringify(m.soak));
}
for (const [label, n, perLayer] of [TIERS[1], TIERS[3]]) {
  const ir = syntheticIR(n, perLayer);
  const r = benchRenderer(ir, label);
  results.renderer.push(r);
  console.log(`renderer ${label}:`, JSON.stringify(r));
}

// §8 verdicts (tripwire style, as in the E3/E4 benches).
const worstMapper = Math.max(...results.mapper.map((m) => Math.max(...Object.values(m.tiers).map((t) => t.p95))));
const worstSetProgress = Math.max(...results.renderer.map((r) => Math.max(r.exact.p95, r.band.p95)));
console.log('\nVERDICTS');
console.log(`observe() worst p95: ${worstMapper} ms (budget < 0.1 ms) — ${worstMapper < 0.1 ? 'PASS' : 'FAIL'}`);
console.log(
  `setProgress worst p95: ${worstSetProgress} ms (scrub budget 0.5 ms) — ${worstSetProgress <= 0.5 ? 'PASS' : 'FAIL'}`
);
const drift = Math.max(...results.mapper.map((m) => m.soak.perObsBytes));
console.log(`soak heap drift: worst ${drift} B/obs (want ~0; small positive = GC noise without --expose-gc)`);
process.exit(worstMapper < 0.1 && worstSetProgress <= 0.5 ? 0 : 1);
