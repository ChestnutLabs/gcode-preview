// @vitest-environment happy-dom
/**
 * #589: the preview keeps the original error on `cause`, and `E_RENDERER_LOAD` says whether the 3D renderer
 * failed to load (`reason: 'load'`) or loaded and failed to start (`reason: 'start'`).
 */
import { describe, expect, it, vi } from 'vitest';
import { createPreviewController, type PreviewEvent } from '../index';
import { SuiteStubWorker, makeSuiteStubGL } from '../testing';

/** Wait for the on-demand 3D load (the real module) to settle into state. */
const settled = async (c: { getState(): { error: unknown } }): Promise<void> => {
  await vi.waitFor(() => expect(c.getState().error).not.toBeNull(), { timeout: 10_000 });
};

function bound(renderer: Record<string, unknown> = {}, createWorker: () => unknown = () => new SuiteStubWorker()) {
  const canvas = document.createElement('canvas');
  const c = createPreviewController({
    createWorker: createWorker as never,
    renderer: {
      quality: 'lines',
      createRenderer: () => makeSuiteStubGL(canvas),
      scheduleFrame: (f: () => void) => f(),
      ...renderer
    } as never
  });
  const events: PreviewEvent[] = [];
  c.onEvent((e) => events.push(e));
  c.bindCanvas(canvas);
  return { c, events };
}

describe('E_RENDERER_LOAD reason (#589)', () => {
  it("a renderer that loads but can't start is reason 'start', with the thrown error as cause", async () => {
    const noWebGL = new Error('Error creating WebGL context.');
    const { c, events } = bound({
      createRenderer: () => {
        throw noWebGL;
      }
    });
    await settled(c);
    expect(c.getState().error).toEqual({
      code: 'E_RENDERER_LOAD',
      message: 'Error creating WebGL context.',
      cause: noWebGL,
      reason: 'start'
    });
    expect(c.getState().error?.cause).toBe(noWebGL);
    const ev = events.filter((e) => e.type === 'error');
    expect(ev.length).toBe(1);
    expect((ev[0] as { cause: unknown }).cause).toBe(noWebGL);
    expect((ev[0] as { reason: unknown }).reason).toBe('start');
    c.dispose();
  });
});

describe('cause (#589)', () => {
  it('a worker that cannot be created: the browser error is the cause, in state, on the event and in the outcome', async () => {
    const csp = new Error("Refused to create a worker from 'blob:' (Content Security Policy)");
    csp.name = 'SecurityError';
    const { c, events } = bound({}, () => {
      throw csp;
    });
    const out = await c.parse(new Uint8Array(1_000));
    expect(c.getState().error?.code).toBe('E_WORKER_CREATE_FAILED');
    expect(c.getState().error?.cause).toBe(csp);
    expect(out.ok === false && !out.cancelled && out.error.cause).toBe(csp);
    const ev = events.find((e) => e.type === 'parse-error') as { cause?: unknown; reason?: unknown } | undefined;
    expect(ev?.cause).toBe(csp);
    expect(ev !== undefined && 'reason' in ev).toBe(false); // reason is for E_RENDERER_LOAD only
    c.dispose();
  });

  it('an error with no underlying error has no cause key at all', async () => {
    // The worker itself reports the failure: a ParseSessionError with no cause.
    class FailingWorker extends SuiteStubWorker {
      override postMessage(msg: unknown): void {
        const m = msg as { type: string; id: number; v: number };
        if (m.type !== 'parse') return;
        void Promise.resolve().then(() =>
          this.onmessage?.({
            data: { v: m.v, type: 'error', id: m.id, error: { code: 'E_LIMIT', message: 'too big' } }
          })
        );
      }
    }
    const { c, events } = bound({}, () => new FailingWorker());
    const out = await c.parse(new Uint8Array(1_000));
    expect(out).toEqual({ ok: false, error: { code: 'E_LIMIT', message: 'too big' } });
    expect(Object.keys(c.getState().error ?? {}).join(',')).toBe('code,message');
    const ev = events.find((e) => e.type === 'parse-error');
    expect(Object.keys(ev ?? {}).join(',')).toBe('type,code,message');
    c.dispose();
  });

  it('structuredClone(state) keeps an Error cause, and throws DataCloneError for one it cannot clone', async () => {
    // Documented as "for reading, not persisting": pin both sides so a change to that is deliberate.
    const { c } = bound({}, () => {
      throw new Error('blocked');
    });
    await c.parse(new Uint8Array(1_000));
    const copy = structuredClone(c.getState());
    expect((copy.error?.cause as Error).message).toBe('blocked');

    const odd = bound({}, () => {
      throw () => 'a function is not cloneable';
    });
    await odd.c.parse(new Uint8Array(1_000));
    expect(typeof odd.c.getState().error?.cause).toBe('function');
    let name = 'none';
    try {
      structuredClone(odd.c.getState());
    } catch (err) {
      name = (err as Error).name;
    }
    expect(name).toBe('DataCloneError');
    c.dispose();
    odd.c.dispose();
  });
});
