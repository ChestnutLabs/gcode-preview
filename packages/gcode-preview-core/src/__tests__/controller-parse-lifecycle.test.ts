// @vitest-environment happy-dom
/**
 * The parse event contract (every `parse-started` → exactly one terminal event, then `parsing: false`)
 * holds when the input itself throws: a null input used to leave `parsing: true` with no event at all,
 * and a hostile `getReader` getter wedged the session at E_BUSY for every later parse.
 */
import { describe, expect, it } from 'vitest';
import { createPreviewController, type PreviewEvent } from '../index';
import { SuiteStubWorker } from '../testing';

function make(): { c: ReturnType<typeof createPreviewController>; log: string[] } {
  const c = createPreviewController({ createWorker: () => new SuiteStubWorker() });
  const log: string[] = [];
  c.onEvent((e: PreviewEvent) => {
    if (e.type === 'parse-started') log.push(`parse-started:${e.bytes}`);
    else if (e.type === 'parse-error') log.push(`parse-error:${e.code}:${e.message}`);
    else if (e.type.startsWith('parse-') && e.type !== 'parse-progress') log.push(e.type);
  });
  return { c, log };
}

describe('controller parse lifecycle: inputs that throw', () => {
  it('parse(null) ends with parse-error and parsing false; the next parse completes', async () => {
    const { c, log } = make();
    const out = await c.parse(null as unknown as Uint8Array);
    expect(JSON.stringify(out)).toBe(
      JSON.stringify({
        ok: false,
        error: {
          code: 'E_UNKNOWN',
          message: 'parse input must be a Uint8Array, ArrayBuffer or File (got null)'
        }
      })
    );
    expect(c.getState().parsing).toBe(false);
    expect(c.getState().error?.code).toBe('E_UNKNOWN');
    expect(log.join('|')).toBe(
      'parse-started:0|parse-error:E_UNKNOWN:parse input must be a Uint8Array, ArrayBuffer or File (got null)'
    );
    log.length = 0;
    const next = await c.parse(new Uint8Array(1_000));
    expect(next.ok).toBe(true);
    expect(log.join('|')).toBe('parse-started:1000|parse-complete');
    expect(c.getState().parsing).toBe(false);
    c.dispose();
  });

  it('parse(undefined) and a primitive are refused the same way', async () => {
    for (const [input, shown] of [
      [undefined, 'undefined'],
      ['G1 X1', 'G1 X1']
    ] as const) {
      const { c, log } = make();
      await c.parse(input as unknown as Uint8Array);
      expect(log.join('|')).toBe(
        `parse-started:0|parse-error:E_UNKNOWN:parse input must be a Uint8Array, ArrayBuffer or File (got ${shown})`
      );
      expect(c.getState().parsing).toBe(false);
      c.dispose();
    }
  });

  it('a hostile getReader getter ends in E_POST_FAILED and the next parse works (no E_BUSY wedge)', async () => {
    const { c, log } = make();
    const hostile = {
      byteLength: 7,
      get getReader(): never {
        throw new Error('hostile getter');
      }
    };
    await c.parse(hostile as unknown as Uint8Array);
    expect(log.join('|')).toBe(
      'parse-started:7|parse-error:E_POST_FAILED:could not send the parse to the worker: hostile getter'
    );
    expect(c.getState().parsing).toBe(false);
    log.length = 0;
    const next = await c.parse(new Uint8Array(1_000));
    expect(next.ok).toBe(true);
    expect(log.join('|')).toBe('parse-started:1000|parse-complete');
    c.dispose();
  });

  it('a byteLength getter that throws still reports parse-started (0 bytes) and one terminal event', async () => {
    const { c, log } = make();
    const hostile = {
      get byteLength(): never {
        throw new Error('no size');
      }
    };
    await c.parse(hostile as unknown as Uint8Array);
    expect(log.length).toBe(2);
    expect(log[0]).toBe('parse-started:0');
    expect(c.getState().parsing).toBe(false);
    c.dispose();
  });

  it('a File reports its size', async () => {
    const { c, log } = make();
    await c.parse(new File([new Uint8Array(42)], 'a.gcode'));
    expect(log[0]).toBe('parse-started:42');
    c.dispose();
  });
});
