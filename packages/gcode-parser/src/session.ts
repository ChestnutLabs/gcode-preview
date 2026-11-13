/**
 * GcodeParseSession — the worker client (DD-003 §4.1/§4.4/§5, issue #45).
 *
 * Terminal contract (§4.3): `done` RESOLVES `parse()` (including limit-bounded
 * results — check `result.ir.header.complete` / `result.stats.stopReason`);
 * `error` REJECTS with ParseSessionError; `cancelled` REJECTS with
 * CancelledError (optional bounded partial attached when `partialOnCancel`).
 *
 * Cancellation (§5.2): cooperative via the worker's yield loop. If the worker
 * fails to acknowledge within TERMINATE_FALLBACK_MS the session terminates it —
 * strictly a last-resort backstop, asserted against in tests.
 */
import type { ParseResult } from './parse.js';
import type { ToolpathIR } from '@chestnutlabs/toolpath-core';
import { isReadableStreamLike } from './streaming.js';
import { PROTOCOL_VERSION, type ParseInputWire, type WireParseOptions, type WorkerResponse } from './protocol.js';

export interface WorkerLike {
  /** Transfer list may carry ArrayBuffers and (in browsers) transferable streams. */
  postMessage(msg: unknown, transfer?: unknown[]): void;
  terminate(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((err: unknown) => void) | null;
}

export interface SessionOptions {
  /**
   * Escape hatch (DD-003 §4.4 option c): supply a Worker instance or factory. An instance cannot be
   * rebuilt: after it is terminated (the cancel backstop, a crash, or `dispose()`), `parse()` rejects with
   * `E_WORKER_TERMINATED`; pass a factory to recover.
   */
  worker?: WorkerLike | (() => WorkerLike);
  /** Cancel-acknowledgement backstop before terminate() (default 2000 ms). */
  terminateFallbackMs?: number;
}

export interface ParseProgress {
  bytesProcessed: number;
  totalBytes: number;
  phase: 'parsing' | 'finalizing';
}

export class ParseSessionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly srcByte?: number,
    /** `cause`: the underlying error, when there is one (e.g. the throw from a worker factory). */
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'ParseSessionError';
  }
}

export class CancelledError extends ParseSessionError {
  constructor(
    message: string,
    public readonly partial?: ParseResult,
    /** True only when the terminate() backstop fired (cooperative path failed). */
    public readonly terminated = false
  ) {
    super('E_CANCELLED', message);
    this.name = 'CancelledError';
  }
}

/** Default worker path (DD-003 §4.4 option a): bundler-native module worker. */
function defaultWorkerFactory(): WorkerLike {
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

interface ActiveParse {
  id: number;
  resolve: (r: ParseResult) => void;
  reject: (e: Error) => void;
  cancelTimer?: ReturnType<typeof setTimeout>;
}

export class GcodeParseSession {
  private readonly factory: () => WorkerLike;
  private readonly terminateFallbackMs: number;
  private worker: WorkerLike | null = null;
  private active: ActiveParse | null = null;
  private nextId = 1;
  /** A caller-supplied Worker INSTANCE (not a factory) cannot be rebuilt once terminated. */
  private readonly instanceSupplied: boolean;
  private instanceSpent = false;
  private progressListeners = new Set<(p: ParseProgress) => void>();
  private partialListeners = new Set<(slice: ToolpathIR, cumulativeSegments: number) => void>();

  constructor(opts: SessionOptions = {}) {
    const supplied = opts.worker;
    this.instanceSupplied = supplied !== undefined && typeof supplied !== 'function';
    this.factory =
      supplied === undefined ? defaultWorkerFactory : typeof supplied === 'function' ? supplied : () => supplied;
    this.terminateFallbackMs = opts.terminateFallbackMs ?? 2000;
  }

  onProgress(cb: (p: ParseProgress) => void): () => void {
    this.progressListeners.add(cb);
    return () => this.progressListeners.delete(cb);
  }

  /**
   * Progressive-preview deltas (#60): path-aligned IR slices streamed while a
   * large parse runs (`partialPreview` wire option; on by default ≥ 25 MiB).
   * The resolved `done` IR REPLACES everything the partials showed.
   */
  onPartial(cb: (slice: ToolpathIR, cumulativeSegments: number) => void): () => void {
    this.partialListeners.add(cb);
    return () => this.partialListeners.delete(cb);
  }

  parse(input: ParseInputWire, opts: WireParseOptions = {}): Promise<ParseResult> {
    if (this.active !== null) {
      return Promise.reject(new ParseSessionError('E_BUSY', 'a parse is already in progress on this session'));
    }
    if (this.instanceSpent) {
      // The instance was terminated (cancel backstop, crash or dispose). Posting to it would never be
      // answered, leaving this parse pending forever; say so instead.
      return Promise.reject(
        new ParseSessionError(
          'E_WORKER_TERMINATED',
          'the worker instance supplied to this session was terminated; supply a worker factory to allow a new worker'
        )
      );
    }
    return new Promise<ParseResult>((resolve, reject) => {
      // Create the worker inside the promise: a factory that throws (e.g. a strict CSP blocks the worker
      // URL) must reject this parse, not throw out of parse() and skip the caller's error path (#566).
      // Nothing is set yet, so the session stays idle and the next parse calls the factory again.
      let worker: WorkerLike;
      try {
        worker = this.ensureWorker();
      } catch (err) {
        reject(
          new ParseSessionError(
            'E_WORKER_CREATE_FAILED',
            `could not start the parse worker: ${err instanceof Error ? err.message : String(err)}`,
            undefined,
            { cause: err }
          )
        );
        return;
      }
      const id = this.nextId++;
      const active: ActiveParse = { id, resolve, reject };
      this.active = active;
      try {
        // §4.2 wire strategy: Uint8Array transfers its buffer (zero-copy); a
        // ReadableStream is transferred; a Blob is a cheap cloneable handle.
        let transfer: unknown[] | undefined;
        if (input instanceof Uint8Array) transfer = [input.buffer];
        else if (isReadableStreamLike(input) && typeof input !== 'string') transfer = [input];
        worker.postMessage({ v: PROTOCOL_VERSION, type: 'parse', id, input, opts }, transfer);
      } catch (err) {
        // The worker never got this parse (e.g. DataCloneError: the bytes' buffer was already
        // transferred by an earlier parse, or a hostile `getReader` getter threw while the transfer
        // list was built). Settle it here, or `active` stays set and every later
        // parse() fails with E_BUSY (#453). The worker itself is untouched and stays usable.
        this.settle(
          active,
          undefined,
          new ParseSessionError(
            'E_POST_FAILED',
            `could not send the parse to the worker: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
    });
  }

  cancel(): void {
    const active = this.active;
    if (active === null || this.worker === null) return;
    // Idempotent: a second cancel() on the same in-flight parse (e.g. the controller cancels before a
    // re-parse) must not schedule a second backstop. Overwriting cancelTimer would orphan the first
    // timer, which then fires later and terminates whatever parse is running by then — wedging it.
    if (active.cancelTimer !== undefined) return;
    this.worker.postMessage({ v: PROTOCOL_VERSION, type: 'cancel', id: active.id });
    active.cancelTimer = setTimeout(() => {
      // Last-resort backstop (§5.2): the cooperative path failed to acknowledge.
      this.teardownWorker();
      this.settle(
        active,
        undefined,
        new CancelledError('cancelled (worker terminated after timeout)', undefined, true)
      );
    }, this.terminateFallbackMs);
  }

  dispose(): void {
    const active = this.active;
    if (active !== null) {
      this.settle(active, undefined, new ParseSessionError('E_DISPOSED', 'session disposed'));
    }
    this.teardownWorker();
    this.progressListeners.clear();
    this.partialListeners.clear();
  }

  private ensureWorker(): WorkerLike {
    if (this.worker === null) {
      const w = this.factory();
      w.onmessage = (ev) => this.onMessage(ev.data as WorkerResponse);
      w.onerror = (err) => {
        const active = this.active;
        this.teardownWorker();
        if (active !== null) {
          this.settle(
            active,
            undefined,
            new ParseSessionError(
              'E_WORKER_CRASHED',
              `worker crashed: ${err instanceof Error ? err.message : String(err)}`
            )
          );
        }
      };
      this.worker = w;
    }
    return this.worker;
  }

  private teardownWorker(): void {
    if (this.worker !== null) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
      if (this.instanceSupplied) this.instanceSpent = true;
    }
  }

  private settle(active: ActiveParse, result?: ParseResult, error?: Error): void {
    if (active.cancelTimer !== undefined) clearTimeout(active.cancelTimer);
    if (this.active === active) this.active = null;
    if (error !== undefined) active.reject(error);
    else if (result !== undefined) active.resolve(result);
  }

  private onMessage(msg: WorkerResponse): void {
    const active = this.active;
    if (active === null || msg.id !== active.id) {
      if (msg.type === 'progress') return; // stale progress after settle — ignore
      return;
    }
    switch (msg.type) {
      case 'progress':
        for (const cb of this.progressListeners) {
          cb({ bytesProcessed: msg.bytesProcessed, totalBytes: msg.totalBytes, phase: msg.phase });
        }
        return;
      case 'partial':
        for (const cb of this.partialListeners) {
          cb(msg.slice, msg.cumulativeSegments);
        }
        return;
      case 'done':
        this.settle(active, { ir: msg.ir, stats: msg.stats, metadata: msg.metadata });
        return;
      case 'cancelled':
        this.settle(
          active,
          undefined,
          new CancelledError(
            'parse cancelled',
            msg.partial ? { ir: msg.partial.ir, stats: msg.partial.stats } : undefined
          )
        );
        return;
      case 'error':
        this.settle(active, undefined, new ParseSessionError(msg.error.code, msg.error.message, msg.error.srcByte));
        return;
    }
  }
}
