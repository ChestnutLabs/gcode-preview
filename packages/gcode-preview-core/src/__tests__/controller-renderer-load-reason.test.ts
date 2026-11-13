// @vitest-environment happy-dom
/**
 * #589: when the 3D renderer's code can't be downloaded (offline, or a stale deploy whose chunk now 404s),
 * E_RENDERER_LOAD says `reason: 'load'` and keeps the import's error on `cause`. The main entry is mocked to fail.
 */
import { describe, expect, it, vi } from 'vitest';
import { createPreviewController, type PreviewEvent } from '../index';
import { SuiteStubWorker } from '../testing';

const { chunkError } = vi.hoisted(() => ({
  chunkError: new Error('Failed to fetch dynamically imported module: /assets/three-abc123.js')
}));

vi.mock('@chestnutlabs/gcode-renderer-three', () => {
  throw chunkError;
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

function make(): { c: ReturnType<typeof createPreviewController>; events: PreviewEvent[] } {
  const c = createPreviewController({ createWorker: () => new SuiteStubWorker() });
  const events: PreviewEvent[] = [];
  c.onEvent((e) => events.push(e));
  return { c, events };
}

describe('E_RENDERER_LOAD reason: load (#589)', () => {
  it("is reason 'load', with the import's error as cause, in state and on the one error event", async () => {
    const { c, events } = make();
    c.bindCanvas(document.createElement('canvas'));
    await vi.waitFor(() => expect(c.getState().error).not.toBeNull());
    const error = c.getState().error!;
    expect(error.code).toBe('E_RENDERER_LOAD');
    expect(error.reason).toBe('load');
    // Vitest wraps a mock factory's throw; the import's rejection is the cause whatever it is.
    const cause = error.cause as Error & { cause?: unknown };
    expect(cause instanceof Error).toBe(true);
    expect(error.message).toBe(cause.message);
    const ev = events.filter((e) => e.type === 'error');
    expect(ev.length).toBe(1);
    expect(ev[0]).toMatchObject({ type: 'error', code: 'E_RENDERER_LOAD', reason: 'load' });
    expect((ev[0] as { cause?: unknown }).cause).toBe(cause);
    c.dispose();
  });

  it('a load superseded by a rebind reports once, for the current bind only', async () => {
    const { c, events } = make();
    const canvas = document.createElement('canvas');
    c.bindCanvas(canvas);
    c.bindCanvas(canvas); // the first load is now stale; only the second may report
    await vi.waitFor(() => expect(c.getState().error).not.toBeNull());
    await settle();
    expect(events.filter((e) => e.type === 'error').length).toBe(1);
    c.dispose();
  });

  it('a load that settles after dispose reports nothing', async () => {
    const { c, events } = make();
    c.bindCanvas(document.createElement('canvas'));
    c.dispose();
    await settle();
    expect(events.filter((e) => e.type === 'error').length).toBe(0);
    expect(c.getState().error).toBeNull();
  });
});
