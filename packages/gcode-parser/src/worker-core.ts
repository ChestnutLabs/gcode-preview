/**
 * Transport-agnostic worker handler (DD-003 §4.3/§5.2, issue #45).
 *
 * Contains the entire worker-side protocol logic without referencing any Worker
 * global, so it is directly testable in Node: the host supplies `post` and feeds
 * inbound messages to the returned handler. The Web Worker entry (`worker.ts`)
 * is a two-line shim over this.
 */
import { parseGcodeToIRAsync, type AsyncParseHooks, type AsyncParseResult, type ParseOptions } from './parse';
import { isBlobLike, isReadableStreamLike, parseGcodeStreamToIR } from './streaming';
import {
  PROTOCOL_VERSION,
  irTransferList,
  type ParseInputWire,
  type WorkerRequest,
  type WorkerResponse
} from './protocol';

export type PostFn = (msg: WorkerResponse, transfer?: ArrayBuffer[]) => void;

const PROGRESS_THROTTLE_MS = 100;

/** Route by input form (§4.2): streams/Blobs use the line-drain driver, memory uses the async driver. */
function dispatchParse(input: ParseInputWire, opts: ParseOptions, hooks: AsyncParseHooks): Promise<AsyncParseResult> {
  if (isBlobLike(input) || isReadableStreamLike(input)) {
    return parseGcodeStreamToIR(input, opts, hooks);
  }
  return parseGcodeToIRAsync(input, opts, hooks);
}

export function createWorkerHandler(post: PostFn): (msg: WorkerRequest) => void {
  let activeId: number | null = null;
  let cancelRequested = false;

  return (msg: WorkerRequest): void => {
    if (typeof msg !== 'object' || msg === null || (msg as { v?: number }).v !== PROTOCOL_VERSION) {
      const id = (msg as { id?: number })?.id ?? -1;
      post({
        v: PROTOCOL_VERSION,
        type: 'error',
        id,
        error: {
          code: 'E_PROTOCOL',
          message: `unsupported message or protocol version (expected v${PROTOCOL_VERSION})`
        }
      });
      return;
    }

    if (msg.type === 'cancel') {
      if (msg.id === activeId) {
        cancelRequested = true;
      }
      return;
    }

    if (msg.type === 'parse') {
      if (activeId !== null) {
        post({
          v: PROTOCOL_VERSION,
          type: 'error',
          id: msg.id,
          error: { code: 'E_BUSY', message: 'a parse is already in progress on this session' }
        });
        return;
      }
      activeId = msg.id;
      cancelRequested = false;
      const { partialOnCancel, yieldIntervalMs, ...parseOpts } = msg.opts ?? {};

      let lastProgress = 0;
      const hooks: AsyncParseHooks = {
        yieldIntervalMs,
        shouldCancel: () => cancelRequested,
        onProgress: (bytesProcessed, totalBytes) => {
          const now = Date.now();
          if (now - lastProgress >= PROGRESS_THROTTLE_MS) {
            lastProgress = now;
            post({ v: PROTOCOL_VERSION, type: 'progress', id: msg.id, bytesProcessed, totalBytes, phase: 'parsing' });
          }
        }
      };
      void dispatchParse(msg.input, parseOpts, hooks)
        .then((result) => {
          if (result.cancelled) {
            const partial = partialOnCancel ? { ir: result.ir, stats: result.stats } : undefined;
            post(
              { v: PROTOCOL_VERSION, type: 'cancelled', id: msg.id, partial },
              partial ? irTransferList(partial.ir) : undefined
            );
          } else {
            // Terminal-message contract (§4.3): complete AND limit-bounded parses both
            // arrive as `done` (limit-bounded: complete:false + stats.stopReason).
            post(
              { v: PROTOCOL_VERSION, type: 'done', id: msg.id, ir: result.ir, stats: result.stats },
              irTransferList(result.ir)
            );
          }
        })
        .catch((err: unknown) => {
          post({
            v: PROTOCOL_VERSION,
            type: 'error',
            id: msg.id,
            error: { code: 'E_INTERNAL', message: err instanceof Error ? err.message : String(err) }
          });
        })
        .finally(() => {
          activeId = null;
          cancelRequested = false;
        });
    }
  };
}
