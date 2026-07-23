/**
 * Worker protocol v1 + GcodeParseSession tests (DD-003 §4.3/§5.2, issue #45).
 *
 * Uses an in-process loopback "worker" wiring createWorkerHandler directly to the
 * session. Because both sides share one event loop, the cooperative yield loop is
 * genuinely exercised: a queued cancel can only be observed if the parse actually
 * yields (§5.2) — exactly the property the amendment requires us to prove.
 */
import { describe, expect, it } from 'vitest';
import { createWorkerHandler } from '../worker-core';
import { CancelledError, GcodeParseSession, ParseSessionError, type WorkerLike } from '../session';
import { PROTOCOL_VERSION, type WorkerRequest } from '../protocol';

interface LoopbackWorker extends WorkerLike {
  terminateCalls: number;
}

/** In-process worker: messages to it run the real handler; replies are delivered async. */
function loopbackWorker(): LoopbackWorker {
  const w: LoopbackWorker = {
    onmessage: null,
    onerror: null,
    terminateCalls: 0,
    postMessage: () => undefined,
    terminate: () => undefined
  };
  const handler = createWorkerHandler((msg) => {
    // Deliver replies asynchronously, like a real worker boundary.
    void Promise.resolve().then(() => w.onmessage?.({ data: msg }));
  });
  w.postMessage = (m: unknown) => handler(m as WorkerRequest);
  w.terminate = () => {
    w.terminateCalls++;
  };
  return w;
}

function bigGcode(lines: number): string {
  const out: string[] = ['G0 X0 Y0 Z0.2'];
  for (let i = 1; i <= lines; i++) {
    out.push(`G1 X${(i % 100).toFixed(3)} Y${(i % 77).toFixed(3)} E${i} F1200`);
  }
  return out.join('\n');
}

describe('worker protocol v1 (#45)', () => {
  it('happy path: parse resolves with a complete IR and reports progress', async () => {
    const worker = loopbackWorker();
    const session = new GcodeParseSession({ worker });
    const progress: number[] = [];
    session.onProgress((p) => progress.push(p.bytesProcessed));

    const gcode = bigGcode(50000);
    const result = await session.parse(gcode, { yieldIntervalMs: 5 });

    expect(result.ir.header.complete).toBe(true);
    expect(result.ir.segments.count).toBe(50001); // 50,000 G1 moves + the initial G0
    expect(result.stats.stopReason).toBeUndefined();
    expect(progress.length).toBeGreaterThan(0);
    expect(worker.terminateCalls).toBe(0);
    session.dispose();
  });

  it('cooperative cancel: acknowledged in <250 ms WITHOUT terminate (§5.2 amendment)', async () => {
    const worker = loopbackWorker();
    const session = new GcodeParseSession({ worker });
    const parsePromise = session.parse(bigGcode(400000), { yieldIntervalMs: 5, partialOnCancel: true });

    await new Promise((r) => setTimeout(r, 30)); // let the parse get going
    const cancelAt = Date.now();
    session.cancel();

    let caught: unknown;
    try {
      await parsePromise;
    } catch (err) {
      caught = err;
    }
    const latency = Date.now() - cancelAt;

    expect(caught).toBeInstanceOf(CancelledError);
    const cancelled = caught as CancelledError;
    expect(cancelled.terminated).toBe(false); // cooperative path, not the backstop
    expect(worker.terminateCalls).toBe(0);
    expect(latency).toBeLessThan(250);
    // partialOnCancel: bounded partial IR attached, honestly incomplete.
    expect(cancelled.partial).toBeDefined();
    expect(cancelled.partial?.ir.header.complete).toBe(false);
    expect(cancelled.partial?.ir.segments.count).toBeGreaterThan(0);
    session.dispose();
  });

  it('limit-exceeded RESOLVES with a bounded partial + stats.stopReason (§4.3 contract)', async () => {
    const worker = loopbackWorker();
    const session = new GcodeParseSession({ worker });
    const result = await session.parse(bigGcode(1000), { limits: { maxSegments: 100 } });

    expect(result.ir.header.complete).toBe(false);
    expect(result.ir.header.truncatedAtByte).toBeGreaterThan(0);
    expect(result.ir.segments.count).toBe(100);
    expect(result.stats.stopReason?.code).toBe('E_LIMIT_SEGMENTS');
    session.dispose();
  });

  it('rejects a second parse while one is active (E_BUSY)', async () => {
    const worker = loopbackWorker();
    const session = new GcodeParseSession({ worker });
    const first = session.parse(bigGcode(100000), { yieldIntervalMs: 5 });
    await expect(session.parse('G0 X0 Y0 Z1')).rejects.toMatchObject({ code: 'E_BUSY' });
    await first;
    session.dispose();
  });

  it('rejects protocol/version mismatches with E_PROTOCOL', async () => {
    const replies: unknown[] = [];
    const handler = createWorkerHandler((msg) => replies.push(msg));
    handler({ v: 99, type: 'parse', id: 1, input: 'G0 X0' } as unknown as WorkerRequest);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ type: 'error', error: { code: 'E_PROTOCOL' } });
  });

  it('worker-side busy guard answers E_BUSY on overlapping parse requests', async () => {
    const replies: { type: string; error?: { code: string } }[] = [];
    const handler = createWorkerHandler((msg) => replies.push(msg as never));
    handler({ v: PROTOCOL_VERSION, type: 'parse', id: 1, input: bigGcode(50000), opts: { yieldIntervalMs: 5 } });
    handler({ v: PROTOCOL_VERSION, type: 'parse', id: 2, input: 'G0 X0' });
    // Wait for the first parse to finish.
    await new Promise((r) => setTimeout(r, 500));
    const busy = replies.find((m) => m.type === 'error');
    expect(busy?.error?.code).toBe('E_BUSY');
    expect(replies.some((m) => m.type === 'done')).toBe(true);
  });

  it('recovers from a worker crash: active parse rejects, next parse works on a fresh worker', async () => {
    let created = 0;
    const workers: LoopbackWorker[] = [];
    const session = new GcodeParseSession({
      worker: () => {
        created++;
        const w = loopbackWorker();
        workers.push(w);
        return w;
      }
    });
    const p = session.parse(bigGcode(200000), { yieldIntervalMs: 5 });
    await new Promise((r) => setTimeout(r, 20));
    workers[0].onerror?.(new Error('boom'));
    await expect(p).rejects.toMatchObject({ code: 'E_WORKER_CRASHED' });

    const ok = await session.parse('G0 X0 Y0 Z0.2\nG1 X1 E1');
    expect(ok.ir.header.complete).toBe(true);
    expect(created).toBe(2);
    session.dispose();
  });

  it('terminate() is the last-resort backstop when a worker never acknowledges cancel', async () => {
    // A rigged worker that accepts parse but never responds to anything.
    const w: LoopbackWorker = {
      onmessage: null,
      onerror: null,
      terminateCalls: 0,
      postMessage: () => undefined,
      terminate: function () {
        this.terminateCalls++;
      }
    };
    const session = new GcodeParseSession({ worker: w, terminateFallbackMs: 100 });
    const p = session.parse('G0 X0 Y0 Z1');
    await new Promise((r) => setTimeout(r, 10));
    session.cancel();
    let caught: unknown;
    try {
      await p;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CancelledError);
    expect((caught as CancelledError).terminated).toBe(true);
    expect(w.terminateCalls).toBe(1);
  });

  it('dispose rejects the active parse with E_DISPOSED', async () => {
    const worker = loopbackWorker();
    const session = new GcodeParseSession({ worker });
    const p = session.parse(bigGcode(200000), { yieldIntervalMs: 5 });
    await new Promise((r) => setTimeout(r, 10));
    session.dispose();
    await expect(p).rejects.toMatchObject({ code: 'E_DISPOSED' });
  });

  it('ParseSessionError carries structured code/message', () => {
    const e = new ParseSessionError('E_TEST', 'msg', 42);
    expect(e.code).toBe('E_TEST');
    expect(e.srcByte).toBe(42);
  });
});
