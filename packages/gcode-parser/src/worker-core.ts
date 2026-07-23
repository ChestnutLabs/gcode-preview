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
import { isBlobLike, isReadableStreamLike, parseGcodeStreamToIR, type ReadableStreamLike } from './streaming.js';
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
    containerMeta?: Record<string, string>;
  }): DialectRunLike | null;
}

/** Structural mirror of gcode-containers' adapter (DD-005 §4.4) — same composition rule as dialects. */
export interface OpenedContainerLike {
  id: string;
  plates: { index: number; name: string; estimatedBytes: number }[];
  metadata: {
    machine?: import('@chestnutlabs/toolpath-core').MachineGeometry;
    filaments?: import('@chestnutlabs/toolpath-core').FilamentInfo[];
    raw: Record<string, string>;
    warnings: { code: string; message: string }[];
  };
  openPlate(index: number): ReadableStreamLike<Uint8Array>;
}

export interface ContainerAdapterLike {
  id: string;
  sniff(prefix: Uint8Array): boolean;
  open(bytes: Uint8Array): Promise<OpenedContainerLike>;
}

export interface WorkerHandlerOptions {
  /** Dialect runner composed by the worker entry (absent in worker-slim). */
  dialects?: DialectRunnerFactoryLike;
  /** Container adapters composed by the worker entry (absent in worker-slim). */
  containers?: ContainerAdapterLike[];
}

const PROGRESS_THROTTLE_MS = 100;
const DETECT_HEAD_BYTES = 64 * 1024;
const DETECT_TAIL_BYTES = 16 * 1024;
/** §4.5 stream replay: max recorded hook events before annotation degrades (visibly). */
const STREAM_EVENT_CAP = 500_000;

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
      const {
        partialOnCancel,
        yieldIntervalMs,
        partialPreview,
        dialects,
        dialectConfig,
        containers,
        plate,
        ...parseOpts
      } = msg.opts ?? {};

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
        // Container resolution (DD-005 §4.4): sniff sliceable inputs; on a
        // match the selected plate's stream becomes the parse input and the
        // container's metadata rides beside the IR.
        let input: ParseInputWire = msg.input;
        let opened: OpenedContainerLike | null = null;
        const containerSel = containers ?? 'auto';
        const containerWarnings: Warning[] = [];
        if (containerSel !== false && (handlerOpts.containers?.length ?? 0) > 0) {
          let bytes: Uint8Array | null = null;
          if (input instanceof Uint8Array) bytes = input;
          else if (isBlobLike(input)) {
            const blob = input as unknown as { arrayBuffer?: () => Promise<ArrayBuffer> };
            if (typeof blob.arrayBuffer === 'function') bytes = new Uint8Array(await blob.arrayBuffer());
          }
          if (bytes !== null && bytes.byteLength >= 4) {
            const adapter = (handlerOpts.containers as ContainerAdapterLike[]).find(
              (a) => (containerSel === 'auto' || containerSel.includes(a.id)) && a.sniff(bytes.subarray(0, 8))
            );
            if (adapter !== undefined) {
              try {
                opened = await adapter.open(bytes);
              } catch (err) {
                const code =
                  err instanceof Error && 'code' in err && typeof (err as { code: unknown }).code === 'string'
                    ? (err as { code: string }).code
                    : 'E_CONTAINER';
                post({
                  v: PROTOCOL_VERSION,
                  type: 'error',
                  id: msg.id,
                  error: { code, message: err instanceof Error ? err.message : String(err) }
                });
                return;
              }
              const plateIdx = plate ?? 0;
              if (plateIdx < 0 || plateIdx >= opened.plates.length) {
                post({
                  v: PROTOCOL_VERSION,
                  type: 'error',
                  id: msg.id,
                  error: {
                    code: 'E_CONTAINER_NO_PAYLOAD',
                    message: `plate ${plateIdx} does not exist (container has ${opened.plates.length})`
                  }
                });
                return;
              }
              if (opened.plates.length > 1 && plate === undefined) {
                containerWarnings.push({
                  code: 'container-multiple-plates',
                  message:
                    `container has ${opened.plates.length} plates ` +
                    `(${opened.plates.map((p) => p.name).join(', ')}); parsing plate 0 — pass {plate} to select`,
                  severity: 'warn',
                  count: 1
                });
              }
              for (const w of opened.metadata.warnings) {
                containerWarnings.push({ ...w, severity: 'warn', count: 1 });
              }
              input = opened.openPlate(plateIdx);
            }
          }
        }

        // Dialect annotation (DD-005 §4.5): composed by the worker entry; the
        // main thread only ever sent serializable IDs/config.
        let run: DialectRunLike | null = null;
        const selection = dialects ?? 'auto';
        let slimRequested = false;
        if (selection !== false) {
          if (handlerOpts.dialects !== undefined) {
            const windows = opened === null ? await detectWindows(input) : { headText: '', tailText: '' };
            run = handlerOpts.dialects.createRun({
              selection,
              config: dialectConfig,
              headText: windows.headText,
              tailText: windows.tailText,
              containerMeta: opened?.metadata.raw
            });
            if (run !== null) {
              (parseOpts as ParseOptions).onComment = run.onComment;
              (parseOpts as ParseOptions).onCommand = run.onCommand;
            }
          } else if (Array.isArray(selection)) {
            slimRequested = true; // explicit request against a slim worker — degrade VISIBLY
          }
        }

        // §4.5 non-seekable stream tail detection: no up-front windows exist,
        // so record hook events (bounded) plus head/tail text during the parse
        // and REPLAY into a late-detected run afterwards. Container plate
        // streams don't need this — their run detects via containerMeta.
        type RecordedEvent = { kind: 'comment'; t: string; b: number } | { kind: 'command'; e: CommandEvent };
        let streamReplay: {
          events: RecordedEvent[];
          overflow: boolean;
          windows: { head: string; tail: string };
        } | null = null;
        if (
          run === null &&
          selection !== false &&
          handlerOpts.dialects !== undefined &&
          opened === null &&
          isReadableStreamLike(input)
        ) {
          const rec = { events: [] as RecordedEvent[], overflow: false, windows: { head: '', tail: '' } };
          streamReplay = rec;
          hooks.captureWindows = rec.windows;
          (parseOpts as ParseOptions).onComment = (t, b) => {
            if (rec.events.length < STREAM_EVENT_CAP) rec.events.push({ kind: 'comment', t, b });
            else rec.overflow = true;
          };
          (parseOpts as ParseOptions).onCommand = (e) => {
            if (rec.events.length < STREAM_EVENT_CAP) rec.events.push({ kind: 'command', e });
            else rec.overflow = true;
          };
        }

        const result = await dispatchParse(input, parseOpts, hooks);
        if (result.cancelled) {
          const partial = partialOnCancel ? { ir: result.ir, stats: result.stats } : undefined;
          post(
            { v: PROTOCOL_VERSION, type: 'cancelled', id: msg.id, partial },
            partial ? irTransferList(partial.ir) : undefined
          );
          return;
        }
        if (streamReplay !== null) {
          if (streamReplay.overflow) {
            result.ir.header.warnings.push({
              code: 'dialect-stream-truncated',
              message:
                'stream exceeded the dialect replay budget; annotation skipped — ' +
                'use Uint8Array/Blob input for full annotation of very large files',
              severity: 'warn',
              count: 1
            });
          } else {
            run = handlerOpts.dialects!.createRun({
              selection: selection as 'auto' | string[],
              config: dialectConfig,
              headText: streamReplay.windows.head,
              tailText: streamReplay.windows.tail
            });
            if (run !== null) {
              for (const ev of streamReplay.events) {
                if (ev.kind === 'comment') run.onComment(ev.t, ev.b);
                else run.onCommand(ev.e);
              }
            }
          }
        }
        let metadata: DialectMetadata | undefined;
        if (run !== null) {
          metadata = run.finalize(result.ir).metadata;
        }
        // Merge container metadata (§4.4): container-config machine data is
        // 'known' and outranks comment-inferred geometry; ties go to the
        // container (it is the project's own machine config).
        if (opened !== null) {
          metadata = metadata ?? {};
          const cm = opened.metadata.machine;
          if (cm !== undefined && (metadata.machine === undefined || cm.confidence === 'known')) {
            metadata.machine = cm;
          }
          if (opened.metadata.filaments !== undefined && opened.metadata.filaments.length > 0) {
            metadata.filaments = [...(metadata.filaments ?? []), ...opened.metadata.filaments];
          }
          if (Object.keys(opened.metadata.raw).length > 0) {
            metadata.raw = { ...opened.metadata.raw, ...(metadata.raw ?? {}) };
          }
        }
        for (const w of containerWarnings) {
          result.ir.header.warnings.push(w);
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
          // Preserve structured codes (e.g. mid-stream E_CONTAINER_CRC from a
          // plate stream) instead of collapsing everything into E_INTERNAL.
          const code =
            err instanceof Error && 'code' in err && typeof (err as { code: unknown }).code === 'string'
              ? (err as { code: string }).code
              : 'E_INTERNAL';
          post({
            v: PROTOCOL_VERSION,
            type: 'error',
            id: msg.id,
            error: { code, message: err instanceof Error ? err.message : String(err) }
          });
        })
        .finally(() => {
          activeId = null;
          cancelRequested = false;
        });
    }
  };
}
