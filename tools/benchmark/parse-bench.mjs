/*
 * E0 baseline parse benchmark for ChestnutLabs/gcode-preview (issue #14 / RR-001).
 *
 * Measures the INHERITED main-thread parser + interpreter (the CPU/memory work that
 * E2 will move to a Web Worker). It does NOT measure rendering / first-useful-preview
 * (that needs WebGL and is an E3 concern), nor scrub/cancellation (no worker exists yet).
 *
 * Each file is parsed in an isolated child process (fresh heap) so peak memory and
 * out-of-memory outcomes are attributed per file. Real fixtures come from the MIT
 * `demo/gcodes/` corpus; large tiers are SYNTHETIC (repetition of demo/gcodes/3DBenchy.gcode)
 * and are generated to the OS temp dir — never committed.
 *
 * Usage:
 *   node --expose-gc tools/benchmark/parse-bench.mjs            # orchestrate
 *   node --expose-gc tools/benchmark/parse-bench.mjs --child <file>   # (internal)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const HEAP_MB = 6144;
const TIMEOUT_MS = 300000;

async function child(file, engineUrl) {
  const { Parser, Interpreter, Job } = await import(engineUrl);

  let peakRss = 0;
  let peakHeap = 0;
  const sample = () => {
    const m = process.memoryUsage();
    if (m.rss > peakRss) peakRss = m.rss;
    if (m.heapUsed > peakHeap) peakHeap = m.heapUsed;
  };
  const timer = setInterval(sample, 50);

  const bytes = fs.statSync(file).size;
  const t0 = performance.now();
  const text = fs.readFileSync(file, 'utf8');
  const t1 = performance.now();
  const parser = new Parser();
  const result = parser.parseGCode(text);
  const t2 = performance.now();
  const interp = new Interpreter();
  interp.execute(result.commands, new Job());
  const t3 = performance.now();
  sample();
  clearInterval(timer);

  process.stdout.write(
    JSON.stringify({
      status: 'ok',
      bytes,
      readMs: +(t1 - t0).toFixed(1),
      parseMs: +(t2 - t1).toFixed(1),
      interpretMs: +(t3 - t2).toFixed(1),
      totalMs: +(t3 - t0).toFixed(1),
      commands: result.commands.length,
      points: interp.points,
      extrusionMm: Math.round(interp.extrusionDistance),
      peakRssMB: +(peakRss / 1048576).toFixed(0),
      peakHeapMB: +(peakHeap / 1048576).toFixed(0)
    })
  );
}

async function buildEngine(tmp) {
  const esbuild = await import('esbuild');
  const entry = path.join(__dirname, 'engine-entry.ts');
  const out = path.join(tmp, 'engine.mjs');
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    logLevel: 'error'
  });
  return pathToFileURL(out).href;
}

function runChild(file, engineUrl) {
  const r = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      `--max-old-space-size=${HEAP_MB}`,
      fileURLToPath(import.meta.url),
      '--child',
      file,
      '--engine',
      engineUrl
    ],
    { encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }
  );
  if (r.status === 0 && r.stdout) {
    try {
      return JSON.parse(r.stdout.trim().split('\n').pop());
    } catch {
      return { status: 'parse-error', raw: r.stdout.slice(0, 200) };
    }
  }
  const oom = (r.stderr || '').match(/heap out of memory|Allocation failed|JavaScript heap/i);
  if (r.signal === 'SIGTERM' || r.error?.code === 'ETIMEDOUT') return { status: 'timeout' };
  return { status: oom ? `OOM(@${HEAP_MB}MB heap)` : `fail(code=${r.status})` };
}

function makeSynthetic(seedPath, targetBytes, outPath) {
  const seed = fs.readFileSync(seedPath);
  const reps = Math.max(1, Math.ceil(targetBytes / seed.length));
  const fd = fs.openSync(outPath, 'w');
  for (let i = 0; i < reps; i++) fs.writeSync(fd, seed);
  fs.closeSync(fd);
  return fs.statSync(outPath).size;
}

async function orchestrate() {
  const demoDir = path.join(repoRoot, 'demo', 'gcodes');
  const real = fs
    .readdirSync(demoDir)
    .filter((f) => f.endsWith('.gcode'))
    .map((f) => ({ label: `demo/gcodes/${f} (MIT)`, file: path.join(demoDir, f), synthetic: false }));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gcode-bench-'));
  const seed = path.join(demoDir, '3DBenchy.gcode');
  const tiers = [
    ['synthetic ~10MB (Benchy xN)', 10 * 1024 * 1024],
    ['synthetic ~100MB (Benchy xN)', 100 * 1024 * 1024],
    ['synthetic ~250MB (Benchy xN)', 250 * 1024 * 1024]
  ];
  const synth = tiers.map(([label, target], i) => {
    const out = path.join(tmp, `synthetic-${i}.gcode`);
    makeSynthetic(seed, target, out);
    return { label, file: out, synthetic: true };
  });

  const corpus = [...real.sort((a, b) => fs.statSync(a.file).size - fs.statSync(b.file).size), ...synth];
  process.stderr.write('  bundling engine with esbuild...\n');
  const engineUrl = await buildEngine(tmp);
  const rows = [];
  for (const item of corpus) {
    const res = runChild(item.file, engineUrl);
    const sizeMB = (fs.statSync(item.file).size / 1048576).toFixed(1);
    rows.push({ label: item.label, sizeMB, ...res });
    process.stderr.write(`  benched ${item.label} (${sizeMB} MB): ${res.status}\n`);
  }

  // Markdown table
  const head =
    '| Fixture | Size MB | Read ms | Parse ms | Interpret ms | Total ms | Commands | Points | Peak RSS MB | Peak heap MB | Status |\n' +
    '|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|';
  const body = rows
    .map(
      (r) =>
        `| ${r.label} | ${r.sizeMB} | ${r.readMs ?? '-'} | ${r.parseMs ?? '-'} | ${r.interpretMs ?? '-'} | ${r.totalMs ?? '-'} | ${r.commands ?? '-'} | ${r.points ?? '-'} | ${r.peakRssMB ?? '-'} | ${r.peakHeapMB ?? '-'} | ${r.status} |`
    )
    .join('\n');
  const out = `${head}\n${body}\n`;
  process.stdout.write(out);
  const resultsFile = process.env.BENCH_OUT || path.join(tmp, 'results.md');
  fs.writeFileSync(resultsFile, out);
  process.stderr.write(`\nresults table written to: ${resultsFile}\ntemp corpus dir: ${tmp}\n`);
}

const childFlag = process.argv.indexOf('--child');
if (childFlag !== -1) {
  const engineFlag = process.argv.indexOf('--engine');
  await child(process.argv[childFlag + 1], process.argv[engineFlag + 1]);
} else {
  await orchestrate();
}
