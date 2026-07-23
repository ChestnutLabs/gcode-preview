/*
 * Progressive-preview TTFP benchmark (DD-004 §5.4, issue #60).
 *
 * Measures time-to-first-partial ("first useful preview") through the REAL
 * worker boundary (node:worker_threads hosting the actual protocol handler,
 * same harness as worker-bench). Targets: first partial ≤3 s @ ~100 MB and
 * ≤6 s @ ~250 MB, with the default 25 MiB threshold and 1 s interval.
 *
 * Usage: node tools/benchmark/partial-ttfp-bench.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { GcodeParseSession } from '../../packages/gcode-parser/dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const entryPath = path.join(__dirname, 'worker-entry-node.mjs');

function nodeWorkerAdapter() {
  const w = new Worker(entryPath);
  const adapter = {
    onmessage: null,
    onerror: null,
    postMessage: (m, t) => w.postMessage(m, t),
    terminate: () => void w.terminate()
  };
  w.on('message', (data) => adapter.onmessage?.({ data }));
  w.on('error', (err) => adapter.onerror?.(err));
  return adapter;
}

function makeSynthetic(seedPath, targetBytes, outPath) {
  const seed = fs.readFileSync(seedPath);
  const reps = Math.max(1, Math.ceil(targetBytes / seed.length));
  const fd = fs.openSync(outPath, 'w');
  for (let i = 0; i < reps; i++) fs.writeSync(fd, seed);
  fs.closeSync(fd);
}

async function measure(file) {
  const bytes = fs.statSync(file).size;
  const input = new Uint8Array(fs.readFileSync(file));
  const session = new GcodeParseSession({ worker: nodeWorkerAdapter() });
  let firstPartialMs = null;
  let firstPartialSegments = 0;
  let partials = 0;
  const t0 = performance.now();
  session.onPartial((slice) => {
    partials++;
    if (firstPartialMs === null) {
      firstPartialMs = performance.now() - t0;
      firstPartialSegments = slice.segments.count;
    }
  });
  const result = await session.parse(input); // DEFAULT partialPreview: auto ≥ 25 MiB
  const totalMs = performance.now() - t0;
  session.dispose();
  return {
    mb: (bytes / 1e6).toFixed(1),
    ttfpMs: firstPartialMs === null ? null : Math.round(firstPartialMs),
    firstPartialSegments,
    partials,
    totalMs: Math.round(totalMs),
    finalSegments: result.ir.segments.count,
    complete: result.ir.header.complete
  };
}

const seed = path.join(repoRoot, 'demo', 'gcodes', '3DBenchy.gcode');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gcode-ttfp-'));
const tiers = [
  ['~100MB', 100 * 1024 * 1024, 3000],
  ['~250MB', 250 * 1024 * 1024, 6000]
];

let failed = false;
for (const [label, target, budgetMs] of tiers) {
  const file = path.join(tmp, `${label}.gcode`);
  makeSynthetic(seed, target, file);
  const r = await measure(file);
  const pass = r.ttfpMs !== null && r.ttfpMs <= budgetMs;
  if (!pass) failed = true;
  console.log(
    `${label}: TTFP ${r.ttfpMs} ms (budget ${budgetMs}) ${pass ? 'PASS' : 'FAIL'} — ` +
      `first partial ${r.firstPartialSegments.toLocaleString()} segs, ${r.partials} partials, ` +
      `total ${r.totalMs} ms, final ${r.finalSegments.toLocaleString()} segs, complete=${r.complete}`
  );
  fs.rmSync(file);
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
