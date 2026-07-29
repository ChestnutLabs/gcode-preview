/**
 * Web Worker entry — BATTERIES-INCLUDED (DD-003 §4.4 option (a); DD-005 §4.5).
 *
 * Consumers' bundlers (Vite/webpack/Rollup) bundle this file automatically via
 * `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`
 * in `session.ts`. All logic lives in the transport-agnostic `worker-core`;
 * this entry composes it with the built-in dialect adapter set (currently
 * empty — vendor adapters land in DD-005 phases 3–5; the wiring is live so
 * they activate here without API changes). Size-sensitive consumers use
 * `worker-slim.ts`; custom adapters use a consumer-supplied worker entry
 * calling `createWorkerHandler(post, { dialects: createDialectRunner([...]) })`.
 */
import {
  createDialectRunner,
  cura,
  grblLaser,
  grblMill,
  klipper,
  linuxCnc,
  marlin,
  orcaBambu,
  prusaSlicer,
  repRap
} from '@chestnutlabs/gcode-dialects';
import { openGcode3mf, sniffGcode3mf } from '@chestnutlabs/gcode-containers';
import { openBgcodeContainer, sniffBgcode } from '@chestnutlabs/gcode-bgcode';
import { createWorkerHandler, type ContainerAdapterLike, type PostFn } from './worker-core.js';
import type { WorkerRequest } from './protocol.js';

/** Built-in dialect adapter set (DD-005 phases 3–4; phase 5 adds command semantics). */
const BUILTIN_ADAPTERS: Parameters<typeof createDialectRunner>[0] = [
  prusaSlicer(),
  orcaBambu(),
  cura(),
  klipper(),
  marlin(),
  repRap(),
  // Non-extrusion controllers (DD-012 phase 3, #189) — all EXPERIMENTAL tier until hardware-validated.
  grblLaser(),
  grblMill(),
  linuxCnc()
];

/** Built-in container adapters (DD-005 §4.4): .gcode.3mf and Prusa binary G-code (.bgcode, #188). */
const BUILTIN_CONTAINERS: ContainerAdapterLike[] = [
  { id: 'gcode-3mf', sniff: sniffGcode3mf, open: (bytes) => openGcode3mf(bytes) },
  { id: 'bgcode', sniff: (prefix) => sniffBgcode(prefix), open: (bytes) => openBgcodeContainer(bytes) }
];

declare const self: {
  postMessage(msg: unknown, transfer?: ArrayBuffer[]): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
};

const post: PostFn = (msg, transfer) => self.postMessage(msg, transfer);
const handle = createWorkerHandler(post, {
  dialects: createDialectRunner(BUILTIN_ADAPTERS),
  containers: BUILTIN_CONTAINERS
});
self.onmessage = (ev) => handle(ev.data as WorkerRequest);
