/*
 * Batteries-equivalent worker entry running in node:worker_threads, importing ONLY the
 * installed tarball packages (mirrors packages/gcode-parser/src/worker.ts composition).
 */
import { parentPort } from 'node:worker_threads';
import { createWorkerHandler } from '@chestnutlabs/gcode-parser';
import {
  createDialectRunner,
  prusaSlicer,
  orcaBambu,
  cura,
  klipper,
  marlin,
  repRap
} from '@chestnutlabs/gcode-dialects';
import { openGcode3mf, sniffGcode3mf } from '@chestnutlabs/gcode-containers';

const handler = createWorkerHandler((msg, transfer) => parentPort.postMessage(msg, transfer), {
  dialects: createDialectRunner([prusaSlicer(), orcaBambu(), cura(), klipper(), marlin(), repRap()]),
  containers: [{ id: 'gcode-3mf', sniff: sniffGcode3mf, open: (bytes) => openGcode3mf(bytes) }]
});

parentPort.on('message', (msg) => handler(msg));
