/*
 * E3 renderer benchmark (DD-004 §8, issue #61).
 *
 * Node-measurable §8 dimensions against synthetic IRs at the DD-003 corpus
 * tiers (segment counts matched to the parser benchmarks: ~100 MB ≈ 3.15 M
 * segments, ~250 MB ≈ 7.7 M):
 *   - geometry build: buildChunks wall, per-tick stall (chunksPerTick=4),
 *     full lines build wall (≤ 2 s @ 250 MB tier)
 *   - scrub latency: setLayerRange + setScrubPosition (≤ 16 ms)
 *   - memory: lines geometry bytes vs IR segment bytes (≤ 2×)
 *   - tubes: build wall + vertices at the 10 MB tier (~310 k) and the 1 M
 *     auto boundary
 * Orbit fps needs a real GPU — measured separately in the browser harness and
 * recorded in the report alongside these numbers.
 *
 * Usage: node tools/benchmark/renderer-bench.mjs
 */
import { ToolpathRenderer, buildChunks, buildTubeChunk } from '../../packages/gcode-renderer-three/dist/index.js';

/** Build a synthetic layered ToolpathIR directly (typed arrays, no parse). */
function syntheticIR(segments, segsPerLayer) {
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
    kind: new Uint8Array(n),
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
    seg.kind[i] = 1; // Extrude
    seg.layer[i] = layer;
    seg.srcByte[i] = i * 30;
    if (i % segsPerLayer === 0) {
      layers.push({ z, segStart: i, segEnd: Math.min(i + segsPerLayer - 1, n - 1) });
    }
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

/** Minimal DOM/GL stubs so ToolpathRenderer runs headless (three's graph is pure JS). */
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

function makeRenderer(ir, quality) {
  const canvas = makeCanvas();
  const ticks = [];
  const renderer = new ToolpathRenderer({
    canvas,
    buildVolume: { x: 220, y: 220, z: 250 },
    quality,
    // no chunksPerTick: exercise the default TIME-budgeted ticks (§8)
    createRenderer: () => ({
      render: () => undefined,
      setSize: () => undefined,
      dispose: () => undefined,
      domElement: canvas
    }),
    scheduleFrame: (cb) => ticks.push(cb)
  });
  return { renderer, ticks };
}

function bench(label, ir, irBytes) {
  const t0 = performance.now();
  const built = buildChunks(ir, { decimation: 'auto' });
  const buildChunksMs = performance.now() - t0;

  // Two runs: first is JIT/GC-cold, second is representative steady state.
  let fullBuildMs = 0;
  let tickTimes = [];
  for (let run = 0; run < 2; run++) {
    tickTimes = [];
    const { renderer: r2, ticks: t2 } = makeRenderer(ir, 'lines');
    const t1 = performance.now();
    r2.setIR(ir);
    while (t2.length > 0) {
      const cb = t2.shift();
      const tt = performance.now();
      cb();
      tickTimes.push(performance.now() - tt);
    }
    fullBuildMs = performance.now() - t1;
    if (run === 0) r2.dispose();
    else globalThis.__lastRenderer = r2; // keep the warm renderer for the checks below
  }
  const renderer = globalThis.__lastRenderer;
  const maxTickMs = Math.max(...tickTimes);
  const tickCount = tickTimes.length;

  // Geometry memory: positions + colors actually attached.
  let geomBytes = 0;
  for (const mesh of renderer.chunkMeshes) {
    const g = mesh.geometry;
    geomBytes += g.getAttribute('position').array.byteLength + g.getAttribute('color').array.byteLength;
  }
  const memRatio = geomBytes / irBytes;

  const t2 = performance.now();
  renderer.setLayerRange(Math.floor(ir.layers.length * 0.2), Math.floor(ir.layers.length * 0.8));
  renderer.setScrubPosition(Math.floor(ir.segments.count * 0.7));
  const clipMs = performance.now() - t2;
  renderer.dispose();

  return {
    label,
    segments: ir.segments.count,
    decimation: built.decimationApplied,
    included: built.totalSegmentsIncluded,
    chunks: built.chunks.length,
    buildChunksMs: Math.round(buildChunksMs),
    fullBuildMs: Math.round(fullBuildMs),
    maxTickMs: Math.round(maxTickMs * 100) / 100,
    tickMsAll: tickTimes.map((t) => Math.round(t * 10) / 10),
    tickCount,
    geomMB: Math.round(geomBytes / 1e6),
    memRatio: Math.round(memRatio * 100) / 100,
    clipMs: Math.round(clipMs * 100) / 100
  };
}

function benchTubes(label, ir) {
  const built = buildChunks(ir, { decimation: 1, targetSegmentsPerChunk: 2048 });
  const t0 = performance.now();
  let vertices = 0;
  let bytes = 0;
  for (const chunk of built.chunks) {
    const tube = buildTubeChunk(chunk);
    vertices += tube.vertexCount;
    bytes += tube.positions.byteLength + tube.normals.byteLength + tube.indices.byteLength;
  }
  const ms = performance.now() - t0;

  // Per-tick stall through the real renderer path (time-budgeted ticks); two
  // runs, warm run reported (first is JIT/GC-cold).
  let maxTickMs = 0;
  let tickCount = 0;
  let active = 'tubes';
  for (let run = 0; run < 2; run++) {
    const { renderer, ticks } = makeRenderer(ir, 'tubes');
    renderer.setIR(ir);
    maxTickMs = 0;
    tickCount = 0;
    while (ticks.length > 0) {
      const cb = ticks.shift();
      const tt = performance.now();
      cb();
      maxTickMs = Math.max(maxTickMs, performance.now() - tt);
      tickCount++;
    }
    active = renderer.activeQuality;
    renderer.dispose();
  }
  return {
    label,
    segments: ir.segments.count,
    tubeBuildMs: Math.round(ms),
    vertices,
    tubeMB: Math.round(bytes / 1e6),
    rendererMaxTickMs: Math.round(maxTickMs * 100) / 100,
    rendererTicks: tickCount,
    activeQuality: active
  };
}

const IR_BYTES_PER_SEG = 40;
const results = [];
for (const [label, segs, perLayer] of [
  ['~10MB tier', 310_000, 2_000],
  ['~100MB tier', 3_150_000, 13_000],
  ['~250MB tier', 7_700_000, 32_000]
]) {
  const ir = syntheticIR(segs, perLayer);
  results.push(bench(label, ir, segs * IR_BYTES_PER_SEG));
}
for (const r of results) {
  const pass = r.fullBuildMs <= 2000 && r.maxTickMs <= 16 && r.memRatio <= 2 && r.clipMs <= 16;
  console.log(`LINES ${JSON.stringify(r)} => ${pass ? 'PASS' : 'CHECK'}`);
}

for (const [label, segs, perLayer] of [
  ['tubes ~10MB tier', 310_000, 2_000],
  ['tubes 1M auto boundary', 1_000_000, 8_000]
]) {
  const ir = syntheticIR(segs, perLayer);
  console.log(`TUBES ${JSON.stringify(benchTubes(label, ir))}`);
}
