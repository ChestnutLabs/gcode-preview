/*
 * E2 worker-pipeline benchmark orchestrator (DD-003 §8, issue #47).
 *
 * Runs each fixture in an isolated child process hosting a REAL worker_threads
 * boundary (session escape hatch + the actual protocol handler). Corpus: the MIT
 * demo fixtures plus synthetic ~10/100/250 MB tiers (3DBenchy repeated; generated
 * to the OS temp dir, never committed). Targets from DD-003 §8:
 *   main-thread stall <16 ms · throughput ≥5 MB/s · peak RSS ≤1536 MiB @ 250 MB
 *   transfer delivery <100 ms · cooperative cancel <250 ms (no terminate).
 *
 * Usage: node tools/benchmark/worker-bench.mjs   (BENCH_OUT=<file> for the report)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const childPath = path.join(__dirname, 'worker-bench-child.mjs');

function runChild(mode, file) {
  const r = spawnSync(process.execPath, [childPath, mode, file], {
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 16 * 1024 * 1024
  });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('BENCH_RESULT '));
  if (line) return JSON.parse(line.slice('BENCH_RESULT '.length));
  return { mode, error: `child failed (code=${r.status}): ${(r.stderr || '').slice(0, 300)}` };
}

function makeSynthetic(seedPath, targetBytes, outPath) {
  const seed = fs.readFileSync(seedPath);
  const reps = Math.max(1, Math.ceil(targetBytes / seed.length));
  const fd = fs.openSync(outPath, 'w');
  for (let i = 0; i < reps; i++) fs.writeSync(fd, seed);
  fs.closeSync(fd);
}

const demoDir = path.join(repoRoot, 'demo', 'gcodes');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gcode-wbench-'));
const seed = path.join(demoDir, '3DBenchy.gcode');
const tiers = [
  ['synthetic ~10MB', 10 * 1024 * 1024],
  ['synthetic ~100MB', 100 * 1024 * 1024],
  ['synthetic ~250MB', 250 * 1024 * 1024]
];
const corpus = [
  { label: 'demo/3DBenchy (3.5MB)', file: seed },
  ...tiers.map(([label, target], i) => {
    const out = path.join(tmp, `synthetic-${i}.gcode`);
    makeSynthetic(seed, target, out);
    return { label, file: out };
  })
];

const rows = [];
for (const item of corpus) {
  process.stderr.write(`  parse-bench ${item.label}...\n`);
  rows.push({ label: item.label, ...runChild('parse', item.file) });
}

process.stderr.write('  cancel-bench on ~100MB...\n');
const cancelResult = runChild('cancel', path.join(tmp, 'synthetic-1.gcode'));
process.stderr.write('  transfer-bench on ~250MB...\n');
const transferResult = runChild('transfer', path.join(tmp, 'synthetic-2.gcode'));

const TARGETS = { stallMs: 16, throughputMBs: 5, rssMB250: 1536, transferMs: 100, cancelMs: 250 };

let out = '## Parse (session + real worker thread; per-fixture child process)\n\n';
out +=
  '| Fixture | Size MB | Wall ms | MB/s (target ≥5) | Max main-thread stall ms (target <16) | Peak RSS MB | Segments | Complete |\n';
out += '|---|--:|--:|--:|--:|--:|--:|---|\n';
for (const r of rows) {
  out += `| ${r.label} | ${r.sizeMB ?? '-'} | ${r.wallMs ?? '-'} | ${r.throughputMBs ?? '-'} | ${r.maxMainThreadStallMs ?? '-'} | ${r.peakRssMB ?? '-'} | ${r.segments ?? '-'} | ${r.error ?? r.complete} |\n`;
}
out += `\n## Cooperative cancel (~100 MB, cancel at t+500 ms)\n\n`;
out += `- latency: **${cancelResult.cancelLatencyMs} ms** (target <${TARGETS.cancelMs}) · terminate() used: **${cancelResult.terminated}** (must be false) · partial segments delivered: ${cancelResult.partialSegments}\n`;
out += `\n## Pure IR transfer (~250 MB IR, worker → main)\n\n`;
out += `- delivery: **${transferResult.transferDeliveryMs} ms** (target <${TARGETS.transferMs}) · segments: ${transferResult.deliveredSegments}\n`;

// Verdicts
const parse250 = rows[rows.length - 1];
const verdicts = [
  ['main-thread stall <16 ms (all tiers)', rows.every((r) => (r.maxMainThreadStallMs ?? 999) < TARGETS.stallMs)],
  ['throughput ≥5 MB/s (all tiers)', rows.every((r) => (r.throughputMBs ?? 0) >= TARGETS.throughputMBs)],
  ['peak RSS ≤1536 MB @ 250 MB', (parse250.peakRssMB ?? 99999) <= TARGETS.rssMB250],
  ['transfer delivery <100 ms', (transferResult.transferDeliveryMs ?? 999) < TARGETS.transferMs],
  [
    'cooperative cancel <250 ms without terminate',
    (cancelResult.cancelLatencyMs ?? 999) < TARGETS.cancelMs && cancelResult.terminated === false
  ]
];
out += '\n## Verdicts vs DD-003 §8\n\n';
for (const [name, pass] of verdicts) out += `- ${pass ? 'PASS' : 'FAIL'} — ${name}\n`;
out += `\nOverall: **${verdicts.every(([, p]) => p) ? 'ALL TARGETS MET' : 'DEVIATIONS PRESENT'}**\n`;

process.stdout.write(out);
if (process.env.BENCH_OUT) fs.writeFileSync(process.env.BENCH_OUT, out);
process.stderr.write(`\ntemp corpus: ${tmp}\n`);
