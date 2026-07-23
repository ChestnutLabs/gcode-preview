/**
 * Worker protocol v1 (DD-003 §4.3).
 *
 * A parse ends in exactly one terminal message:
 * - `done` — complete AND limit-bounded parses (limit-bounded: `ir.header.complete === false`
 *   + `stats.stopReason`); the client RESOLVES `parse()` with the ParseResult.
 * - `error` — failures producing no usable IR; the client REJECTS.
 * - `cancelled` — client rejects with E_CANCELLED; `partial` attached when requested.
 */
import type { ToolpathIR } from '@chestnutlabs/toolpath-core';
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
