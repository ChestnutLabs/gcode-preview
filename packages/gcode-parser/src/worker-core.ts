/**
 * Transport-agnostic worker handler (DD-003 §4.3/§5.2, issue #45).
 *
 * Contains the entire worker-side protocol logic without referencing any Worker
 * global, so it is directly testable in Node: the host supplies `post` and feeds
 * inbound messages to the returned handler. The Web Worker entry (`worker.ts`)
 * is a two-line shim over this.
 */
import type { DialectMetadata, ToolpathIR, Warning } from '@chestnutlabs/toolpath-core';
import {
  parseGcodeToIRAsync,
  type AsyncParseHooks,
  type AsyncParseResult,
  type CommandEvent,
  type ParseOptions
} from './parse.js';
import { isBlobLike, isReadableStreamLike, parseGcodeStreamToIR } from './streaming.js';
import {
  PARTIAL_PREVIEW_MIN_BYTES,
  PROTOCOL_VERSION,
  irTransferList,
  type ParseInputWire,
  type WorkerRequest,
  type WorkerResponse
} from './protocol.js';

export type PostFn = (msg: WorkerResponse, transfer?: ArrayBuffer[]) => void;

/**
 * Structural mirror of @chestnutlabs/gcode-dialects' runner factory (DD-005
 * §4.5): the parser never imports the dialects package — worker ENTRIES
 * compose the two (`worker.ts` batteries-included, `worker-slim.ts` none,
 * custom workers their own set).
 */
export interface DialectRunLike {
  onComment: (text: string, srcByte: number) => void;
  onCommand: (event: CommandEvent) => void;
  finalize(ir: ToolpathIR): { metadata?: DialectMetadata; warnings: Warning[] };
}

export interface DialectRunnerFactoryLike {
  adapterIds: string[];
  createRun(input: {
    selection: 'auto' | string[];
    config?: Record<string, unknown>;
    headText: string;
    tailText: string;
  }): DialectRunLike | null;
}

export interface WorkerHandlerOptions {
  /** Dialect runner composed by the worker entry (absent in worker-slim). */
  dialects?: DialectRunnerFactoryLike;
}

const PROGRESS_THROTTLE_MS = 100;
const DETECT_HEAD_BYTES = 64 * 1024;
const DETECT_TAIL_BYTES = 16 * 1024;

/** Detection windows for sliceable inputs (DD-005 §4.5). Non-seekable streams: head/tail arrive in phase 4. */
async function detectWindows(input: ParseInputWire): Promise<{ headText: string; tailText: string }> {
  if (typeof input === 'string') {
    return { headText: input.slice(0, DETECT_HEAD_BYTES), tailText: input.slice(-DETECT_TAIL_BYTES) };
  }
  if (input instanceof Uint8Array) {
    const dec = new TextDecoder();
    return {
      headText: dec.decode(input.subarray(0, DETECT_HEAD_BYTES)),
      tailText: dec.decode(input.subarray(Math.max(0, input.byteLength - DETECT_TAIL_BYTES)))
    };
  }
  if (isBlobLike(input)) {
    const blob = input as unknown as { size: number; slice(start: number, end?: number): { text(): Promise<string> } };
    if (typeof blob.slice === 'function') {
      const head = await blob.slice(0, DETECT_HEAD_BYTES).text();
      const tail = await blob.slice(Math.max(0, blob.size - DETECT_TAIL_BYTES)).text();
      return { headText: head, tailText: tail };
    }
  }
  return { headText: '', tailText: '' };
}

/** Route by input form (§4.2): streams/Blobs use the line-drain driver, memory uses the async driver. */
function dispatchParse(input: ParseInputWire, opts: ParseOptions, hooks: AsyncParseHooks): Promise<AsyncParseResult> {
  if (isBlobLike(input) || isReadableStreamLike(input)) {
    return parseGcodeStreamToIR(input, opts, hooks);
  }
  return parseGcodeToIRAsync(input, opts, hooks);
}

export function createWorkerHandler(
  post: PostFn,
  handlerOpts: WorkerHandlerOptions = {}
): (msg: WorkerRequest) => void {
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
      const { partialOnCancel, yieldIntervalMs, partialPreview, dialects, dialectConfig, ...parseOpts } =
        msg.opts ?? {};

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
      // Progressive preview (#60): on by default with the §5.4 25 MiB threshold;
      // partials transfer zero-copy like the terminal IR.
      if (partialPreview !== false) {
        hooks.partialMinBytes = partialPreview?.minInputBytes ?? PARTIAL_PREVIEW_MIN_BYTES;
        hooks.partialIntervalMs = partialPreview?.intervalMs ?? 1000;
        hooks.onPartial = (slice, cumulativeSegments) => {
          post({ v: PROTOCOL_VERSION, type: 'partial', id: msg.id, slice, cumulativeSegments }, irTransferList(slice));
        };
      }
      void (async () => {
        // Dialect annotation (DD-005 §4.5): composed by the worker entry; the
        // main thread only ever sent serializable IDs/config.
        let run: DialectRunLike | null = null;
        const selection = dialects ?? 'auto';
        let slimRequested = false;
        if (selection !== false) {
          if (handlerOpts.dialects !== undefined) {
            const windows = await detectWindows(msg.input);
            run = handlerOpts.dialects.createRun({
              selection,
              config: dialectConfig,
              headText: windows.headText,
              tailText: windows.tailText
            });
            if (run !== null) {
              (parseOpts as ParseOptions).onComment = run.onComment;
              (parseOpts as ParseOptions).onCommand = run.onCommand;
            }
          } else if (Array.isArray(selection)) {
            slimRequested = true; // explicit request against a slim worker — degrade VISIBLY
          }
        }

        const result = await dispatchParse(msg.input, parseOpts, hooks);
        if (result.cancelled) {
          const partial = partialOnCancel ? { ir: result.ir, stats: result.stats } : undefined;
          post(
            { v: PROTOCOL_VERSION, type: 'cancelled', id: msg.id, partial },
            partial ? irTransferList(partial.ir) : undefined
          );
          return;
        }
        let metadata: DialectMetadata | undefined;
        if (run !== null) {
          metadata = run.finalize(result.ir).metadata;
        }
        if (slimRequested) {
          result.ir.header.warnings.push({
            code: 'dialects-unavailable',
            message: 'dialect adapters requested but this worker entry bundles none (worker-slim)',
            severity: 'warn',
            count: 1
          });
        }
        // Terminal-message contract (§4.3): complete AND limit-bounded parses both
        // arrive as `done` (limit-bounded: complete:false + stats.stopReason).
        const transfer = irTransferList(result.ir);
        for (const t of metadata?.thumbnails ?? []) {
          transfer.push(t.bytes.buffer as ArrayBuffer);
        }
        post({ v: PROTOCOL_VERSION, type: 'done', id: msg.id, ir: result.ir, stats: result.stats, metadata }, transfer);
      })()
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
