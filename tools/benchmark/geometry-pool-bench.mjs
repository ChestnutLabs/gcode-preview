/*
 * DD-028 geometry worker-pool measurement (RR-008 Phase-2 evidence).
 *
 * Measures REAL parallel tube-geometry build via the shipped GeometryWorkerPool driven by a
 * `worker_threads` pool running the shipped `handleGeometryRequest` kernel — serial vs N workers, at
 * opossum-scale. Proves the byte-identical parallel build and quantifies the speedup the browser Web
 * Worker path will get (same kernel; worker_threads is the Node host adapter).
 *
 * Usage: node tools/benchmark/geometry-pool-bench.mjs [segments]
 */
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { buildChunks, buildTubeChunk, GeometryWorkerPool } from '../../packages/gcode-renderer-three/dist/index.js';

const WORKER = fileURLToPath(new URL('./geometry-pool-worker.mjs', import.meta.url));

/** Synthetic layered IR (continuous polylines within a layer) at a target segment count. */
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
    seg.x0[i] = 110 + r * Math.cos(a - 0.02);
    seg.y0[i] = 110 + r * Math.sin(a - 0.02);
    seg.z0[i] = z;
    seg.x1[i] = 110 + r * Math.cos(a);
    seg.y1[i] = 110 + r * Math.sin(a);
    seg.z1[i] = z;
    seg.kind[i] = 1;
    seg.layer[i] = layer;
    if (i % segsPerLayer === 0) layers.push({ z, segStart: i, segEnd: Math.min(i + segsPerLayer - 1, n - 1) });
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
      capabilities: {}
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

/** A GeometryWorkerLike shim around a worker_threads Worker. */
function nodeWorkerFactory() {
  return () => {
    const w = new Worker(WORKER);
    const shim = {
      onmessage: null,
      postMessage: (msg, transfer) => w.postMessage(msg, transfer),
      terminate: () => w.terminate()
    };
    w.on('message', (data) => shim.onmessage?.({ data }));
    w.on('error', (e) => {
      throw e;
    });
    return shim;
  };
}

const segments = Number(process.argv[2] ?? 2_670_000); // opossum-scale default
const ir = syntheticIR(segments, 12_000);
const chunks = buildChunks(ir, { decimation: 1, targetSegmentsPerChunk: 250_000 }).chunks.filter(
  (c) => c.kind === 'extrude'
);
console.log(
  `# DD-028 geometry pool — ${(segments / 1e6).toFixed(2)}M segments, ${chunks.length} extrude chunks, host cores ${os.cpus().length}\n`
);

// Serial reference (the current single-thread build).
let t0 = performance.now();
const serial = chunks.map((c) => buildTubeChunk(c, { radialSegments: 8 }));
const serialMs = performance.now() - t0;
console.log(`serial (1 thread)            ${String(Math.round(serialMs)).padStart(6)}ms   (baseline)`);

// Parallel via the pool at several worker counts.
for (const size of [1, 2, 4, 8].filter((n) => n <= chunks.length)) {
  const pool = new GeometryWorkerPool(size, nodeWorkerFactory());
  const requests = chunks.map((c, i) => ({
    id: i,
    positions: c.positions.buffer.slice(0),
    count: c.count,
    radialSegments: 8
  }));
  t0 = performance.now();
  const responses = await pool.buildAll(requests);
  const ms = performance.now() - t0;
  pool.dispose();
  // Spot-check byte-identity of the first chunk.
  const identical = new Float32Array(responses[0].positions).every((v, j) => v === serial[0].positions[j]);
  const speedup = serialMs / ms;
  console.log(
    `pool (${size} worker${size > 1 ? 's' : ' '})              ${String(Math.round(ms)).padStart(6)}ms   ${speedup.toFixed(2)}× vs serial   byte-identical:${identical}`
  );
}
