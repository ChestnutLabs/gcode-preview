/*
 * Geometry pipeline-split benchmark (RR-008 Phase 0).
 *
 * Answers "where does the ~1-minute large-file load go?" by timing each CPU stage of the
 * parse → classify → lines-build → tube-build pipeline separately, so we can see which stage
 * dominates before designing the RR-008 worker pool. GPU upload + first-render are NOT measured here
 * (Node has no WebGL); those come from DD-027 RenderStats in the browser.
 *
 * Two input modes:
 *   - SYNTHETIC tiers (always): reproducible layered IRs at opossum-scale segment counts. Measures the
 *     build stages only (no parse/classify — the IR is fabricated). Committed + runnable by anyone.
 *   - REAL files (optional args): full parse + classify + build split on actual .gcode files. Files are
 *     read in place and NEVER committed; only anonymized size/segment/timing numbers are reported.
 *
 * Usage:
 *   node tools/benchmark/geometry-pipeline-split.mjs                 # synthetic tiers
 *   node tools/benchmark/geometry-pipeline-split.mjs <file.gcode>... # + real-file anchors
 */
import fs from 'node:fs';
import { buildChunks, buildTubeChunk } from '../../packages/gcode-renderer-three/dist/index.js';
import { parseGcodeToIR } from '../../packages/gcode-parser/dist/index.js';
import {
  createDialectRunner,
  prusaSlicer,
  orcaBambu,
  cura,
  ideaMaker,
  simplify3d,
  klipper,
  marlin,
  repRap
} from '../../packages/gcode-dialects/dist/index.js';

const ADAPTERS = () => [prusaSlicer(), orcaBambu(), cura(), ideaMaker(), simplify3d(), klipper(), marlin(), repRap()];

/** Sum tube geometry build time over every extrude chunk (the RR-008 hot kernel). */
function timeTubeBuild(ir) {
  const built = buildChunks(ir, { decimation: 1, targetSegmentsPerChunk: 250_000 });
  const t0 = performance.now();
  let vertices = 0;
  let bytes = 0;
  for (const chunk of built.chunks) {
    if (chunk.kind !== 'extrude') continue;
    const tube = buildTubeChunk(chunk, { radialSegments: 8 });
    vertices += tube.vertexCount;
    bytes +=
      tube.positions.byteLength + tube.normals.byteLength + tube.indices.byteLength + tube.vertexSegment.byteLength;
  }
  return { ms: performance.now() - t0, vertices, mb: Math.round(bytes / 1e6), chunks: built.chunks.length };
}

/** Time lines-build (buildChunks) alone. */
function timeLinesBuild(ir) {
  const t0 = performance.now();
  const built = buildChunks(ir, { decimation: 1 });
  return { ms: performance.now() - t0, included: built.totalSegmentsIncluded, chunks: built.chunks.length };
}

/** Build a synthetic layered ToolpathIR directly (typed arrays, no parse) — reproducible build tiers. */
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
    const prevA = a - 0.02;
    // Continuous polyline within a layer: this segment starts where the previous ended.
    seg.x0[i] = 110 + r * Math.cos(prevA);
    seg.y0[i] = 110 + r * Math.sin(prevA);
    seg.z0[i] = z;
    seg.x1[i] = 110 + r * Math.cos(a);
    seg.y1[i] = 110 + r * Math.sin(a);
    seg.z1[i] = z;
    seg.e[i] = 0.01;
    seg.kind[i] = 1; // Extrude
    seg.layer[i] = layer;
    seg.srcByte[i] = i * 30;
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

function pct(part, whole) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
}

console.log('# RR-008 Phase 0 — geometry pipeline split (CPU stages; GPU upload/first-render are browser-only)\n');

// ── Synthetic build tiers (reproducible) ──────────────────────────────────────────────────────────
console.log('## Synthetic build-only tiers (no parse; isolates lines-build vs tube-build)\n');
for (const [label, segs, perLayer] of [
  ['1.0M segments', 1_000_000, 8_000],
  ['2.67M segments (opossum-scale)', 2_670_000, 12_000],
  ['5.0M segments', 5_000_000, 20_000]
]) {
  const ir = syntheticIR(segs, perLayer);
  const lines = timeLinesBuild(ir);
  const tubes = timeTubeBuild(ir);
  console.log(
    `${label.padEnd(32)} lines-build ${String(Math.round(lines.ms)).padStart(6)}ms   ` +
      `tube-build ${String(Math.round(tubes.ms)).padStart(6)}ms   ` +
      `(tube is ${tubes.ms > 0 && lines.ms > 0 ? Math.round(tubes.ms / lines.ms) : '—'}× lines)   ` +
      `tubeVerts ${(tubes.vertices / 1e6).toFixed(1)}M  tubeMem ${tubes.mb}MB  chunks ${tubes.chunks}`
  );
}

// ── Real files (optional; parse + classify + build split) ─────────────────────────────────────────
const files = process.argv.slice(2);
if (files.length > 0) {
  console.log('\n## Real files (parse + classify + build; files read in place, not committed)\n');
  for (const file of files) {
    const bytes = fs.statSync(file).size;
    const text = fs.readFileSync(file, 'utf8');

    // Parse only (no dialects).
    let t0 = performance.now();
    const bare = parseGcodeToIR(text, { parserVersion: 'bench' });
    const parseMs = performance.now() - t0;

    // Parse + classify (dialect runner), like the worker does.
    const runner = createDialectRunner(ADAPTERS());
    const run = runner.createRun({ selection: 'auto', headText: text.slice(0, 65536), tailText: text.slice(-16384) });
    t0 = performance.now();
    const res = parseGcodeToIR(text, {
      parserVersion: 'bench',
      onComment: run?.onComment,
      onCommand: run?.onCommand
    });
    if (run) run.finalize(res.ir);
    const parseClassifyMs = performance.now() - t0;
    const classifyMs = Math.max(0, parseClassifyMs - parseMs);

    const ir = res.ir;
    const lines = timeLinesBuild(ir);
    const tubes = timeTubeBuild(ir);
    const total = parseMs + classifyMs + tubes.ms; // representative "tubes path" total (lines+tubes overlap)

    // Anonymized label: size + segment count, not the commercial filename.
    const label = `~${Math.round(bytes / 1e6)}MB / ${(ir.segments.count / 1e6).toFixed(2)}M seg`;
    console.log(`### ${label}`);
    console.log(`  parse         ${String(Math.round(parseMs)).padStart(6)}ms  ${pct(parseMs, total)}`);
    console.log(`  classify      ${String(Math.round(classifyMs)).padStart(6)}ms  ${pct(classifyMs, total)}`);
    console.log(`  lines-build   ${String(Math.round(lines.ms)).padStart(6)}ms  (alternative to tubes)`);
    console.log(
      `  tube-build    ${String(Math.round(tubes.ms)).padStart(6)}ms  ${pct(tubes.ms, total)}   tubeVerts ${(tubes.vertices / 1e6).toFixed(1)}M  tubeMem ${tubes.mb}MB`
    );
    console.log(
      `  → CPU total (parse+classify+tube) ≈ ${Math.round(total)}ms; dialects=${ir.header.dialects.map((d) => d.id).join(',') || 'none'}\n`
    );
  }
} else {
  console.log('\n(pass .gcode file paths as args to measure real parse+classify+build split)\n');
}
