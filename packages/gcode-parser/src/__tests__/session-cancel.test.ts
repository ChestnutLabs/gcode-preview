/**
 * Regression: GcodeParseSession.cancel() must be idempotent while a cancel is pending. A second
 * cancel() (e.g. the core controller cancels before a re-parse) previously overwrote `cancelTimer`,
 * orphaning the first backstop — which then fired later and terminated whatever parse was running by
 * then, wedging the controller at parsing:true. cancel() now no-ops if a backstop is already pending.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { GcodeParseSession, CancelledError, type WorkerLike } from '../session.js';

interface FakeWorker extends WorkerLike {
  posted: unknown[];
  terminated: number;
}

function makeFakeWorker(): FakeWorker {
  const w: FakeWorker = {
    posted: [],
    terminated: 0,
    onmessage: null,
    onerror: null,
    postMessage: (msg: unknown) => {
      w.posted.push(msg);
    },
    terminate: () => {
      w.terminated++;
    }
  };
  return w;
}

const cancelMsgs = (w: FakeWorker): unknown[] =>
  w.posted.filter(
    (m): m is { type: string } => typeof m === 'object' && m !== null && (m as { type?: string }).type === 'cancel'
  );

describe('GcodeParseSession — cancel idempotency (regression: orphaned cancelTimer)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a second cancel() while a cancel is pending sends no second message and schedules no second backstop', async () => {
    const worker = makeFakeWorker();
    const session = new GcodeParseSession({ worker, terminateFallbackMs: 2000 });
    // Worker never replies → the parse stays in-flight (active) so cancel() has something to cancel.
    const settled = session.parse('G1 X1 E1').then(
      () => 'resolved' as const,
      (e: unknown) => e
    );

    session.cancel();
    session.cancel(); // must be a no-op — the first backstop is still pending

    expect(cancelMsgs(worker)).toHaveLength(1); // pre-fix this was 2 (and a second timer was orphaned)

    vi.advanceTimersByTime(2000); // fire the single backstop
    expect(worker.terminated).toBe(1);

    const result = await settled;
    expect(result).toBeInstanceOf(CancelledError);
    expect((result as CancelledError).terminated).toBe(true);
  });

  it('cancel() with no active parse is a no-op', () => {
    const worker = makeFakeWorker();
    const session = new GcodeParseSession({ worker, terminateFallbackMs: 2000 });
    expect(() => session.cancel()).not.toThrow();
    expect(worker.posted).toHaveLength(0);
  });
});
