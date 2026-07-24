/*
 * Node worker entry for the E2 benchmark (issue #47).
 *
 * Runs the REAL transport-agnostic worker handler (createWorkerHandler) inside a
 * node:worker_threads Worker, so the benchmark exercises the actual protocol v1
 * across a genuine thread boundary with real buffer transfer.
 *
 * Also supports a 'hold' mode for the pure-transfer micro-benchmark: parse, keep
 * the IR, and only post it (with the full transfer list) when told to — isolating
 * transfer + delivery cost from parse time.
 */
import { parentPort } from 'node:worker_threads';
import {
  createWorkerHandler,
  parseGcodeToIRAsync,
  irTransferList,
  PROTOCOL_VERSION
} from '../../packages/gcode-parser/dist/index.js';
import {
  createDialectRunner,
  prusaSlicer,
  orcaBambu,
  cura,
  klipper,
  marlin,
  repRap
} from '../../packages/gcode-dialects/dist/index.js';
import { openGcode3mf, sniffGcode3mf } from '../../packages/gcode-containers/dist/index.js';

// Batteries-equivalent composition (mirrors packages/gcode-parser/src/worker.ts)
// so benchmarks measure the real end-to-end pipeline incl. E4 adapters.
const handler = createWorkerHandler((msg, transfer) => parentPort.postMessage(msg, transfer), {
  dialects: createDialectRunner([prusaSlicer(), orcaBambu(), cura(), klipper(), marlin(), repRap()]),
  containers: [{ id: 'gcode-3mf', sniff: sniffGcode3mf, open: (bytes) => openGcode3mf(bytes) }]
});

let held = null;

parentPort.on('message', (msg) => {
  if (msg && msg.type === 'holdParse') {
    // Transfer micro-bench: parse now, deliver later on demand.
    void parseGcodeToIRAsync(msg.input, {}, { yieldIntervalMs: 50 }).then((result) => {
      held = result;
      parentPort.postMessage({ type: 'held', segments: result.ir.segments.count });
    });
    return;
  }
  if (msg && msg.type === 'sendHeld') {
    const t0 = Date.now();
    parentPort.postMessage({ type: 'heldIr', ir: held.ir, stats: held.stats, postedAt: t0 }, irTransferList(held.ir));
    held = null;
    return;
  }
  handler(msg);
});

parentPort.postMessage({ type: 'workerReady', v: PROTOCOL_VERSION });
