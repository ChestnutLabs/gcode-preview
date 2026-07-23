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
import { createDialectRunner, orcaBambu, prusaSlicer } from '@chestnutlabs/gcode-dialects';
import { openGcode3mf, sniffGcode3mf } from '@chestnutlabs/gcode-containers';
import { createWorkerHandler, type ContainerAdapterLike, type PostFn } from './worker-core.js';
import type { WorkerRequest } from './protocol.js';

/** Built-in dialect adapter set (DD-005 phase 3; phases 4–5 extend it). */
const BUILTIN_ADAPTERS: Parameters<typeof createDialectRunner>[0] = [prusaSlicer(), orcaBambu()];

/** Built-in container adapters (DD-005 §4.4): .gcode.3mf. */
const BUILTIN_CONTAINERS: ContainerAdapterLike[] = [
  { id: 'gcode-3mf', sniff: sniffGcode3mf, open: (bytes) => openGcode3mf(bytes) }
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
