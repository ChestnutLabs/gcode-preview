/**
 * Web Worker entry — SLIM (DD-005 §4.5): zero dialect adapters bundled.
 *
 * Smallest payload for consumers that never want annotation. Explicit dialect
 * requests against this entry degrade VISIBLY (`dialects-unavailable` warning
 * on the result), never silently. Use via the session escape hatch:
 * `new GcodeParseSession({ worker: () => new Worker(new URL(
 *   '@chestnutlabs/gcode-parser/dist/worker-slim.js', import.meta.url),
 *   { type: 'module' }) })`.
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
