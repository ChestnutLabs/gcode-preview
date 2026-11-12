/**
 * Sweep of the streaming driver, GcodeParseSession and the worker handler (sweep slice 4).
 * Every expectation is a literal value; each block pins one clause or branch of
 * streaming.ts / session.ts / worker-core.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseGcodeToIR, parseGcodeStreamToIR } from '../index';
import { createWorkerHandler, type DialectRunnerFactoryLike, type OpenedContainerLike } from '../worker-core';
import { CancelledError, GcodeParseSession, ParseSessionError, type WorkerLike } from '../session';
import { PROTOCOL_VERSION, type WorkerRequest, type WorkerResponse } from '../protocol';

const enc = new TextEncoder();

function streamOfChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) controller.close();
      else controller.enqueue(chunks[i++]);
    }
  });
}

function chunked(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for (let o = 0; o < bytes.length; o += size) chunks.push(bytes.subarray(o, Math.min(o + size, bytes.length)));
  return streamOfChunks(chunks);
}

interface SpyReader {
  reads: number;
  cancels: number;
  releases: number;
}

/** A hand-rolled stream (not a ReadableStream) that records cancel()/releaseLock(). */
function spyStream(chunks: Uint8Array[], failAt?: number): { stream: never; spy: SpyReader } {
  const spy: SpyReader = { reads: 0, cancels: 0, releases: 0 };
  let i = 0;
  const stream = {
    getReader: () => ({
      read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
        spy.reads++;
        if (failAt !== undefined && spy.reads === failAt) return Promise.reject(new Error('source broke'));
        if (i >= chunks.length) return Promise.resolve({ done: true });
        return Promise.resolve({ done: false, value: chunks[i++] });
      },
      releaseLock: () => {
        spy.releases++;
      },
      cancel: () => {
        spy.cancels++;
        return Promise.resolve();
      }
    })
  };
  return { stream: stream as never, spy };
}

function srcBytes(ir: { segments: { count: number; srcByte: Uint32Array } }): number[] {
  return Array.from(ir.segments.srcByte.subarray(0, ir.segments.count));
}

describe('streaming driver — line assembly and offsets', () => {
  it('CRLF + multi-byte comments give the sync IR at every chunk size (1, 2, 3, 7 B)', async () => {
    const text = '; café ☃ start\r\nG0 X0 Y0 Z0.2\r\nG1 X1 Y1 E1 ; ünï\r\nG1 X2 Y2 E2\r\n; end ✓\r\nG1 X3 Y3 E3\r\n';
    const bytes = enc.encode(text);
    const sync = parseGcodeToIR(bytes);
    expect(sync.ir.segments.count).toBe(4);
    for (const size of [1, 2, 3, 7]) {
      const r = await parseGcodeStreamToIR(chunked(bytes, size));
      expect(r.ir.segments.count).toBe(4);
      expect(srcBytes(r.ir)).toEqual(srcBytes(sync.ir));
      expect(r.stats.bytes).toBe(bytes.byteLength);
    }
  });

  it('an unterminated final line is parsed; the stream and sync agree', async () => {
    const bytes = enc.encode('G0 X0 Y0 Z0.2\nG1 X5 Y5 E1\nG1 X9 Y9 E2');
    const r = await parseGcodeStreamToIR(chunked(bytes, 5));
    expect(r.ir.segments.count).toBe(3);
    expect(Array.from(r.ir.segments.x1.subarray(0, 3))).toEqual([0, 5, 9]);
  });

  it('an empty stream, empty chunks and `undefined` values are skipped without error', async () => {
    const empty = await parseGcodeStreamToIR(streamOfChunks([]));
    expect(empty.ir.header.complete).toBe(true);
    expect(empty.ir.segments.count).toBe(0);
    const { stream } = spyStream([new Uint8Array(0), enc.encode('G0 X1 Y1 Z1\nG1 X2 Y2 E1\n')]);
    const mixed = await parseGcodeStreamToIR(stream);
    expect(mixed.ir.segments.count).toBe(2);
    expect(mixed.stats.bytes).toBe(24);
  });

  it('an overlong line spanning many chunks warns once, is skipped, and later lines keep exact offsets', async () => {
    const text = 'G0 X0 Y0 Z0.2\n' + 'a'.repeat(3000) + '\nG1 X5 Y5 E1\nG1 X6 Y6 E2\n';
    const bytes = enc.encode(text);
    const limits = { maxLineLength: 1024 };
    const sync = parseGcodeToIR(bytes, { limits });
    for (const size of [100, 1000, 4000]) {
      const r = await parseGcodeStreamToIR(chunked(bytes, size), { limits });
      expect(r.ir.segments.count).toBe(3);
      expect(srcBytes(r.ir)).toEqual(srcBytes(sync.ir));
      expect(srcBytes(r.ir)).toEqual([0, 3015, 3027]);
      const w = r.ir.header.warnings.find((x) => x.code === 'line-too-long');
      expect(w?.count).toBe(1);
    }
  });

  it('a second overlong line is warned about again (count 2)', async () => {
    const long = 'b'.repeat(2000);
    const bytes = enc.encode(`G0 X0 Y0 Z0\n${long}\nG1 X1 E1\n${long}\nG1 X2 E2\n`);
    const r = await parseGcodeStreamToIR(chunked(bytes, 300), { limits: { maxLineLength: 1024 } });
    expect(r.ir.segments.count).toBe(3);
    expect(r.ir.header.warnings.find((x) => x.code === 'line-too-long')?.count).toBe(2);
  });

  it('an overlong line that arrives whole inside one chunk is handled like the sync driver', async () => {
    const bytes = enc.encode(`G0 X0 Y0 Z0\n${'c'.repeat(1500)}\nG1 X1 E1\n`);
    const limits = { maxLineLength: 1024 };
    const sync = parseGcodeToIR(bytes, { limits });
    const r = await parseGcodeStreamToIR(chunked(bytes, 1 << 20), { limits });
    expect(srcBytes(r.ir)).toEqual(srcBytes(sync.ir));
    expect(r.ir.header.warnings.find((x) => x.code === 'line-too-long')?.count).toBe(1);
  });

  it('an unterminated overlong final line is dropped, not processed', async () => {
    // The tail of the discarded line is itself a valid move; it must not run as a line of its own.
    const bytes = enc.encode(`G0 X0 Y0 Z0\nG1 X1 E1\n${'d'.repeat(2000)} G1 X9 E9`);
    const r = await parseGcodeStreamToIR(chunked(bytes, 500), { limits: { maxLineLength: 1024 } });
    expect(r.ir.segments.count).toBe(2);
    expect(r.ir.header.warnings.find((x) => x.code === 'line-too-long')?.count).toBe(1);
  });

  it('a final line exactly maxLineLength long is NOT overlong', async () => {
    const line = 'G1 X7 E1 ;' + 'e'.repeat(1024 - 10);
    expect(line.length).toBe(1024);
    const bytes = enc.encode(`G0 X0 Y0 Z0\n${line}`);
    const r = await parseGcodeStreamToIR(chunked(bytes, 64), { limits: { maxLineLength: 1024 } });
    expect(r.ir.segments.count).toBe(2);
    expect(r.ir.header.warnings.some((x) => x.code === 'line-too-long')).toBe(false);
  });
});

describe('streaming driver — limits, cancel, hooks', () => {
  it('maxInputBytes: a stream of exactly the limit parses; one byte more trips E_LIMIT_INPUT_BYTES', async () => {
    const bytes = enc.encode('G0 X0 Y0 Z0\nG1 X1 E1\nG1 X2 E2\n');
    expect(bytes.byteLength).toBe(30);
    const ok = await parseGcodeStreamToIR(chunked(bytes, 8), { limits: { maxInputBytes: 30 } });
    expect(ok.ir.header.complete).toBe(true);
    expect(ok.ir.segments.count).toBe(3);
    const over = await parseGcodeStreamToIR(chunked(bytes, 8), { limits: { maxInputBytes: 29 } });
    expect(over.ir.header.complete).toBe(false);
    expect(over.stats.stopReason?.code).toBe('E_LIMIT_INPUT_BYTES');
    expect(over.stats.bytes).toBe(30);
  });

  it('maxInputBytes on a Blob: size == limit parses, size == limit + 1 is refused upfront with the size recorded', async () => {
    const bytes = enc.encode('G0 X0 Y0 Z0\nG1 X1 E1\n');
    const ok = await parseGcodeStreamToIR(new Blob([bytes]), { limits: { maxInputBytes: 21 } });
    expect(ok.ir.segments.count).toBe(2);
    const over = await parseGcodeStreamToIR(new Blob([bytes]), { limits: { maxInputBytes: 20 } });
    expect(over.stats.stopReason?.code).toBe('E_LIMIT_INPUT_BYTES');
    expect(over.stats.bytes).toBe(21);
    expect(over.ir.segments.count).toBe(0);
  });

  it('stopping on a segment limit cancels the source and releases the lock', async () => {
    const lines = ['G0 X0 Y0 Z0'];
    for (let i = 1; i <= 50; i++) lines.push(`G1 X${i} E${i}`);
    const { stream, spy } = spyStream([enc.encode(lines.join('\n') + '\n'), enc.encode('G1 X99 E99\n')]);
    const r = await parseGcodeStreamToIR(stream, { limits: { maxSegments: 10 } });
    expect(r.stats.stopReason?.code).toBe('E_LIMIT_SEGMENTS');
    expect(r.ir.segments.count).toBe(10);
    expect(spy.reads).toBe(1);
    expect(spy.cancels).toBe(1);
    expect(spy.releases).toBe(1);
  });

  it('tripping maxInputBytes mid-stream cancels the source', async () => {
    const { stream, spy } = spyStream([
      enc.encode('G0 X0 Y0 Z0\n'),
      enc.encode('G1 X1 E1\n'),
      enc.encode('G1 X2 E2\n')
    ]);
    const r = await parseGcodeStreamToIR(stream, { limits: { maxInputBytes: 15 } });
    expect(r.stats.stopReason?.code).toBe('E_LIMIT_INPUT_BYTES');
    expect(spy.reads).toBe(2);
    expect(spy.cancels).toBe(1);
    expect(spy.releases).toBe(1);
  });

  it('cancelling cancels the source; a normal end does not', async () => {
    const a = spyStream([enc.encode('G0 X0 Y0 Z0\n'), enc.encode('G1 X1 E1\n')]);
    const cancelled = await parseGcodeStreamToIR(a.stream, {}, { shouldCancel: () => true });
    expect(cancelled.cancelled).toBe(true);
    expect(a.spy.cancels).toBe(1);
    expect(a.spy.releases).toBe(1);
    const b = spyStream([enc.encode('G0 X0 Y0 Z0\n'), enc.encode('G1 X1 E1\n')]);
    const done = await parseGcodeStreamToIR(b.stream);
    expect(done.cancelled).toBe(false);
    expect(done.ir.segments.count).toBe(2);
    expect(b.spy.cancels).toBe(0);
    expect(b.spy.releases).toBe(1);
  });

  it('a source that fails mid-read rejects and still releases the lock', async () => {
    const { stream, spy } = spyStream([enc.encode('G0 X0 Y0 Z0\n'), enc.encode('G1 X1 E1\n')], 2);
    await expect(parseGcodeStreamToIR(stream)).rejects.toThrow('source broke');
    expect(spy.releases).toBe(1);
  });

  it('a cancel seen right after the first read reports a cancelled, honestly incomplete result at offset 0', async () => {
    const r = await parseGcodeStreamToIR(
      streamOfChunks([enc.encode('G0 X0 Y0 Z0\nG1 X1 E1\n')]),
      {},
      { shouldCancel: () => true }
    );
    expect(r.cancelled).toBe(true);
    expect(r.ir.header.complete).toBe(false);
    expect(r.ir.header.truncatedAtByte).toBe(0);
    expect(r.ir.segments.count).toBe(0);
  });

  it('with yieldIntervalMs 0 the driver yields after its first line and honours a cancel there', async () => {
    let calls = 0;
    const r = await parseGcodeStreamToIR(
      streamOfChunks([enc.encode('G0 X0 Y0 Z0\nG1 X1 E1\nG1 X2 E2\n')]),
      {},
      { yieldIntervalMs: 0, shouldCancel: () => ++calls > 1 }
    );
    expect(r.cancelled).toBe(true);
    expect(r.ir.segments.count).toBe(1);
    expect(r.ir.header.truncatedAtByte).toBe(12);
  });

  it('the default time slice is 50 ms: a long single chunk yields, and a cancel seen there stops it', async () => {
    const line = 'G1 X10.000 Y10.000 E0.01000 F1200\n';
    const bytes = enc.encode(line.repeat(400000));
    let calls = 0;
    const r = await parseGcodeStreamToIR(streamOfChunks([bytes]), {}, { shouldCancel: () => ++calls > 1 });
    expect(r.cancelled).toBe(true);
    expect(r.ir.segments.count).toBeLessThan(400000);
  }, 60_000);

  it('a stopped engine does not keep counting lines from the rest of the chunk', async () => {
    const lines = ['G0 X0 Y0 Z0'];
    for (let i = 1; i <= 50; i++) lines.push(`G1 X${i} E${i}`);
    const r = await parseGcodeStreamToIR(streamOfChunks([enc.encode(lines.join('\n') + '\n')]), {
      limits: { maxSegments: 10 }
    });
    expect(r.ir.segments.count).toBe(10);
    expect(r.stats.lines).toBe(11); // G0 + ten segments; the line that hit the cap is the last one processed
  });

  it('captureWindows keeps exactly the first 64 KiB and the last 16 KiB', async () => {
    const body = 'x'.repeat(100 * 1024);
    const text = `;HEAD\n${body}\n;TAIL\n`;
    const windows = { head: '', tail: '' };
    await parseGcodeStreamToIR(
      chunked(enc.encode(text), 10000),
      { limits: { maxLineLength: 1 << 20 } },
      { captureWindows: windows }
    );
    expect(windows.head.length).toBe(65536);
    expect(windows.head.startsWith(';HEAD\nxxx')).toBe(true);
    expect(windows.tail.length).toBe(16384);
    expect(windows.tail.endsWith('x\n;TAIL\n')).toBe(true);
  });

  it('progress: the final report is (bytesRead, size) — for a stream the size is what was read', async () => {
    const bytes = enc.encode('G0 X0 Y0 Z0\nG1 X1 E1\n');
    const calls: number[][] = [];
    await parseGcodeStreamToIR(chunked(bytes, 4), {}, { onProgress: (a, b, c) => calls.push([a, b, c]) });
    expect(calls[calls.length - 1]).toEqual([21, 21, 0]);
    const blobCalls: number[][] = [];
    await parseGcodeStreamToIR(new Blob([bytes]), {}, { onProgress: (a, b, c) => blobCalls.push([a, b, c]) });
    expect(blobCalls[blobCalls.length - 1]).toEqual([21, 21, 0]);
  });

  it('periodic progress inside a long chunk reports the Blob total, not 0', async () => {
    const lines = ['G0 X0 Y0 Z0'];
    for (let i = 1; i <= 60000; i++) lines.push(`G1 X${i % 90} Y${i % 70} E${i}`);
    const blob = new Blob([enc.encode(lines.join('\n'))]);
    const seen: number[][] = [];
    await parseGcodeStreamToIR(blob, {}, { yieldIntervalMs: 0, onProgress: (a, b) => seen.push([a, b]) });
    expect(seen.length).toBeGreaterThan(2);
    for (const [, total] of seen) expect(total).toBe(blob.size);
  });

  it('streamed O-word programs run linearly and say so once', async () => {
    const text = 'G0 X0 Y0 Z0\nO100 while [#1 LT 3]\nG1 X1 E1\nO100 endwhile\nO200 while [#1 LT 3]\nO200 endwhile\n';
    const r = await parseGcodeStreamToIR(chunked(enc.encode(text), 9));
    const w = r.ir.header.warnings.filter((x) => x.message.includes('O-word control flow'));
    expect(w).toHaveLength(1);
    expect(w[0].count).toBe(1);
    expect(r.ir.segments.count).toBe(2);
  });
});

// ───────────────────────── session ─────────────────────────

interface RigWorker extends WorkerLike {
  posted: { msg: Record<string, unknown>; transfer?: unknown[] }[];
  terminated: number;
  reply(msg: Record<string, unknown>): void;
}

function rigWorker(): RigWorker {
  const w: RigWorker = {
    posted: [],
    terminated: 0,
    onmessage: null,
    onerror: null,
    postMessage(msg: unknown, transfer?: unknown[]) {
      w.posted.push({ msg: msg as Record<string, unknown>, transfer });
    },
    terminate() {
      w.terminated++;
    },
    reply(msg) {
      w.onmessage?.({ data: { v: PROTOCOL_VERSION, ...msg } });
    }
  };
  return w;
}

const DONE_IR = { header: { complete: true, warnings: [] } } as never;

describe('GcodeParseSession', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('forwards progress and partial messages, and an unsubscribe stops delivery', async () => {
    const w = rigWorker();
    const s = new GcodeParseSession({ worker: w });
    const progress: unknown[] = [];
    const partials: unknown[] = [];
    const offP = s.onProgress((p) => progress.push(p));
    const offQ = s.onPartial((slice, n) => partials.push([slice, n]));
    const p = s.parse('G0 X0');
    w.reply({ type: 'progress', id: 1, bytesProcessed: 5, totalBytes: 9, phase: 'parsing' });
    w.reply({ type: 'partial', id: 1, slice: 'S', cumulativeSegments: 7 });
    expect(progress).toEqual([{ bytesProcessed: 5, totalBytes: 9, phase: 'parsing' }]);
    expect(partials).toEqual([['S', 7]]);
    offP();
    offQ();
    w.reply({ type: 'progress', id: 1, bytesProcessed: 6, totalBytes: 9, phase: 'parsing' });
    w.reply({ type: 'partial', id: 1, slice: 'T', cumulativeSegments: 8 });
    expect(progress).toHaveLength(1);
    expect(partials).toHaveLength(1);
    w.reply({ type: 'done', id: 1, ir: DONE_IR, stats: { bytes: 1 }, metadata: { raw: {} } });
    await expect(p).resolves.toEqual({ ir: DONE_IR, stats: { bytes: 1 }, metadata: { raw: {} } });
  });

  it('ignores messages for another id (stale), settling nothing', async () => {
    const w = rigWorker();
    const s = new GcodeParseSession({ worker: w });
    const progress: unknown[] = [];
    s.onProgress((p) => progress.push(p));
    let settled = false;
    const p = s.parse('G0 X0').finally(() => {
      settled = true;
    });
    w.reply({ type: 'progress', id: 99, bytesProcessed: 1, totalBytes: 1, phase: 'parsing' });
    w.reply({ type: 'done', id: 99, ir: DONE_IR, stats: {} });
    w.reply({ type: 'error', id: 99, error: { code: 'E_X', message: 'x' } });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(progress).toHaveLength(0);
    w.reply({ type: 'done', id: 1, ir: DONE_IR, stats: {} });
    await p;
    // After settle, a late message is ignored too.
    w.reply({ type: 'done', id: 1, ir: DONE_IR, stats: {} });
    s.dispose();
  });

  it('an error message rejects with the wire code, message and srcByte', async () => {
    const w = rigWorker();
    const s = new GcodeParseSession({ worker: w });
    const p = s.parse('x');
    w.reply({ type: 'error', id: 1, error: { code: 'E_CONTAINER_CRC', message: 'bad crc', srcByte: 77 } });
    const err = (await p.catch((e: unknown) => e)) as ParseSessionError;
    expect(err).toBeInstanceOf(ParseSessionError);
    expect(err.name).toBe('ParseSessionError');
    expect([err.code, err.message, err.srcByte]).toEqual(['E_CONTAINER_CRC', 'bad crc', 77]);
  });

  it('a cancelled message rejects with CancelledError; the partial is attached only when sent', async () => {
    const w = rigWorker();
    const s = new GcodeParseSession({ worker: w });
    const p1 = s.parse('x');
    w.reply({ type: 'cancelled', id: 1 });
    const e1 = (await p1.catch((e: unknown) => e)) as CancelledError;
    expect(e1).toBeInstanceOf(CancelledError);
    expect(e1.name).toBe('CancelledError');
    expect(e1.code).toBe('E_CANCELLED');
    expect(e1.message).toBe('parse cancelled');
    expect(e1.partial).toBeUndefined();
    expect(e1.terminated).toBe(false);
    const p2 = s.parse('x');
    w.reply({ type: 'cancelled', id: 2, partial: { ir: 'I', stats: 'S' } });
    const e2 = (await p2.catch((e: unknown) => e)) as CancelledError;
    expect(e2.partial).toEqual({ ir: 'I', stats: 'S' });
  });

  it('the terminate backstop fires at 2000 ms by default, not before', async () => {
    vi.useFakeTimers();
    const w = rigWorker();
    const s = new GcodeParseSession({ worker: w });
    const p = s.parse('x');
    const caught = p.catch((e: unknown) => e);
    s.cancel();
    expect(w.posted[1].msg).toEqual({ v: PROTOCOL_VERSION, type: 'cancel', id: 1 });
    await vi.advanceTimersByTimeAsync(1999);
    expect(w.terminated).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.terminated).toBe(1);
    const err = (await caught) as CancelledError;
    expect(err.terminated).toBe(true);
    expect(err.message).toBe('cancelled (worker terminated after timeout)');
  });

  it('a cooperative cancel acknowledgement clears the backstop timer', async () => {
    vi.useFakeTimers();
    const w = rigWorker();
    const s = new GcodeParseSession({ worker: w, terminateFallbackMs: 50 });
    const p = s.parse('x');
    const caught = p.catch((e: unknown) => e);
    s.cancel();
    w.reply({ type: 'cancelled', id: 1 });
    await caught;
    await vi.advanceTimersByTimeAsync(500);
    expect(w.terminated).toBe(0);
  });

  it('transfer list: a Uint8Array transfers its buffer, a stream transfers itself, strings and Blobs transfer nothing', () => {
    const w = rigWorker();
    const s = new GcodeParseSession({ worker: w });
    const bytes = new Uint8Array([71, 48]);
    void s.parse(bytes).catch(() => undefined);
    expect(w.posted[0].transfer).toEqual([bytes.buffer]);
    s.dispose();
    const w2 = rigWorker();
    const s2 = new GcodeParseSession({ worker: w2 });
    const stream = new ReadableStream<Uint8Array>();
    void s2.parse(stream).catch(() => undefined);
    expect(w2.posted[0].transfer).toEqual([stream]);
    s2.dispose();
    const w3 = rigWorker();
    const s3 = new GcodeParseSession({ worker: w3 });
    void s3.parse('G0').catch(() => undefined);
    expect(w3.posted[0].transfer).toBeUndefined();
    s3.dispose();
    const w4 = rigWorker();
    const s4 = new GcodeParseSession({ worker: w4 });
    void s4.parse(new Blob(['G0'])).catch(() => undefined);
    expect(w4.posted[0].transfer).toBeUndefined();
    s4.dispose();
  });

  it('the message carries the protocol version, an increasing id, input and opts', () => {
    const w = rigWorker();
    const s = new GcodeParseSession({ worker: w });
    void s.parse('G0', { plate: 2 }).catch(() => undefined);
    expect(w.posted[0].msg).toEqual({ v: PROTOCOL_VERSION, type: 'parse', id: 1, input: 'G0', opts: { plate: 2 } });
    w.reply({ type: 'done', id: 1, ir: DONE_IR, stats: {} });
    void s.parse('G1').catch(() => undefined);
    expect(w.posted[1].msg.id).toBe(2);
    s.dispose();
  });

  it('a worker crash with no active parse still tears the worker down; the next parse builds a fresh one', async () => {
    const made: RigWorker[] = [];
    const s = new GcodeParseSession({
      worker: () => {
        const w = rigWorker();
        made.push(w);
        return w;
      }
    });
    const first = s.parse('x');
    made[0].reply({ type: 'done', id: 1, ir: DONE_IR, stats: {} });
    await first;
    made[0].onerror?.(new Error('late crash'));
    expect(made[0].terminated).toBe(1);
    expect(made[0].onmessage).toBeNull();
    const second = s.parse('y');
    expect(made).toHaveLength(2);
    made[1].reply({ type: 'done', id: 1 + 1, ir: DONE_IR, stats: {} });
    await second;
  });

  it('crash message carries the error text; non-Error values are stringified', async () => {
    const w = rigWorker();
    const s = new GcodeParseSession({ worker: w });
    const p = s.parse('x');
    w.onerror?.({ toString: () => 'plain-object' });
    const err = (await p.catch((e: unknown) => e)) as ParseSessionError;
    expect(err.code).toBe('E_WORKER_CRASHED');
    expect(err.message).toBe('worker crashed: plain-object');
  });

  it('dispose with nothing active terminates the worker once and drops listeners; the session can parse again on a factory', async () => {
    const made: RigWorker[] = [];
    const s = new GcodeParseSession({
      worker: () => {
        const w = rigWorker();
        made.push(w);
        return w;
      }
    });
    const progress: unknown[] = [];
    s.onProgress((p) => progress.push(p));
    s.onPartial((slice) => progress.push(slice));
    const p1 = s.parse('x');
    made[0].reply({ type: 'done', id: 1, ir: DONE_IR, stats: {} });
    await p1;
    s.dispose();
    expect(made[0].terminated).toBe(1);
    expect(made[0].onmessage).toBeNull();
    expect(made[0].onerror).toBeNull();
    const p2 = s.parse('y');
    made[1].reply({ type: 'progress', id: 2, bytesProcessed: 1, totalBytes: 1, phase: 'parsing' });
    made[1].reply({ type: 'partial', id: 2, slice: 'S', cumulativeSegments: 1 });
    made[1].reply({ type: 'done', id: 2, ir: DONE_IR, stats: {} });
    await p2;
    expect(progress).toHaveLength(0);
  });

  it('dispose rejects the active parse and clears its cancel timer', async () => {
    vi.useFakeTimers();
    const w = rigWorker();
    const s = new GcodeParseSession({ worker: w, terminateFallbackMs: 10 });
    const p = s.parse('x');
    const caught = p.catch((e: unknown) => e);
    s.cancel();
    s.dispose();
    const err = (await caught) as ParseSessionError;
    expect(err.code).toBe('E_DISPOSED');
    expect(err.message).toBe('session disposed');
    await vi.advanceTimersByTimeAsync(100);
    expect(w.terminated).toBe(1);
  });

  it('a supplied worker INSTANCE that was terminated is not reused: parse rejects instead of hanging', async () => {
    vi.useFakeTimers();
    const w = rigWorker();
    const s = new GcodeParseSession({ worker: w, terminateFallbackMs: 10 });
    const p = s.parse('x');
    const caught = p.catch((e: unknown) => e);
    s.cancel();
    await vi.advanceTimersByTimeAsync(10);
    expect(((await caught) as CancelledError).terminated).toBe(true);
    expect(w.terminated).toBe(1);
    const again = (await s.parse('y').catch((e: unknown) => e)) as ParseSessionError;
    expect(again).toBeInstanceOf(ParseSessionError);
    expect(again.code).toBe('E_WORKER_TERMINATED');
    expect(w.posted).toHaveLength(2); // parse + cancel only; nothing posted to the dead worker
    // the session stays usable for what it can still do
    expect(() => s.cancel()).not.toThrow();
    s.dispose();
  });
});

// ───────────────────────── worker handler ─────────────────────────

type Reply = WorkerResponse & { error?: { code: string; message: string } };

function harness(opts?: Parameters<typeof createWorkerHandler>[1]) {
  const replies: Reply[] = [];
  const waiters: (() => void)[] = [];
  const handler = createWorkerHandler((m, transfer) => {
    replies.push(Object.assign(m, { __transfer: transfer }) as Reply);
    for (const w of waiters.splice(0)) w();
  }, opts);
  const settled = (id: number): Promise<Reply> =>
    new Promise((resolve) => {
      const check = (): void => {
        const hit = replies.find((r) => r.id === id && ['done', 'error', 'cancelled'].includes(r.type));
        // One macrotask later the handler's `.finally` has freed the busy slot, like the real worker boundary.
        if (hit !== undefined) setTimeout(() => resolve(hit), 0);
        else waiters.push(check);
      };
      check();
    });
  const parse = (id: number, input: unknown, o?: Record<string, unknown>): void =>
    handler({ v: PROTOCOL_VERSION, type: 'parse', id, input, opts: o } as unknown as WorkerRequest);
  return { replies, handler, settled, parse };
}

describe('worker handler — protocol edges', () => {
  it('a non-object or null message gets E_PROTOCOL with id -1; a wrong version echoes the id', () => {
    const h = harness();
    h.handler(null as never);
    h.handler('nope' as never);
    h.handler({ v: 2, type: 'parse', id: 41 } as never);
    expect(h.replies.map((r) => [r.type, r.id, r.error?.code])).toEqual([
      ['error', -1, 'E_PROTOCOL'],
      ['error', -1, 'E_PROTOCOL'],
      ['error', 41, 'E_PROTOCOL']
    ]);
    expect(h.replies[2].error?.message).toBe(`unsupported message or protocol version (expected v${PROTOCOL_VERSION})`);
  });

  // With yieldIntervalMs 0 the async driver yields after its FIRST line, so a cancel posted in the same tick is
  // observed deterministically: a cancelled parse holds exactly one segment, an uncancelled one holds them all.
  const manyLines = (n: number): string => {
    const lines = ['G0 X0 Y0 Z0'];
    for (let i = 1; i <= n; i++) lines.push(`G1 X${i % 90} Y${i % 70} E${i}`);
    return lines.join('\n');
  };

  it('a cancel for the active id stops the parse after one line; yieldIntervalMs is forwarded', async () => {
    const h = harness();
    h.parse(1, manyLines(5000), { yieldIntervalMs: 0, partialOnCancel: true });
    h.handler({ v: PROTOCOL_VERSION, type: 'cancel', id: 1 });
    const r = (await h.settled(1)) as Reply & { partial?: { ir: { segments: { count: number } } } };
    expect(r.type).toBe('cancelled');
    expect(r.partial?.ir.segments.count).toBe(1);
  });

  it('a cancel for a different id is ignored; the active parse completes', async () => {
    const h = harness();
    h.parse(1, manyLines(5000), { yieldIntervalMs: 0 });
    h.handler({ v: PROTOCOL_VERSION, type: 'cancel', id: 2 });
    const r = await h.settled(1);
    expect(r.type).toBe('done');
    expect((r as Reply & { ir: { segments: { count: number } } }).ir.segments.count).toBe(5001);
  });

  it('a cancel does not leak into the next parse (flag is reset)', async () => {
    const h = harness();
    h.parse(1, manyLines(5000), { yieldIntervalMs: 0 });
    h.handler({ v: PROTOCOL_VERSION, type: 'cancel', id: 1 });
    expect((await h.settled(1)).type).toBe('cancelled');
    h.parse(2, manyLines(5000), { yieldIntervalMs: 0 });
    const r = await h.settled(2);
    expect(r.type).toBe('done');
    expect((r as Reply & { ir: { segments: { count: number } } }).ir.segments.count).toBe(5001);
  });

  it('a cancel arriving when nothing is active does not poison the next parse', async () => {
    const h = harness();
    h.handler({ v: PROTOCOL_VERSION, type: 'cancel', id: 1 });
    h.parse(1, manyLines(5000), { yieldIntervalMs: 0 });
    expect((await h.settled(1)).type).toBe('done');
  });

  it('progress is throttled to one message per 100 ms and carries id, bytes and phase', async () => {
    const h = harness();
    const t0 = Date.now();
    h.parse(1, manyLines(150000), { yieldIntervalMs: 0, partialPreview: false });
    await h.settled(1);
    const elapsed = Date.now() - t0;
    const progress = h.replies.filter((r) => r.type === 'progress') as (Reply & {
      bytesProcessed: number;
      totalBytes: number;
      phase: string;
    })[];
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.length).toBeLessThanOrEqual(Math.floor(elapsed / 100) + 1);
    expect(progress[0].id).toBe(1);
    expect(progress[0].phase).toBe('parsing');
    expect(progress[0].bytesProcessed).toBeGreaterThan(0);
    expect(progress[0].totalBytes).toBe(manyLines(150000).length);
  }, 60_000);

  it('cancelled replies carry the bounded partial only when partialOnCancel is set, and transfer its buffers', async () => {
    const lines = ['G0 X0 Y0 Z0'];
    for (let i = 1; i <= 100000; i++) lines.push(`G1 X${i % 90} Y${i % 70} E${i}`);
    const text = lines.join('\n');
    for (const partialOnCancel of [false, true]) {
      const h = harness();
      h.parse(1, text, { yieldIntervalMs: 1, partialOnCancel });
      await new Promise((r) => setTimeout(r, 5));
      h.handler({ v: PROTOCOL_VERSION, type: 'cancel', id: 1 });
      const r = (await h.settled(1)) as Reply & {
        partial?: { ir: { segments: { count: number } } };
        __transfer?: unknown[];
      };
      expect(r.type).toBe('cancelled');
      if (partialOnCancel) {
        expect(r.partial?.ir.segments.count).toBeGreaterThan(0);
        expect((r.__transfer ?? []).length).toBeGreaterThan(0);
      } else {
        expect(r.partial).toBeUndefined();
        expect(r.__transfer).toBeUndefined();
      }
    }
  });

  it('invalid limits fail with the typed code before any work, and the handler stays usable', async () => {
    const h = harness();
    h.parse(1, 'G0 X0', { limits: { maxInputBytes: 2 ** 32 } });
    const bad = await h.settled(1);
    expect(bad.type).toBe('error');
    expect(bad.error?.code).toBe('E_PARSE_OPTION');
    h.parse(2, 'G0 X0 Y0 Z0\nG1 X1 E1\n');
    expect((await h.settled(2)).type).toBe('done');
  });

  it('partialPreview:false sends no partials even for a tiny threshold; an explicit threshold sends them', async () => {
    const lines = ['G0 X0 Y0 Z0'];
    for (let i = 1; i <= 80000; i++) lines.push(`G1 X${i % 90} Y${i % 70} E${i}`);
    const text = lines.join('\n');
    const off = harness();
    off.parse(1, text, { yieldIntervalMs: 0, partialPreview: false });
    await off.settled(1);
    expect(off.replies.filter((r) => r.type === 'partial')).toHaveLength(0);
    const on = harness();
    on.parse(1, text, { yieldIntervalMs: 0, partialPreview: { minInputBytes: 1, intervalMs: 0 } });
    await on.settled(1);
    const partials = on.replies.filter((r) => r.type === 'partial') as (Reply & { cumulativeSegments: number })[];
    expect(partials.length).toBeGreaterThan(0);
    expect(partials[partials.length - 1].cumulativeSegments).toBeLessThanOrEqual(80001);
    expect(partials[0].id).toBe(1);
  });

  it('thrown errors keep a string `code`, otherwise become E_INTERNAL with the message stringified', async () => {
    const mk = (thrown: unknown): ReturnType<typeof harness> =>
      harness({
        containers: [
          {
            id: 'x',
            sniff: () => true,
            open: () =>
              Promise.resolve({
                id: 'x',
                plates: [{ index: 0, name: 'p', estimatedBytes: 1 }],
                metadata: { raw: {}, warnings: [] },
                openPlate: () => ({
                  getReader: () => ({ read: () => Promise.reject(thrown) })
                })
              } as unknown as OpenedContainerLike)
          }
        ]
      });
    const withCode = mk(Object.assign(new Error('crc'), { code: 'E_CONTAINER_CRC' }));
    withCode.parse(1, new Uint8Array([1, 2, 3, 4]));
    expect((await withCode.settled(1)).error).toEqual({ code: 'E_CONTAINER_CRC', message: 'crc' });
    const numericCode = mk(Object.assign(new Error('n'), { code: 7 }));
    numericCode.parse(1, new Uint8Array([1, 2, 3, 4]));
    expect((await numericCode.settled(1)).error).toEqual({ code: 'E_INTERNAL', message: 'n' });
    const notError = mk('just a string');
    notError.parse(1, new Uint8Array([1, 2, 3, 4]));
    expect((await notError.settled(1)).error).toEqual({ code: 'E_INTERNAL', message: 'just a string' });
    const codeOnPlain = mk({ code: 'E_NOT_AN_ERROR' });
    codeOnPlain.parse(1, new Uint8Array([1, 2, 3, 4]));
    expect((await codeOnPlain.settled(1)).error?.code).toBe('E_INTERNAL');
    // the handler is free again after each failure
    withCode.parse(2, new Uint8Array([1, 2, 3, 4]));
    expect((await withCode.settled(2)).error?.code).toBe('E_CONTAINER_CRC');
  });
});

describe('worker handler — containers (synthetic adapter)', () => {
  const GCODE = 'G0 X0 Y0 Z0.2\nG1 X1 Y1 E1\n';

  function adapter(over: Partial<OpenedContainerLike> = {}, sniff = vi.fn(() => true)) {
    const openPlate = vi.fn((_i: number) => streamOfChunks([enc.encode(GCODE)]));
    const open = vi.fn(() =>
      Promise.resolve({
        id: 'fake',
        plates: [{ index: 0, name: 'plate-a', estimatedBytes: 10 }],
        metadata: { raw: {}, warnings: [] },
        openPlate,
        ...over
      } as OpenedContainerLike)
    );
    return { sniff, open, openPlate, containers: [{ id: 'fake', sniff, open }] };
  }

  it('sniffs only inputs of at least 4 bytes, and only the first 8 bytes of them', async () => {
    const a = adapter();
    const h = harness({ containers: a.containers });
    h.parse(1, new Uint8Array([71, 48, 32]));
    await h.settled(1);
    expect(a.sniff).not.toHaveBeenCalled();
    h.parse(2, new Uint8Array(4).fill(32));
    await h.settled(2);
    expect(a.sniff).toHaveBeenCalledTimes(1);
    expect((a.sniff.mock.calls as unknown as Uint8Array[][])[0][0].byteLength).toBe(4);
    h.parse(3, new Uint8Array(100).fill(32));
    await h.settled(3);
    expect((a.sniff.mock.calls as unknown as Uint8Array[][])[1][0].byteLength).toBe(8);
  });

  it('a Blob input is sniffed and opened from its bytes', async () => {
    const a = adapter();
    const h = harness({ containers: a.containers });
    h.parse(1, new Blob([new Uint8Array(16).fill(32)]));
    const r = await h.settled(1);
    expect(r.type).toBe('done');
    expect(a.open).toHaveBeenCalledTimes(1);
    expect(a.openPlate).toHaveBeenCalledWith(0);
  });

  it('a string input is never sniffed as a container', async () => {
    const a = adapter();
    const h = harness({ containers: a.containers });
    h.parse(1, 'G0 X0 Y0 Z0\nG1 X1 E1\n');
    await h.settled(1);
    expect(a.sniff).not.toHaveBeenCalled();
  });

  it('the containers option filters by id; `auto` and a matching id use the adapter, a non-matching id does not', async () => {
    const a = adapter();
    const h = harness({ containers: a.containers });
    const bytes = new Uint8Array(16).fill(32);
    h.parse(1, bytes.slice(), { containers: ['other'] });
    await h.settled(1);
    expect(a.open).not.toHaveBeenCalled();
    h.parse(2, bytes.slice(), { containers: ['fake'] });
    await h.settled(2);
    expect(a.open).toHaveBeenCalledTimes(1);
    h.parse(3, bytes.slice(), { containers: 'auto' });
    await h.settled(3);
    expect(a.open).toHaveBeenCalledTimes(2);
  });

  it('plate must be an integer inside the plate list: -1, NaN, 1.5 and N are refused before openPlate', async () => {
    for (const plate of [-1, Number.NaN, 1.5, 1, 2]) {
      const a = adapter();
      const h = harness({ containers: a.containers });
      h.parse(1, new Uint8Array(16).fill(32), { plate });
      const r = await h.settled(1);
      expect(r.error?.code, `plate ${plate}`).toBe('E_CONTAINER_NO_PAYLOAD');
      expect(a.openPlate).not.toHaveBeenCalled();
    }
  });

  it('the multi-plate warning appears only for >1 plates with no plate chosen (plate 0 chosen = no warning)', async () => {
    const two = [
      { index: 0, name: 'a.gcode', estimatedBytes: 1 },
      { index: 1, name: 'b.gcode', estimatedBytes: 1 }
    ];
    const bytes = (): Uint8Array => new Uint8Array(16).fill(32);
    const warnings = async (plates: typeof two, plate?: number) => {
      const a = adapter({ plates });
      const h = harness({ containers: a.containers });
      h.parse(1, bytes(), plate === undefined ? {} : { plate });
      const r = (await h.settled(1)) as Reply & {
        ir: { header: { warnings: { code: string; message: string; count: number; severity: string }[] } };
      };
      return r.ir.header.warnings.filter((w) => w.code === 'container-multiple-plates');
    };
    const none = await warnings(two, 0);
    expect(none).toHaveLength(0);
    const single = await warnings(two.slice(0, 1));
    expect(single).toHaveLength(0);
    const many = await warnings(two);
    expect(many).toHaveLength(1);
    expect(many[0].message).toBe('container has 2 plates (a.gcode, b.gcode); parsing plate 0 — pass {plate} to select');
    expect(many[0].severity).toBe('warn');
    expect(many[0].count).toBe(1);
  });

  it('container warnings join the IR as warn/count 1; machine, filaments and raw merge with the right precedence', async () => {
    const dialects: DialectRunnerFactoryLike = {
      adapterIds: ['d'],
      createRun: () => ({
        onComment: () => undefined,
        onCommand: () => undefined,
        finalize: () => ({
          warnings: [],
          metadata: {
            machine: { confidence: 'inferred', bed: { kind: 'rect', min: { x: 0, y: 0 }, max: { x: 100, y: 100 } } },
            filaments: [
              { slot: 1, type: 'PETG', color: '#111111', name: 'Dialect' },
              { slot: 0, color: '#222222' }
            ],
            raw: { shared: 'dialect', onlyDialect: 'd' }
          }
        })
      })
    } as never;
    const bed = { kind: 'rect', min: { x: 0, y: 0 }, max: { x: 300, y: 300 } };
    const mk = (confidence: string) =>
      adapter({
        metadata: {
          machine: { confidence, bed } as never,
          filaments: [
            { slot: 1, type: 'PLA', color: undefined, name: 'Fancy' },
            { slot: 0, color: '#999999' }
          ] as never,
          raw: { shared: 'container', onlyContainer: 'c' },
          warnings: [{ code: 'container-note', message: 'heads up' }]
        }
      });
    const run = async (confidence: string) => {
      const a = mk(confidence);
      const h = harness({ containers: a.containers, dialects });
      h.parse(1, new Uint8Array(16).fill(32));
      return (await h.settled(1)) as Reply & {
        ir: { header: { warnings: { code: string; severity: string; count: number }[] } };
        metadata: {
          machine: { confidence: string; bed: { max: { x: number } } };
          filaments: unknown[];
          raw: Record<string, string>;
          plates: unknown;
        };
      };
    };
    const known = await run('known');
    expect(known.ir.header.warnings.find((w) => w.code === 'container-note')).toMatchObject({
      severity: 'warn',
      count: 1
    });
    expect(known.metadata.machine.bed.max.x).toBe(300);
    expect(known.metadata.filaments).toEqual([
      { slot: 0, type: undefined, color: '#999999', name: undefined },
      { slot: 1, type: 'PLA', color: '#111111', name: 'Fancy' }
    ]);
    expect(known.metadata.plates).toEqual({ list: [{ index: 0, name: 'plate-a' }], parsed: 0 });
    expect(known.metadata.raw).toEqual({ shared: 'dialect', onlyDialect: 'd', onlyContainer: 'c' });
    const inferred = await run('inferred');
    expect(inferred.metadata.machine.bed.max.x).toBe(100);
  });

  it('{plate: 1} of two plates opens plate 1 and reports it as parsed', async () => {
    const a = adapter({
      plates: [
        { index: 0, name: 'a', estimatedBytes: 1 },
        { index: 1, name: 'b', estimatedBytes: 1 }
      ]
    });
    const h = harness({ containers: a.containers });
    h.parse(1, new Uint8Array(16).fill(32), { plate: 1 });
    const r = (await h.settled(1)) as Reply & { metadata: { plates: { parsed: number } } };
    expect(a.openPlate).toHaveBeenCalledWith(1);
    expect(r.metadata.plates.parsed).toBe(1);
  });

  it('invalid limits fail before the container is even opened; containers:false never opens it', async () => {
    const a = adapter();
    const h = harness({ containers: a.containers });
    h.parse(1, new Uint8Array(16).fill(32), { limits: { maxInputBytes: 2 ** 32 } });
    expect((await h.settled(1)).error?.code).toBe('E_PARSE_OPTION');
    expect(a.sniff).not.toHaveBeenCalled();
    expect(a.open).not.toHaveBeenCalled();
    h.parse(2, new Uint8Array(16).fill(32), { containers: false });
    expect((await h.settled(2)).type).toBe('done');
    expect(a.sniff).not.toHaveBeenCalled();
    expect(a.open).not.toHaveBeenCalled();
  });

  it('a container machine fills in when the dialect found none, even if only inferred', async () => {
    const a = adapter({
      metadata: {
        machine: { confidence: 'inferred', bed: { kind: 'rect', min: { x: 0, y: 0 }, max: { x: 5, y: 5 } } } as never,
        raw: {},
        warnings: []
      }
    });
    const h = harness({ containers: a.containers });
    h.parse(1, new Uint8Array(16).fill(32));
    const r = (await h.settled(1)) as Reply & {
      metadata: { machine: { bed: { max: { x: number } } }; filaments?: unknown; raw?: unknown };
    };
    expect(r.metadata.machine.bed.max.x).toBe(5);
    expect(r.metadata.filaments).toBeUndefined();
    expect(r.metadata.raw).toBeUndefined();
  });

  it('container plates use an 8 MiB progressive-preview threshold (9 MiB sends partials, 7 MiB does not)', async () => {
    const line = 'G1 X10.000 Y10.000 E0.01000 F1200\n';
    const makeStream = (bytes: number): ReadableStream<Uint8Array> => {
      const unit = enc.encode(line.repeat(2048));
      let sent = 0;
      return new ReadableStream<Uint8Array>({
        pull(c) {
          if (sent >= bytes) c.close();
          else {
            c.enqueue(unit);
            sent += unit.byteLength;
          }
        }
      });
    };
    for (const [mib, expectPartials] of [
      [9, true],
      [7, false]
    ] as const) {
      const a = adapter();
      a.openPlate.mockImplementation(() => makeStream(mib * 1024 * 1024));
      const h = harness({ containers: a.containers });
      h.parse(1, new Uint8Array(16).fill(32), { yieldIntervalMs: 0, partialPreview: undefined });
      await h.settled(1);
      const partials = h.replies.filter((r) => r.type === 'partial').length;
      expect(partials > 0, `${mib} MiB`).toBe(expectPartials);
    }
  }, 60_000);
});

describe('worker handler — dialect wiring', () => {
  function recordingDialects() {
    const seen: { selection: unknown; headText: string; tailText: string; config: unknown; containerMeta: unknown }[] =
      [];
    const run = {
      comments: [] as [string, number][],
      commands: 0,
      onComment(t: string, b: number) {
        run.comments.push([t, b]);
      },
      onCommand() {
        run.commands++;
      },
      finalize: () => ({ warnings: [], metadata: { raw: { ran: '1' } } })
    };
    const factory = {
      adapterIds: ['x'],
      createRun: (input: {
        selection: unknown;
        headText: string;
        tailText: string;
        config?: unknown;
        containerMeta?: unknown;
      }) => {
        // Like the real runner: nothing to detect from (a stream's empty up-front windows) -> no run yet.
        if (input.headText === '' && input.tailText === '' && input.containerMeta === undefined) return null;
        seen.push({
          selection: input.selection,
          headText: input.headText,
          tailText: input.tailText,
          config: input.config,
          containerMeta: input.containerMeta
        });
        return run;
      }
    } as unknown as DialectRunnerFactoryLike;
    return { seen, run, factory };
  }

  const big = (): string => ';HEAD\n' + 'x'.repeat(100 * 1024) + '\n;TAIL\n';

  it('detection windows: the first 64 KiB and last 16 KiB for strings, bytes and Blobs', async () => {
    const check = async (input: unknown): Promise<void> => {
      const r = recordingDialects();
      const h = harness({ dialects: r.factory });
      h.parse(1, input, { limits: { maxLineLength: 1 << 20 } });
      await h.settled(1);
      expect(r.seen).toHaveLength(1);
      expect(r.seen[0].headText.length).toBe(65536);
      expect(r.seen[0].headText.startsWith(';HEAD\nxxx')).toBe(true);
      expect(r.seen[0].tailText.length).toBe(16384);
      expect(r.seen[0].tailText.endsWith('x\n;TAIL\n')).toBe(true);
    };
    await check(big());
    await check(enc.encode(big()));
    await check(new Blob([enc.encode(big())]));
  });

  it('detection windows of short inputs are the whole text; selection and config are forwarded', async () => {
    const r = recordingDialects();
    const h = harness({ dialects: r.factory });
    h.parse(1, 'G0 X0 Y0 Z0\n', { dialects: ['x'], dialectConfig: { k: 1 } });
    await h.settled(1);
    expect(r.seen[0]).toEqual({
      selection: ['x'],
      headText: 'G0 X0 Y0 Z0\n',
      tailText: 'G0 X0 Y0 Z0\n',
      config: { k: 1 },
      containerMeta: undefined
    });
    const r2 = recordingDialects();
    const h2 = harness({ dialects: r2.factory });
    h2.parse(1, 'G0 X0 Y0 Z0\n');
    await h2.settled(1);
    expect(r2.seen[0].selection).toBe('auto');
  });

  it('dialects:false never creates a run; a stream is not even recorded', async () => {
    const r = recordingDialects();
    const h = harness({ dialects: r.factory });
    h.parse(1, streamOfChunks([enc.encode('G0 X0 Y0 Z0\n; c\n')]), { dialects: false });
    await h.settled(1);
    expect(r.seen).toHaveLength(0);
    expect(r.run.comments).toHaveLength(0);
  });

  it('a slim worker warns only when an explicit list was requested', async () => {
    const codes = async (opts: Record<string, unknown>): Promise<string[]> => {
      const h = harness();
      h.parse(1, 'G0 X0 Y0 Z0\n', opts);
      const r = (await h.settled(1)) as Reply & { ir: { header: { warnings: { code: string }[] } } };
      return r.ir.header.warnings.map((w) => w.code).filter((c) => c === 'dialects-unavailable');
    };
    expect(await codes({ dialects: ['prusa'] })).toEqual(['dialects-unavailable']);
    const slim = harness();
    slim.parse(1, 'G0 X0 Y0 Z0\n', { dialects: ['prusa'] });
    const sr = (await slim.settled(1)) as Reply & {
      ir: { header: { warnings: { code: string; severity: string; count: number }[] } };
    };
    expect(sr.ir.header.warnings.find((w) => w.code === 'dialects-unavailable')).toMatchObject({
      severity: 'warn',
      count: 1
    });
    expect(await codes({ dialects: 'auto' })).toEqual([]);
    expect(await codes({})).toEqual([]);
    expect(await codes({ dialects: false })).toEqual([]);
  });

  it('stream replay hands the recorded comments (text + byte offset) to the late-detected run, in order', async () => {
    const r = recordingDialects();
    const h = harness({ dialects: r.factory });
    h.parse(1, chunked(enc.encode('; one\nG0 X0 Y0 Z0\n; two\nG1 X1 E1\n'), 7));
    const out = (await h.settled(1)) as Reply & { metadata: { raw: Record<string, string> } };
    expect(r.run.comments.map(([t]) => t.trim())).toEqual(['one', 'two']);
    expect(r.run.comments.map(([, b]) => b)).toEqual([0, 18]);
    expect(r.run.commands).toBeGreaterThan(0);
    expect(out.metadata.raw).toEqual({ ran: '1' });
    expect(r.seen[0].headText).toBe('; one\nG0 X0 Y0 Z0\n; two\nG1 X1 E1\n');
  });

  it('stream replay budget: 500,000 recorded events replay; 500,001 skip annotation with a warning', async () => {
    const mkStream = (comments: number, line = ';c\n'): ReadableStream<Uint8Array> => {
      const unit = enc.encode(line.repeat(5000));
      let left = comments;
      return new ReadableStream<Uint8Array>({
        pull(c) {
          if (left <= 0) {
            c.close();
            return;
          }
          const n = Math.min(left, 5000);
          c.enqueue(n === 5000 ? unit : enc.encode(line.repeat(n)));
          left -= n;
        }
      });
    };
    const within = recordingDialects();
    const h1 = harness({ dialects: within.factory });
    h1.parse(1, mkStream(500000), { yieldIntervalMs: 1000 });
    const ok = (await h1.settled(1)) as Reply & { ir: { header: { warnings: { code: string }[] } } };
    expect(within.seen).toHaveLength(1);
    expect(within.run.comments).toHaveLength(500000);
    expect(ok.ir.header.warnings.some((w) => w.code === 'dialect-stream-truncated')).toBe(false);

    const over = recordingDialects();
    const h2 = harness({ dialects: over.factory });
    h2.parse(1, mkStream(500001), { yieldIntervalMs: 1000 });
    const bad = (await h2.settled(1)) as Reply & {
      ir: { header: { warnings: { code: string; count: number; severity: string }[] } };
    };
    expect(over.seen).toHaveLength(0);
    expect(bad.ir.header.warnings.find((w) => w.code === 'dialect-stream-truncated')).toMatchObject({
      count: 1,
      severity: 'warn'
    });
  }, 120_000);

  it('the same budget applies to recorded commands (500,000 replay, 500,001 do not)', async () => {
    const run = async (n: number) => {
      const r = recordingDialects();
      const h = harness({ dialects: r.factory });
      h.parse(1, mkCommandStream(n), { yieldIntervalMs: 1000 });
      const out = (await h.settled(1)) as Reply & { ir: { header: { warnings: { code: string }[] } } };
      return {
        seen: r.seen.length,
        truncated: out.ir.header.warnings.some((w) => w.code === 'dialect-stream-truncated')
      };
    };
    expect(await run(500000)).toEqual({ seen: 1, truncated: false });
    expect(await run(500001)).toEqual({ seen: 0, truncated: true });
  }, 120_000);

  it('replay is for streams only: a string whose up-front detection found nothing is not retried', async () => {
    let calls = 0;
    const factory = {
      adapterIds: ['x'],
      createRun: () => {
        calls++;
        return null;
      }
    } as unknown as DialectRunnerFactoryLike;
    const h = harness({ dialects: factory });
    h.parse(1, 'G0 X0 Y0 Z0\nG1 X1 E1\n');
    await h.settled(1);
    expect(calls).toBe(1);
    const h2 = harness({ dialects: factory });
    h2.parse(1, chunked(enc.encode('G0 X0 Y0 Z0\nG1 X1 E1\n'), 5));
    await h2.settled(1);
    expect(calls).toBe(3); // a stream: once up front (no windows), once after the parse
  });
});

function mkCommandStream(n: number): ReadableStream<Uint8Array> {
  const unit = enc.encode('G1 X1\n'.repeat(5000));
  let left = n;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (left <= 0) {
        c.close();
        return;
      }
      const k = Math.min(left, 5000);
      c.enqueue(k === 5000 ? unit : enc.encode('G1 X1\n'.repeat(k)));
      left -= k;
    }
  });
}

describe('worker handler — progressive preview defaults', () => {
  it('partialPreview:false suppresses partials even past the 25 MiB default; the default interval is ~1 s', async () => {
    // Travel moves between short extrusions give the preview many path boundaries to cut at.
    const line = 'G0 X1.000 Y1.000\nG1 X10.000 Y10.000 E0.01000 F1200\n';
    const unit = line.repeat(1024);
    const text = unit.repeat(Math.ceil((26 * 1024 * 1024) / unit.length));
    const bytes = enc.encode(text);
    const off = harness();
    off.parse(1, bytes.slice(), { partialPreview: false });
    await off.settled(1);
    expect(off.replies.filter((r) => r.type === 'partial')).toHaveLength(0);
    const t0 = Date.now();
    const on = harness();
    on.parse(1, bytes.slice());
    await on.settled(1);
    const seconds = (Date.now() - t0) / 1000;
    const partials = on.replies.filter((r) => r.type === 'partial').length;
    expect(partials).toBeGreaterThan(0);
    expect(partials).toBeLessThanOrEqual(Math.floor(seconds) + 1);

    // Only the threshold is set (from byte 1): the interval between partials still defaults to 1 s.
    const t1 = Date.now();
    const early = harness();
    early.parse(1, bytes.slice(), { partialPreview: { minInputBytes: 1 } });
    await early.settled(1);
    const seconds2 = (Date.now() - t1) / 1000;
    const earlyPartials = early.replies.filter((r) => r.type === 'partial').length;
    expect(earlyPartials).toBeGreaterThan(0);
    expect(earlyPartials).toBeLessThanOrEqual(Math.floor(seconds2) + 1);
  }, 120_000);
});
