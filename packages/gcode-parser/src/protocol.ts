/**
 * Worker protocol v1 (DD-003 §4.3).
 *
 * A parse ends in exactly one terminal message:
 * - `done` — complete AND limit-bounded parses (limit-bounded: `ir.header.complete === false`
 *   + `stats.stopReason`); the client RESOLVES `parse()` with the ParseResult.
 * - `error` — failures producing no usable IR; the client REJECTS.
 * - `cancelled` — client rejects with E_CANCELLED; `partial` attached when requested.
 */
import type { DialectMetadata, ToolpathIR } from '@chestnutlabs/toolpath-core';
import type { ParseOptions, ParseStats } from './parse.js';
import type { BlobLike, ReadableStreamLike } from './streaming.js';

export const PROTOCOL_VERSION = 1;

export interface WireParseOptions extends ParseOptions {
  /** Attach the bounded partial IR to a `cancelled` response (DD-003 §5.2). */
  partialOnCancel?: boolean;
  /** Cooperative yield interval override (tests only; default 50 ms). */
  yieldIntervalMs?: number;
  /**
   * Progressive preview (DD-004 §5.4, issue #60). Default 'auto': partial
   * snapshots stream once bytesProcessed ≥ minInputBytes (default 25 MiB,
   * provisional until #61 ratifies), at most one per intervalMs (default 1000).
   * `false` disables; `{ minInputBytes: 0 }` forces immediate previews.
   */
  partialPreview?: false | { minInputBytes?: number; intervalMs?: number };
  /**
   * Dialect annotation (DD-005 §4.5): SERIALIZABLE selection only — adapter
   * implementations live inside the worker entry. 'auto' (default) runs
   * detection over the entry's registered set; an array restricts by id;
   * false disables.
   */
  dialects?: 'auto' | string[] | false;
  /** Per-adapter structured-cloneable configuration, keyed by adapter id. */
  dialectConfig?: Record<string, unknown>;
  /**
   * Container extraction (DD-005 §4.4): 'auto' (default) sniffs sliceable
   * inputs against the worker entry's registered container adapters; an array
   * restricts by id; false disables.
   */
  containers?: 'auto' | string[] | false;
  /** Plate selection for multi-plate containers (default 0 + a
   *  `container-multiple-plates` warning carrying the discovered plate list). */
  plate?: number;
}

/** §5.4 provisional progressive-preview threshold (ratified by #61). */
export const PARTIAL_PREVIEW_MIN_BYTES = 25 * 1024 * 1024;

/** Blob is structured-cloneable; ReadableStream is transferred (§4.2). */
export type ParseInputWire = string | Uint8Array | BlobLike | ReadableStreamLike<Uint8Array>;

export interface ParseRequest {
  v: number;
  type: 'parse';
  id: number;
  input: ParseInputWire;
  opts?: WireParseOptions;
}

export interface CancelRequest {
  v: number;
  type: 'cancel';
  id: number;
}

export type WorkerRequest = ParseRequest | CancelRequest;

export interface ProgressMessage {
  v: number;
  type: 'progress';
  id: number;
  bytesProcessed: number;
  totalBytes: number;
  phase: 'parsing' | 'finalizing';
}

export interface DoneMessage {
  v: number;
  type: 'done';
  id: number;
  ir: ToolpathIR;
  stats: ParseStats;
  /** Dialect/machine metadata beside the IR (DD-005 §4.2); thumbnails transferred. */
  metadata?: DialectMetadata;
}

export interface ErrorMessage {
  v: number;
  type: 'error';
  id: number;
  error: { code: string; message: string; srcByte?: number };
}

export interface CancelledMessage {
  v: number;
  type: 'cancelled';
  id: number;
  partial?: { ir: ToolpathIR; stats: ParseStats };
}

/**
 * Progressive-preview snapshot (#60): a path-aligned DELTA of segments since the
 * previous partial, transferred zero-copy. `header.complete` is always false;
 * the terminal `done` IR REPLACES the accumulated preview wholesale.
 */
export interface PartialMessage {
  v: number;
  type: 'partial';
  id: number;
  slice: ToolpathIR;
  /** Total segments emitted across all partials so far (= end of this delta). */
  cumulativeSegments: number;
}

export type WorkerResponse = ProgressMessage | PartialMessage | DoneMessage | ErrorMessage | CancelledMessage;

/** Collect every ArrayBuffer backing an IR's typed arrays for zero-copy transfer. */
export function irTransferList(ir: ToolpathIR): ArrayBuffer[] {
  const s = ir.segments;
  const buffers = new Set<ArrayBuffer>();
  for (const view of [
    s.x0,
    s.y0,
    s.z0,
    s.x1,
    s.y1,
    s.z1,
    s.e,
    s.feedrate,
    s.kind,
    s.tool,
    s.layer,
    s.feature,
    s.object,
    s.srcByte,
    ir.sourceIndex.byteOffsets,
    ir.sourceIndex.segmentIndices
  ]) {
    buffers.add(view.buffer as ArrayBuffer);
  }
  return [...buffers];
}
