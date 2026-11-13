/**
 * Regression (#566): a worker factory that throws synchronously (e.g. `SecurityError` when a strict CSP
 * blocks the worker URL) must make parse() REJECT with E_WORKER_CREATE_FAILED, never throw out of it.
 * Before the fix the throw escaped parse(), so a caller awaiting it inside try/catch after emitting its
 * own "started" signal skipped its error path. The session must stay idle and call the factory again on
 * the next parse.
 */
import { describe, expect, it } from 'vitest';
import { GcodeParseSession, ParseSessionError, type WorkerLike } from '../session';
import { PROTOCOL_VERSION } from '../protocol';

interface RecWorker extends WorkerLike {
  posted: { type: string; id: number }[];
  terminated: number;
}

function recWorker(): RecWorker {
  const w: RecWorker = {
    posted: [],
    terminated: 0,
    onmessage: null,
    onerror: null,
    postMessage: (msg: unknown) => {
      w.posted.push(msg as { type: string; id: number });
    },
    terminate: () => {
      w.terminated++;
    }
  };
  return w;
}

const done = (id: number) => ({
  data: { v: PROTOCOL_VERSION, type: 'done', id, ir: { header: { complete: true, warnings: [] } }, stats: {} }
});

describe('GcodeParseSession — worker factory throws (#566)', () => {
  it('rejects (never throws) with E_WORKER_CREATE_FAILED, the original message and the error as cause', async () => {
    const blocked = new Error('worker blocked');
    blocked.name = 'SecurityError';
    const session = new GcodeParseSession({
      worker: () => {
        throw blocked;
      }
    });
    let p: Promise<unknown> | undefined;
    expect(() => {
      p = session.parse('G1 X1');
    }).not.toThrow();
    const err = (await p!.catch((e: unknown) => e)) as ParseSessionError;
    expect(err).toBeInstanceOf(ParseSessionError);
    expect(err.name).toBe('ParseSessionError');
    expect(err.code).toBe('E_WORKER_CREATE_FAILED');
    expect(err.message).toBe('could not start the parse worker: worker blocked');
    expect(err.cause).toBe(blocked);
    expect(err.srcByte).toBeUndefined();
  });

  it('stringifies a non-Error throw and keeps it as the cause', async () => {
    const session = new GcodeParseSession({
      worker: () => {
        throw 'no workers here';
      }
    });
    const err = (await session.parse('G1 X1').catch((e: unknown) => e)) as ParseSessionError;
    expect(err.code).toBe('E_WORKER_CREATE_FAILED');
    expect(err.message).toBe('could not start the parse worker: no workers here');
    expect(err.cause).toBe('no workers here');
  });

  it('leaves the session idle: the factory is called again and the next parse succeeds (not E_BUSY, not E_WORKER_TERMINATED)', async () => {
    const worker = recWorker();
    let calls = 0;
    const session = new GcodeParseSession({
      worker: () => {
        calls++;
        if (calls <= 2) throw new Error(`blocked ${calls}`);
        return worker;
      }
    });
    const codes: string[] = [];
    for (let i = 0; i < 2; i++) {
      codes.push(((await session.parse('G1 X1').catch((e: unknown) => e)) as ParseSessionError).code);
    }
    expect(codes).toEqual(['E_WORKER_CREATE_FAILED', 'E_WORKER_CREATE_FAILED']);
    // Nothing to cancel, nothing to tear down.
    session.cancel();
    const third = session.parse('G1 X2');
    expect(calls).toBe(3);
    // The failed attempts never took a parse id: the first parse that reaches the worker is id 1.
    expect(worker.posted.map((m) => [m.type, m.id])).toEqual([['parse', 1]]);
    worker.onmessage?.(done(1));
    await expect(third).resolves.toMatchObject({ ir: { header: { complete: true } } });
    expect(worker.terminated).toBe(0);
    session.dispose();
    expect(worker.terminated).toBe(1);
  });

  it('a supplied worker INSTANCE never goes through a create failure and keeps the #560 spent rule', async () => {
    // An instance is wrapped as a factory that returns it, so it cannot throw at create time. Its own
    // terminate-then-reject rule (E_WORKER_TERMINATED) is unchanged by the create path moving.
    const worker = recWorker();
    const session = new GcodeParseSession({ worker });
    const first = session.parse('G1 X1');
    worker.onmessage?.(done(1));
    await first;
    session.dispose();
    const again = (await session.parse('G1 X2').catch((e: unknown) => e)) as ParseSessionError;
    expect(again.code).toBe('E_WORKER_TERMINATED');
    expect(worker.posted).toHaveLength(1);
  });
});
