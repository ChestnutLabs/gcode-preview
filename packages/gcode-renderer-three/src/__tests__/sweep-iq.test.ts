/**
 * Renderer-three sweep 4, PR-B — InteractionQualityController: streak bookkeeping, pause/restart, settle timer
 * ownership, and scheduler hand-off. Literal expectations only; `frames()` is one `change` + one rAF tick.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InteractionQualityController } from '../interaction-quality.js';

function make(opts: { scheduler?: 'injected' | 'none' } = {}) {
  const calls = { render: 0, ratios: [] as number[], cancelled: [] as unknown[], requested: 0 };
  let next = 1;
  let pending: ((t: number) => void) | null = null;
  const deps = {
    setPixelRatio: (r: number) => calls.ratios.push(r),
    render: () => calls.render++,
    getPixelRatio: () => 1,
    ...(opts.scheduler === 'none'
      ? {}
      : {
          requestFrame: (cb: (t: number) => void) => {
            pending = cb;
            calls.requested++;
            return next++;
          },
          cancelFrame: (h: number) => {
            calls.cancelled.push(h);
            pending = null;
          }
        })
  };
  const c = new InteractionQualityController(deps, 'auto');
  const tick = (t: number) => {
    const cb = pending;
    pending = null;
    cb?.(t);
  };
  /** Frames at gap-spaced timestamps from 1000: the first is the baseline, each later one is one sample. */
  const gaps = (dts: number[]) => {
    let t = 1000;
    c.onFrame();
    tick(t);
    for (const dt of dts) {
      t += dt;
      c.onFrame();
      tick(t);
    }
    c.onFrame(); // a step in the factor is applied by the NEXT interaction frame
  };
  return { c, calls, tick, gaps };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('hysteresis: a different kind of sample resets the opposite streak', () => {
  it('fast, fast, slow, fast does not step (slow clears the fast streak)', () => {
    const h = make();
    h.gaps([10, 10, 30, 10]);
    expect(h.calls.ratios).toEqual([0.6]);
  });
  it('slow, slow, fast, slow does not step (fast clears the slow streak)', () => {
    const h = make();
    h.gaps([30, 30, 10, 30]);
    expect(h.calls.ratios).toEqual([0.6]);
  });
  it('fast, fast, in-budget, fast does not step (an in-budget sample clears the fast streak)', () => {
    const h = make();
    h.gaps([10, 10, 20, 10]);
    expect(h.calls.ratios).toEqual([0.6]);
  });
  it('slow, slow, in-budget, slow does not step (an in-budget sample clears the slow streak)', () => {
    const h = make();
    h.gaps([30, 30, 20, 30]);
    expect(h.calls.ratios).toEqual([0.6]);
  });
});

describe('hysteresis: a step consumes its streak', () => {
  it('3 slow samples step down once; a 4th alone does not step again', () => {
    const h = make();
    h.gaps([30, 30, 30, 30]);
    expect(h.calls.ratios).toHaveLength(2);
    expect(h.calls.ratios[1]).toBeCloseTo(0.45, 10);
  });
  it('3 fast samples step up once; a 4th alone does not step again', () => {
    const h = make();
    h.gaps([10, 10, 10, 10]);
    expect(h.calls.ratios).toHaveLength(2);
    expect(h.calls.ratios[1]).toBeCloseTo(0.75, 10);
  });
});

describe('the fast edge of the budget', () => {
  it('17.5 ms frames count as fast (the edge is 18, not 17)', () => {
    const h = make();
    h.gaps([17.5, 17.5, 17.5]);
    expect(h.calls.ratios).toHaveLength(2);
    expect(h.calls.ratios[1]).toBeCloseTo(0.75, 10);
  });
});

describe('streaks start from zero at each gesture', () => {
  it('two slow samples in one gesture + one in the next do not step', () => {
    vi.useFakeTimers();
    const h = make();
    h.gaps([30, 30]); // streak 2
    h.c.settle();
    vi.advanceTimersByTime(150); // restored: ratios [0.6, 1]
    h.gaps([30]);
    expect(h.calls.ratios).toEqual([0.6, 1, 0.6]);
  });
  it('two fast samples in one gesture + one in the next do not step', () => {
    vi.useFakeTimers();
    const h = make();
    h.gaps([10, 10]);
    h.c.settle();
    vi.advanceTimersByTime(150);
    h.gaps([10]);
    expect(h.calls.ratios).toEqual([0.6, 1, 0.6]);
  });
});

function twoFast(h: ReturnType<typeof make>) {
  for (const t of [1000, 1010, 1020]) {
    h.c.onFrame();
    h.tick(t);
  }
}

describe('pause and restart', () => {
  it('a pause (6 empty frames) clears the fast streak: 2 fast + pause + 1 fast does not step', () => {
    const h = make();
    twoFast(h);
    for (let t = 1030; t <= 1080; t += 10) h.tick(t); // 6 frames with no interaction render
    const requested = h.calls.requested;
    h.c.onFrame(); // restarts the sampler
    expect(h.calls.requested).toBe(requested + 1);
    h.tick(2000);
    h.c.onFrame();
    h.tick(2010); // one fast sample
    h.c.onFrame();
    expect(h.calls.ratios).toEqual([0.6]);
  });
  it('5 empty frames are not yet a pause: the streak survives (2 fast + 5 empty + 1 fast steps up)', () => {
    const h = make();
    twoFast(h);
    for (let t = 1030; t <= 1070; t += 10) h.tick(t); // 5 empty frames
    h.c.onFrame();
    h.tick(1080);
    h.c.onFrame();
    expect(h.calls.ratios).toHaveLength(2);
    expect(h.calls.ratios[1]).toBeCloseTo(0.75, 10);
  });
});

describe('settle timer ownership', () => {
  it('a new interaction frame cancels the pending settle: no restore mid-gesture', () => {
    vi.useFakeTimers();
    const h = make();
    h.c.onFrame();
    h.c.settle();
    vi.advanceTimersByTime(100);
    h.c.onFrame();
    vi.advanceTimersByTime(100); // 200 ms after the first settle
    expect(h.calls.ratios).toEqual([0.6]);
    h.c.settle();
    vi.advanceTimersByTime(150);
    expect(h.calls.ratios).toEqual([0.6, 1]);
  });
  it('dispose cancels the pending settle', () => {
    vi.useFakeTimers();
    const h = make();
    h.c.onFrame();
    h.c.settle();
    const renders = h.calls.render;
    h.c.dispose();
    vi.advanceTimersByTime(300);
    expect(h.calls.render).toBe(renders);
    expect(h.calls.ratios).toEqual([0.6]);
  });
});

describe('no injected scheduler: the global rAF is used and only its own handles are cancelled', () => {
  it('cancels the global handle it was given', () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', () => 77);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const h = make({ scheduler: 'none' });
    h.c.onFrame();
    h.c.settle();
    vi.advanceTimersByTime(150);
    expect(cancel.mock.calls).toEqual([[77]]);
  });
  it('with no scheduler at all there is nothing to cancel (no cancel call with a null handle)', () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const h = make({ scheduler: 'none' });
    h.c.onFrame();
    h.c.settle();
    vi.advanceTimersByTime(150);
    expect(cancel).not.toHaveBeenCalled();
    expect(h.calls.ratios).toEqual([0.6, 1]);
  });
});
