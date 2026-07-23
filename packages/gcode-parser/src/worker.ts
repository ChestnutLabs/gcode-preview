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
import { createDialectRunner } from '@chestnutlabs/gcode-dialects';
import { createWorkerHandler, type PostFn } from './worker-core.js';
import type { WorkerRequest } from './protocol.js';

/** Built-in adapter set (DD-005 phases 3–5 populate this). */
const BUILTIN_ADAPTERS: Parameters<typeof createDialectRunner>[0] = [];

declare const self: {
  postMessage(msg: unknown, transfer?: ArrayBuffer[]): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
};

const post: PostFn = (msg, transfer) => self.postMessage(msg, transfer);
const handle = createWorkerHandler(post, { dialects: createDialectRunner(BUILTIN_ADAPTERS) });
self.onmessage = (ev) => handle(ev.data as WorkerRequest);
