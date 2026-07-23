/**
 * Web Worker entry (DD-003 §4.4 option (a)).
 *
 * Consumers' bundlers (Vite/webpack/Rollup) bundle this file automatically via
 * `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`
 * in `session.ts`. All logic lives in the transport-agnostic `worker-core`.
 */
import { createWorkerHandler, type PostFn } from './worker-core.js';
import type { WorkerRequest } from './protocol.js';

declare const self: {
  postMessage(msg: unknown, transfer?: ArrayBuffer[]): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
};

const post: PostFn = (msg, transfer) => self.postMessage(msg, transfer);
const handle = createWorkerHandler(post);
self.onmessage = (ev) => handle(ev.data as WorkerRequest);
