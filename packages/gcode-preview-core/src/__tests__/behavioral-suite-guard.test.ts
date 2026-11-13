/**
 * The behavioral suite's parse lifecycle guard: `parseLifecycleViolation` on its own, and the harness wrapper
 * (`withParseLifecycleGuard`) that `runBehavioralSuite` applies to every case. An adapter whose parse never ends,
 * or that leaves `parsing` true, must fail with an explicit message at dispose.
 */
import { describe, expect, it } from 'vitest';
import {
  parseLifecycleViolation,
  runBehavioralSuite,
  withParseLifecycleGuard,
  type AdapterHarness,
  type AdapterInstance
} from '../testing';
import type { GcodePreviewState, PreviewEvent } from '../controller';

describe('parseLifecycleViolation', () => {
  const cases: Array<[string[], string]> = [
    [[], ''],
    [['parse-started', 'parse-complete'], ''],
    [['parse-started', 'parse-error', 'parse-started', 'parse-cancelled'], ''],
    [['parse-started', 'parse-progress', 'stage', 'parse-complete', 'error'], ''],
    [['parse-started'], 'a parse-started never ended: parse-started'],
    [
      ['parse-started', 'parse-started', 'parse-complete'],
      'parse-started before the previous parse ended: parse-started,parse-started,parse-complete'
    ],
    [['parse-complete'], 'parse-complete without a parse-started: parse-complete'],
    [['parse-error'], 'parse-error without a parse-started: parse-error'],
    [['parse-cancelled'], 'parse-cancelled without a parse-started: parse-cancelled'],
    [
      ['parse-started', 'parse-complete', 'parse-error'],
      'parse-error without a parse-started: parse-started,parse-complete,parse-error'
    ]
  ];
  for (const [types, expected] of cases) {
    it(`${types.join(',') || '(none)'} -> ${expected || 'ok'}`, () => {
      expect(parseLifecycleViolation(types)).toBe(expected);
    });
  }
});

/** A fake instance whose parse emits `events` and whose state reports `parsing`. Nothing else is real. */
function fakeHarness(events: string[], parsing: boolean): AdapterHarness & { disposed: number } {
  const h = {
    disposed: 0,
    create(): AdapterInstance {
      const subs = new Set<(e: PreviewEvent) => void>();
      return {
        parse: async () => {
          for (const type of events) for (const cb of [...subs]) cb({ type } as PreviewEvent);
          return undefined;
        },
        getState: () => ({ parsing }) as GcodePreviewState,
        controls: {} as AdapterInstance['controls'],
        observeProgress: () => null,
        clearProgress: () => undefined,
        onEvent: (cb) => {
          subs.add(cb);
          return () => subs.delete(cb);
        },
        firstChunkDrawCount: () => 0,
        dispose: () => {
          h.disposed++;
        },
        settle: async () => undefined
      };
    }
  };
  return h;
}

async function parsedOnce(events: string[], parsing: boolean) {
  const raw = fakeHarness(events, parsing);
  const a = await withParseLifecycleGuard(raw).create();
  await a.parse(new Uint8Array(1));
  return { raw, a };
}

describe('withParseLifecycleGuard', () => {
  it('a parse-started that never ends fails at dispose, after the instance is disposed', async () => {
    const { raw, a } = await parsedOnce(['parse-started'], false);
    await expect(Promise.resolve().then(() => a.dispose())).rejects.toThrow(
      'parse lifecycle: a parse-started never ended: parse-started'
    );
    expect(raw.disposed).toBe(1);
  });

  it('state.parsing still true after a well-formed sequence fails too', async () => {
    const { raw, a } = await parsedOnce(['parse-started', 'parse-complete'], true);
    await expect(Promise.resolve().then(() => a.dispose())).rejects.toThrow(
      'parse lifecycle: state.parsing still true after parse-started,parse-complete'
    );
    expect(raw.disposed).toBe(1);
  });

  it('a well-formed sequence with parsing false disposes cleanly', async () => {
    const { raw, a } = await parsedOnce(['parse-started', 'parse-error'], false);
    await a.dispose();
    expect(raw.disposed).toBe(1);
  });

  it('records from create, so a terminal no case listened for still counts', async () => {
    const { a } = await parsedOnce(['parse-complete'], false);
    await expect(Promise.resolve().then(() => a.dispose())).rejects.toThrow(
      'parse lifecycle: parse-complete without a parse-started: parse-complete'
    );
  });

  it('passes every other member through to the instance', async () => {
    const raw = fakeHarness([], false);
    const inner = raw.create();
    const calls: string[] = [];
    const spy: AdapterInstance = {
      ...inner,
      parse: async (b) => {
        calls.push(`parse ${b.length}`);
        return 'parsed';
      },
      getState: () => {
        calls.push('getState');
        return { parsing: false } as GcodePreviewState;
      },
      get controls() {
        calls.push('controls');
        return {} as AdapterInstance['controls'];
      },
      observeProgress: () => {
        calls.push('observeProgress');
        return null;
      },
      clearProgress: () => {
        calls.push('clearProgress');
      },
      firstChunkDrawCount: () => {
        calls.push('firstChunkDrawCount');
        return 7;
      },
      settle: async () => {
        calls.push('settle');
      }
    };
    const a = await withParseLifecycleGuard({ create: () => spy }).create();
    calls.length = 0;
    expect(await a.parse(new Uint8Array(3))).toBe('parsed');
    a.getState();
    void a.controls;
    a.observeProgress({ v: 1, timestampMs: 0, position: { percent: 0 } });
    a.clearProgress();
    expect(a.firstChunkDrawCount()).toBe(7);
    await a.settle();
    expect(calls.join(',')).toBe('parse 3,getState,controls,observeProgress,clearProgress,firstChunkDrawCount,settle');
  });
});

describe('runBehavioralSuite applies the guard to its cases', () => {
  it('a dangling parse-started fails a case that passes on its own assertions', async () => {
    // The fake emits parse-started from observeProgress (and still returns null), so the pre-parse progress case
    // passes its own expect and only the wrapper's dispose check can fail it.
    const raw = fakeHarness([], false);
    const harness: AdapterHarness = {
      create() {
        const a = raw.create();
        const subs = new Set<(e: PreviewEvent) => void>();
        return {
          ...a,
          onEvent: (cb) => {
            subs.add(cb);
            return () => subs.delete(cb);
          },
          observeProgress: () => {
            for (const cb of subs) cb({ type: 'parse-started', bytes: 0 });
            return null;
          }
        };
      }
    };
    const cases = new Map<string, () => Promise<void> | void>();
    runBehavioralSuite(
      'guard',
      {
        describe: (_n: string, fn: () => void) => fn(),
        it: (n: string, fn: () => Promise<void> | void) => {
          cases.set(n, fn);
        },
        expect
      } as unknown as Parameters<typeof runBehavioralSuite>[1],
      harness
    );
    const run = cases.get('progress is unavailable before a parse (no fabricated mapping)')!;
    await expect(Promise.resolve().then(run)).rejects.toThrow(
      'parse lifecycle: a parse-started never ended: parse-started'
    );
    expect(raw.disposed).toBe(1);
  });
});
