/**
 * Streaming inputs (DD-003 §4.2, phase 3, issue #46).
 *
 * Worker-side line-drain streaming: bytes → TextDecoder{stream:true} → a rolling
 * buffer bounded by `maxLineLength` → complete lines fed to the shared engine.
 * Yields happen naturally at every chunk `read()` plus the same §5.2 time-slice
 * yield between lines of a large chunk, so cancellation stays cooperative.
 *
 * Limits on unknown-size streams are enforced INCREMENTALLY: `maxInputBytes` is
 * checked as bytes arrive (a `Blob`'s known size is still checked upfront), and an
 * overlong line cannot grow the rolling buffer beyond `maxLineLength` — the
 * remainder of the line is discarded with a `line-too-long` warning, exactly like
 * the in-memory path, so hostile input cannot balloon memory.
 *
 * Byte offsets use the same single-byte (ASCII/UTF-8) accounting as the in-memory
 * drivers so stream and sync parses of the same file produce identical IR.
 */
import { createEngine, type AsyncParseHooks, type AsyncParseResult, type ParseOptions } from './parse.js';

/** Anything that can hand us chunks of bytes. */
export type StreamInput = BlobLike | ReadableStreamLike<Uint8Array>;

export interface BlobLike {
  readonly size: number;
  stream(): ReadableStreamLike<Uint8Array>;
}

export interface ReadableStreamLike<T> {
  getReader(): { read(): Promise<{ done: boolean; value?: T }>; releaseLock?(): void; cancel?(): Promise<void> };
}

export function isBlobLike(v: unknown): v is BlobLike {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as BlobLike).stream === 'function' &&
    typeof (v as BlobLike).size === 'number'
  );
}

export function isReadableStreamLike(v: unknown): v is ReadableStreamLike<Uint8Array> {
  return typeof v === 'object' && v !== null && typeof (v as ReadableStreamLike<Uint8Array>).getReader === 'function';
}

function yieldMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      ch.port2.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });
}

/**
 * Parse a byte stream into a ToolpathIR with the same semantics (and identical
 * output) as the in-memory drivers. Cooperative and cancellable throughout.
 */
export async function parseGcodeStreamToIR(
  input: StreamInput,
  opts: ParseOptions = {},
  hooks: AsyncParseHooks = {}
): Promise<AsyncParseResult> {
  const engine = createEngine('', opts);
  const limits = engine.limits;
  const yieldEvery = hooks.yieldIntervalMs ?? 50;

  const knownSize = isBlobLike(input) ? input.size : undefined;
  if (knownSize !== undefined && knownSize > limits.maxInputBytes) {
    engine.setSourceBytes(knownSize);
    engine.markInputTooBig();
    return { ...engine.finish(), cancelled: false };
  }

  const stream = isBlobLike(input) ? input.stream() : input;
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let lineStartOffset = 0;
  let bytesRead = 0;
  /** True while discarding the remainder of a line that exceeded maxLineLength. */
  let skippingOverlongLine = false;
  let overlongWarned = false;
  let cancelled = false;
  let sliceStart = Date.now();

  const drainCompleteLines = async (): Promise<void> => {
    for (;;) {
      const nl = buffer.indexOf('\n');
      if (nl === -1) return;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (skippingOverlongLine) {
        // The discarded prefix of this line already tripped the limit; count the
        // full line (prefix included) into offsets and resume normal processing.
        skippingOverlongLine = false;
        overlongWarned = false;
        lineStartOffset += line.length + 1;
        continue;
      }
      engine.processLine(line, lineStartOffset);
      lineStartOffset += line.length + 1;
      if (engine.stopped()) return;

      if (Date.now() - sliceStart >= yieldEvery) {
        hooks.onProgress?.(bytesRead, knownSize ?? 0, 0);
        await yieldMacrotask();
        if (hooks.shouldCancel?.()) {
          cancelled = true;
          return;
        }
        sliceStart = Date.now();
      }
    }
  };

  const boundBuffer = (): void => {
    if (buffer.length > limits.maxLineLength && buffer.indexOf('\n') === -1) {
      if (!overlongWarned) {
        // Route the warning through the engine by feeding an overlong marker line:
        // processLine's own maxLineLength branch records `line-too-long` (bounded).
        engine.processLine('x'.repeat(limits.maxLineLength + 1), lineStartOffset);
        overlongWarned = true;
      }
      // Discard the buffered prefix but keep offset accounting for the final line cut.
      lineStartOffset += buffer.length;
      buffer = '';
      skippingOverlongLine = true;
    }
  };

  try {
    for (;;) {
      if (engine.stopped() || cancelled) break;
      const { done, value } = await reader.read();
      if (hooks.shouldCancel?.()) {
        cancelled = true;
        break;
      }
      if (done) break;
      if (value === undefined || value.byteLength === 0) continue;

      bytesRead += value.byteLength;
      engine.setSourceBytes(bytesRead);
      if (bytesRead > limits.maxInputBytes) {
        engine.markInputTooBig();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      boundBuffer();
      await drainCompleteLines();
    }

    // Flush the decoder tail and any final unterminated line.
    if (!engine.stopped() && !cancelled) {
      buffer += decoder.decode();
      boundBuffer();
      await drainCompleteLines();
      if (!engine.stopped() && !cancelled && !skippingOverlongLine && buffer.length > 0) {
        engine.processLine(buffer, lineStartOffset);
        buffer = '';
      }
    }
  } finally {
    reader.releaseLock?.();
  }

  hooks.onProgress?.(bytesRead, knownSize ?? bytesRead, 0);
  engine.setSourceBytes(bytesRead);
  if (cancelled) {
    return { ...engine.finish(lineStartOffset), cancelled: true };
  }
  return { ...engine.finish(), cancelled: false };
}
