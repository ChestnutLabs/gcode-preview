/*
 * Per-fixture benchmark child (issue #47). One fixture per process for clean
 * peak-RSS attribution (mirrors a browser renderer+worker pair).
 *
 * Modes (argv[2]):
 *   parse <file>     — full session parse; wall/throughput/main-thread stall/RSS
 *   cancel <file>    — start parse, cancel after 500 ms; cooperative latency
 *   transfer <file>  — parse-and-hold in worker, then measure pure IR delivery
 *
 * Prints one JSON line: BENCH_RESULT {...}
 */
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { GcodeParseSession, CancelledError } from '../../packages/gcode-parser/dist/index.js';

const entryPath = fileURLToPath(new URL('./worker-entry-node.mjs', import.meta.url));

/** Adapt node:worker_threads to the session's WorkerLike (§4.4 escape hatch). */
function nodeWorkerAdapter() {
  const w = new Worker(entryPath);
  const adapter = {
    onmessage: null,
    onerror: null,
    postMessage: (m, t) => w.postMessage(m, t),
    terminate: () => void w.terminate(),
    raw: w
  };
  w.on('message', (data) => adapter.onmessage?.({ data }));
  w.on('error', (err) => adapter.onerror?.(err));
  return adapter;
}

function startSamplers() {
  const state = { maxStallMs: 0, peakRssMB: 0, stop: null };
  let last = Date.now();
  const lagTimer = setInterval(() => {
    const now = Date.now();
    const stall = now - last - 5;
    if (stall > state.maxStallMs) state.maxStallMs = stall;
    last = now;
  }, 5);
  const rssTimer = setInterval(() => {
    const rss = process.memoryUsage().rss / 1048576;
    if (rss > state.peakRssMB) state.peakRssMB = rss;
  }, 100);
  state.stop = () => {
    clearInterval(lagTimer);
    clearInterval(rssTimer);
    const rss = process.memoryUsage().rss / 1048576;
    if (rss > state.peakRssMB) state.peakRssMB = rss;
  };
  return state;
}

function waitForReady(adapter) {
  return new Promise((resolve) => {
    const prev = adapter.onmessage;
    adapter.onmessage = (ev) => {
      if (ev.data && ev.data.type === 'workerReady') {
        adapter.onmessage = prev;
        resolve();
      } else {
        prev?.(ev);
      }
    };
  });
}

async function modeParse(file) {
  const bytes = new Uint8Array(readFileSync(file));
  const sizeMB = bytes.byteLength / 1048576;
  const adapter = nodeWorkerAdapter();
  await waitForReady(adapter);
  const session = new GcodeParseSession({ worker: adapter });
  const samplers = startSamplers();

  const t0 = Date.now();
  const result = await session.parse(bytes);
  const wallMs = Date.now() - t0;
  samplers.stop();
  session.dispose();

  return {
    mode: 'parse',
    sizeMB: +sizeMB.toFixed(1),
    wallMs,
    throughputMBs: +(sizeMB / (wallMs / 1000)).toFixed(2),
    maxMainThreadStallMs: Math.round(samplers.maxStallMs),
    peakRssMB: Math.round(samplers.peakRssMB),
    segments: result.ir.segments.count,
    layers: result.ir.layers.length,
    complete: result.ir.header.complete,
    stopReason: result.stats.stopReason?.code ?? null
  };
}

async function modeCancel(file) {
  const bytes = new Uint8Array(readFileSync(file));
  const adapter = nodeWorkerAdapter();
  await waitForReady(adapter);
  const session = new GcodeParseSession({ worker: adapter });

  const parsePromise = session.parse(bytes, { partialOnCancel: true });
  await new Promise((r) => setTimeout(r, 500));
  const tCancel = Date.now();
  session.cancel();
  let latencyMs = -1;
  let terminated = null;
  let partialSegments = null;
  try {
    await parsePromise;
  } catch (err) {
    latencyMs = Date.now() - tCancel;
    if (err instanceof CancelledError) {
      terminated = err.terminated;
      partialSegments = err.partial ? err.partial.ir.segments.count : null;
    }
  }
  session.dispose();
  return { mode: 'cancel', cancelLatencyMs: latencyMs, terminated, partialSegments };
}

async function modeTransfer(file) {
  const bytes = new Uint8Array(readFileSync(file));
  const adapter = nodeWorkerAdapter();
  await waitForReady(adapter);

  const heldInfo = await new Promise((resolve) => {
    adapter.onmessage = (ev) => {
      if (ev.data.type === 'held') resolve(ev.data);
    };
    adapter.postMessage({ type: 'holdParse', input: bytes }, [bytes.buffer]);
  });

  const { deliveryMs, segments } = await new Promise((resolve) => {
    adapter.onmessage = (ev) => {
      if (ev.data.type === 'heldIr') {
        const tReceived = Date.now();
        resolve({ deliveryMs: tReceived - ev.data.postedAt, segments: ev.data.ir.segments.count });
      }
    };
    adapter.postMessage({ type: 'sendHeld' });
  });
  adapter.terminate();
  return {
    mode: 'transfer',
    heldSegments: heldInfo.segments,
    deliveredSegments: segments,
    transferDeliveryMs: deliveryMs
  };
}

const [, , mode, file] = process.argv;
const run = mode === 'cancel' ? modeCancel : mode === 'transfer' ? modeTransfer : modeParse;
run(file)
  .then((result) => {
    console.log('BENCH_RESULT ' + JSON.stringify(result));
    process.exit(0);
  })
  .catch((err) => {
    console.log('BENCH_RESULT ' + JSON.stringify({ mode, error: String(err && err.message) }));
    process.exit(1);
  });
