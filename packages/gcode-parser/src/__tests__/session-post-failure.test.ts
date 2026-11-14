/**
 * Regression (#453): if worker.postMessage throws inside parse(), the session must settle that parse
 * and stay usable. Before the fix `active` was never cleared, so every later parse() — even with fresh
 * input — failed with E_BUSY until dispose(). Real trigger: re-parsing the same Uint8Array, whose
 * buffer the first parse transferred (detached), makes postMessage throw DataCloneError.
 *
 * The fake workers below run the message through the platform's own structuredClone with the same
 * transfer list, so the detach and the DataCloneError are real, not simulated.
 */
import { describe, expect, it } from 'vitest';
import { createWorkerHandler } from '../worker-core';
import { GcodeParseSession, ParseSessionError, type WorkerLike } from '../session';
import { PROTOCOL_VERSION, type WorkerRequest } from '../protocol';

interface CloningWorker extends WorkerLike {
  posted: { type: string; id: number }[];
  terminated: number;
}

/** Clones (and transfers) like a real Worker boundary; never replies on its own. */
function cloningWorker(): CloningWorker {
  const w: CloningWorker = {
    posted: [],
    terminated: 0,
    onmessage: null,
    onerror: null,
    postMessage: (msg: unknown, transfer?: unknown[]) => {
      const cloned = structuredClone(msg, { transfer: (transfer ?? []) as Transferable[] });
      w.posted.push(cloned as { type: string; id: number });
    },
    terminate: () => {
      w.terminated++;
    }
  };
  return w;
}

/** In-process worker running the real handler, behind the same clone/transfer boundary. */
function cloningLoopback(): WorkerLike {
  const w: WorkerLike = { onmessage: null, onerror: null, postMessage: () => undefined, terminate: () => undefined };
  const handler = createWorkerHandler((msg) => {
    void Promise.resolve().then(() => w.onmessage?.({ data: msg }));
  });
  w.postMessage = (m: unknown, transfer?: unknown[]) =>
    handler(structuredClone(m, { transfer: (transfer ?? []) as Transferable[] }) as WorkerRequest);
  return w;
}

const done = (id: number) => ({
  data: {
    v: PROTOCOL_VERSION,
    type: 'done',
    id,
    ir: { header: { complete: true, warnings: [] } },
    stats: {}
  }
});

describe('GcodeParseSession — postMessage failure (#453)', () => {
  it('re-parsing transferred bytes rejects with E_POST_FAILED and leaves the session usable', async () => {
    const worker = cloningWorker();
    let created = 0;
    const session = new GcodeParseSession({
      worker: () => {
        created++;
        return worker;
      }
    });
    const bytes = new TextEncoder().encode('G1 X1 E1');

    const first = session.parse(bytes);
    expect(bytes.byteLength).toBe(0); // the first parse transferred (detached) the caller's buffer
    worker.onmessage?.(done(1));
    await first;

    let caught: unknown;
    try {
      await session.parse(bytes);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ParseSessionError);
    expect((caught as ParseSessionError).code).toBe('E_POST_FAILED');
    expect((caught as ParseSessionError).message).toMatch(/^could not send the parse to the worker: \S/);
    expect(worker.posted.map((m) => m.type)).toEqual(['parse']); // the failed parse never reached the worker

    // Not wedged: cancel() has nothing to cancel, and a fresh parse is sent and resolves.
    session.cancel();
    expect(worker.posted.map((m) => m.type)).toEqual(['parse']);
    const third = session.parse('G1 X2 E2');
    expect(worker.posted.map((m) => [m.type, m.id])).toEqual([
      ['parse', 1],
      ['parse', 3]
    ]);
    worker.onmessage?.(done(3));
    await expect(third).resolves.toMatchObject({ ir: { header: { complete: true } } });

    // The same worker is reused; a failed send is not a worker crash.
    expect(created).toBe(1);
    expect(worker.terminated).toBe(0);
  });

  it('keeps the original message, and stringifies a non-Error throw', async () => {
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      terminate: () => undefined,
      postMessage: () => {
        throw 'boom';
      }
    };
    const session = new GcodeParseSession({ worker });
    await expect(session.parse('G1 X1')).rejects.toMatchObject({
      code: 'E_POST_FAILED',
      message: 'could not send the parse to the worker: boom'
    });

    const original = new Error('cannot clone');
    worker.postMessage = () => {
      throw original;
    };
    let caught: unknown;
    await session.parse('G1 X1').catch((err: unknown) => (caught = err));
    expect(caught).toMatchObject({
      code: 'E_POST_FAILED',
      message: 'could not send the parse to the worker: cannot clone'
    });
    // The original error rides on `cause`, the same object (as for E_WORKER_CREATE_FAILED).
    expect((caught as Error).cause).toBe(original);
  });

  it('end to end with the real handler: parse, re-parse same bytes fails cleanly, parse a copy works', async () => {
    const session = new GcodeParseSession({ worker: cloningLoopback() });
    const bytes = new TextEncoder().encode('G0 X0 Y0 Z0.2\nG1 X1 E1');
    const copy = bytes.slice();

    const a = await session.parse(bytes);
    expect(a.ir.segments.count).toBe(2);
    await expect(session.parse(bytes)).rejects.toMatchObject({ code: 'E_POST_FAILED' });
    const b = await session.parse(copy);
    expect(b.ir.segments.count).toBe(2);
    session.dispose();
  });

  it('a getReader getter that throws while the transfer list is built rejects with E_POST_FAILED, not a wedge', async () => {
    const worker = cloningWorker();
    const session = new GcodeParseSession({ worker });
    const hostile = {
      get getReader(): never {
        throw new Error('hostile getter');
      }
    };
    await expect(session.parse(hostile as never)).rejects.toMatchObject({
      code: 'E_POST_FAILED',
      message: 'could not send the parse to the worker: hostile getter'
    });
    expect(worker.posted.length).toBe(0);
    // The session is idle again: the next parse is posted, not refused with E_BUSY.
    const next = session.parse('G1 X1');
    expect(worker.posted.map((m) => m.type).join(',')).toBe('parse');
    worker.onmessage?.(done(worker.posted[0]!.id));
    await expect(next).resolves.toMatchObject({ ir: { header: { complete: true } } });
    session.dispose();
  });
});
