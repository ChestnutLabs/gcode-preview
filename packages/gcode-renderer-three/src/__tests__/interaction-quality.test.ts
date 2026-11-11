import { describe, expect, it, vi } from 'vitest';
import { InteractionQualityController, type InteractionQualityDeps } from '../interaction-quality.js';

/**
 * A deterministic harness: a manual frame queue stands in for requestAnimationFrame (fed literal
 * timestamps), and `getPixelRatio` reports a configurable resting ratio. All expected values are
 * literals (DD-020 + #435), never the module's own constants.
 */
function makeController(
  mode: 'off' | 'auto' = 'off',
  opts: { base?: number; noScheduler?: boolean; noCancel?: boolean } = {}
) {
  const calls = { render: 0, ratios: [] as number[], cancelled: [] as number[], requested: 0 };
  let base = opts.base;
  let nextHandle = 1;
  const queue = new Map<number, (t: number) => void>();
  const deps: InteractionQualityDeps = {
    setPixelRatio: (r) => calls.ratios.push(r),
    render: () => calls.render++,
    ...(base !== undefined ? { getPixelRatio: () => base! } : {}),
    ...(opts.noScheduler
      ? {}
      : {
          requestFrame: (cb: (t: number) => void) => {
            const h = nextHandle++;
            queue.set(h, cb);
            calls.requested++;
            return h;
          },
          ...(opts.noCancel
            ? {}
            : {
                cancelFrame: (h: number) => {
                  calls.cancelled.push(h);
                  queue.delete(h);
                }
              })
        })
  };
  const c = new InteractionQualityController(deps, mode);
  /** Run the pending frame callback (if any) at timestamp `t`. */
  const tick = (t: number) => {
    const entries = [...queue.entries()];
    queue.clear();
    for (const [, cb] of entries) cb(t);
  };
  /** One interaction frame per vsync: a `change` (onFrame) followed by the rAF tick at time `t`. */
  const frames = (times: number[]) => {
    for (const t of times) {
      c.onFrame();
      tick(t);
    }
  };
  return {
    c,
    calls,
    tick,
    frames,
    pending: () => queue.size,
    setBase: (b: number) => (base = b)
  };
}

/** Timestamps spaced `dt` ms apart, `n` of them, starting at 1000. */
const spaced = (n: number, dt: number) => Array.from({ length: n }, (_, i) => 1000 + i * dt);

describe('InteractionQualityController', () => {
  it("default 'off': onFrame renders but never touches the pixel ratio nor schedules frames", () => {
    const h = makeController('off', { base: 2 });
    h.c.onFrame();
    h.c.onFrame();
    expect(h.calls.render).toBe(2);
    expect(h.calls.ratios).toHaveLength(0);
    expect(h.calls.requested).toBe(0);
  });

  it("'auto': a gesture frame proactively reduces to 0.6 × the renderer's own ratio", () => {
    const h = makeController('auto', { base: 2 });
    h.c.onFrame();
    expect(h.calls.render).toBe(1);
    expect(h.calls.ratios).toEqual([1.2]);
  });

  it('without getPixelRatio the resting ratio defaults to 1', () => {
    const h = makeController('auto');
    h.c.onFrame();
    expect(h.calls.ratios).toEqual([0.6]);
  });

  it('settle restores exactly the custom resting ratio (not devicePixelRatio) after the debounce', () => {
    vi.useFakeTimers();
    try {
      const h = makeController('auto', { base: 1.5 });
      h.c.onFrame();
      h.c.settle();
      vi.advanceTimersByTime(149);
      expect(h.calls.ratios).toHaveLength(1);
      expect(h.calls.ratios[0]).toBeCloseTo(0.9, 10);
      vi.advanceTimersByTime(1);
      expect(h.calls.ratios.at(-1)).toBe(1.5);
      expect(h.calls.render).toBe(2); // gesture frame + the settle repaint
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-reads the resting ratio at every gesture start', () => {
    vi.useFakeTimers();
    try {
      const h = makeController('auto', { base: 1 });
      h.c.onFrame();
      h.c.settle();
      vi.advanceTimersByTime(150);
      h.setBase(2); // the consumer changed the renderer's ratio between gestures
      h.c.onFrame();
      expect(h.calls.ratios.at(-1)).toBe(1.2);
      h.c.settle();
      vi.advanceTimersByTime(150);
      expect(h.calls.ratios.at(-1)).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('setPixelRatio is called only when the ratio changes, not on every pointer move', () => {
    const h = makeController('auto', { base: 2 });
    h.c.onFrame();
    h.c.onFrame();
    h.c.onFrame();
    expect(h.calls.ratios).toEqual([1.2]);
    expect(h.calls.render).toBe(3);
  });

  it("a gesture's first reduction is applied even if it equals the previous gesture's resting ratio", () => {
    vi.useFakeTimers();
    try {
      const h = makeController('auto', { base: 1.2 });
      h.c.onFrame();
      h.c.settle();
      vi.advanceTimersByTime(150); // last applied: 1.2
      h.setBase(2); // consumer raised the renderer's ratio; 2 × 0.6 = 1.2 again
      h.c.onFrame();
      expect(h.calls.ratios).toHaveLength(3);
      expect(h.calls.ratios.slice(1)).toEqual([1.2, 1.2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("setMode('off') before any gesture leaves a custom ratio untouched", () => {
    const h = makeController('auto', { base: 1.5 });
    h.c.setMode('off');
    expect(h.calls.ratios).toHaveLength(0);
    expect(h.calls.render).toBe(0);
  });

  it("setMode('off') mid-gesture restores the resting ratio immediately and stops adapting", () => {
    const h = makeController('auto', { base: 2 });
    h.c.onFrame();
    expect(h.pending()).toBe(1);
    h.c.setMode('off');
    expect(h.calls.ratios).toEqual([1.2, 2]);
    expect(h.pending()).toBe(0); // sampler cancelled
    h.calls.ratios.length = 0;
    h.c.onFrame(); // off → renders, no ratio change
    expect(h.calls.ratios).toHaveLength(0);
  });

  it("setMode('off') with a settle pending restores at once and the timer never fires", () => {
    vi.useFakeTimers();
    try {
      const h = makeController('auto', { base: 2 });
      h.c.onFrame();
      h.c.settle();
      h.c.setMode('off');
      expect(h.calls.ratios).toEqual([1.2, 2]);
      const renders = h.calls.render;
      vi.advanceTimersByTime(500);
      expect(h.calls.render).toBe(renders);
    } finally {
      vi.useRealTimers();
    }
  });

  it('three consecutive slow frame intervals (>22 ms) step one notch coarser', () => {
    const h = makeController('auto', { base: 1 });
    // First tick is the baseline (discarded); then 3 intervals of 30 ms.
    h.frames(spaced(4, 30));
    expect(h.calls.ratios).toEqual([0.6]); // the step applies on the next frame
    h.c.onFrame();
    expect(h.calls.ratios.at(-1)).toBeCloseTo(0.45, 10);
  });

  it('two slow intervals are not enough — one hitch never flips detail', () => {
    const h = makeController('auto', { base: 1 });
    h.frames(spaced(3, 30)); // baseline + 2 slow intervals
    h.c.onFrame();
    expect(h.calls.ratios).toEqual([0.6]);
  });

  it('the first tick is only a baseline: a long gap before it is not counted', () => {
    const h = makeController('auto', { base: 1 });
    // Baseline at 1000, then intervals 30, 30 (slow) and 16 (fast) — if the first tick counted
    // (interval from 0 → 1000) there would be 3 slow samples.
    h.frames([1000, 1030, 1060, 1076]);
    h.c.onFrame();
    expect(h.calls.ratios).toEqual([0.6]);
  });

  it('exactly 22 ms is not slow; 23 ms is', () => {
    const at22 = makeController('auto', { base: 1 });
    at22.frames(spaced(4, 22));
    at22.c.onFrame();
    expect(at22.calls.ratios).toEqual([0.6]);

    const at23 = makeController('auto', { base: 1 });
    at23.frames(spaced(4, 23));
    at23.c.onFrame();
    expect(at23.calls.ratios.at(-1)).toBeCloseTo(0.45, 10);
  });

  it('three fast intervals (<18 ms) step finer; exactly 18 ms is neutral', () => {
    const fast = makeController('auto', { base: 1 });
    fast.frames(spaced(4, 16.7));
    fast.c.onFrame();
    expect(fast.calls.ratios.at(-1)).toBeCloseTo(0.75, 10);

    const at18 = makeController('auto', { base: 1 });
    at18.frames(spaced(4, 18));
    at18.c.onFrame();
    expect(at18.calls.ratios).toEqual([0.6]);
  });

  it('a neutral interval breaks a slow streak', () => {
    const h = makeController('auto', { base: 1 });
    // baseline, slow, slow, neutral (20), slow, slow → never 3 consecutive slow.
    h.frames([1000, 1030, 1060, 1080, 1110, 1140]);
    h.c.onFrame();
    expect(h.calls.ratios).toEqual([0.6]);
  });

  it('a slow GPU drives the factor down to the 0.4 floor and holds it', () => {
    const h = makeController('auto', { base: 2 });
    h.frames(spaced(1 + 3 * 6, 40)); // six slow streaks
    h.c.onFrame();
    expect(h.calls.ratios.at(-1)).toBeCloseTo(0.8, 10); // 2 × 0.4
    expect(Math.min(...h.calls.ratios)).toBeCloseTo(0.8, 10);
  });

  it('a fast GPU climbs back to full detail and is clamped at 1 × base', () => {
    const h = makeController('auto', { base: 2 });
    h.frames(spaced(1 + 3 * 6, 8)); // six fast streaks
    h.c.onFrame();
    expect(h.calls.ratios.at(-1)).toBe(2);
    expect(Math.max(...h.calls.ratios)).toBe(2);
  });

  it('input at half the display rate (60 Hz input, 120 Hz screen) on a fast GPU still climbs to full detail', () => {
    const h = makeController('auto', { base: 1 });
    // Ticks every 8.33 ms; a render lands before every other tick. Each empty tick re-baselines, so
    // every sample is one 8.33 ms rendered frame (fast) and the streaks survive the empty frames.
    for (let i = 0; i < 20; i++) {
      h.c.onFrame();
      h.tick(1000 + 2 * i * 8.33);
      h.tick(1000 + (2 * i + 1) * 8.33); // empty frame
    }
    h.c.onFrame();
    expect(h.calls.ratios.at(-1)).toBe(1);
    expect(h.calls.ratios.length).toBeGreaterThan(1);
  });

  it('an empty frame re-baselines: the sample is the one rendered frame (10 ms), not the pair (20 ms)', () => {
    const h = makeController('auto', { base: 1 });
    for (let i = 0; i < 4; i++) {
      h.c.onFrame();
      h.tick(1000 + 2 * i * 10);
      h.tick(1000 + (2 * i + 1) * 10); // empty frame
    }
    // baseline + 3 samples of 10 ms (fast) → one step up; 20 ms pairs would be neutral (no step).
    h.c.onFrame();
    expect(h.calls.ratios.at(-1)).toBeCloseTo(0.75, 10);
  });

  it('5 consecutive empty frames keep sampling and the streak; the next slow frame completes it', () => {
    const h = makeController('auto', { base: 1 });
    h.frames([1000, 1030, 1060]); // baseline + 2 slow
    for (let i = 1; i <= 5; i++) h.tick(1060 + i * 8); // empty frames, last re-baselines at 1100
    expect(h.pending()).toBe(1);
    h.frames([1130]); // slow (30 ms) → the 3rd in the streak
    h.c.onFrame();
    expect(h.calls.ratios.at(-1)).toBeCloseTo(0.45, 10);
  });

  it('6 consecutive empty frames are a pause: sampling stops and the streak resets', () => {
    const h = makeController('auto', { base: 1 });
    h.frames([1000, 1030, 1060]); // baseline + 2 slow
    for (let i = 1; i <= 6; i++) h.tick(1060 + i * 8);
    expect(h.pending()).toBe(0);
    // Resume much later: the gap must not count, and the earlier streak is not continued by one slow.
    h.frames([5000, 5030]);
    h.c.onFrame();
    expect(h.calls.ratios).toEqual([0.6]);
  });

  it('the pause count is consecutive: a rendered frame resets it', () => {
    const h = makeController('auto', { base: 1 });
    h.frames([1000]); // baseline
    let t = 1000;
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 3; i++) h.tick((t += 8)); // 3 empty frames (9 in total across the loop)
      h.frames([(t += 30)]); // one slow rendered frame
    }
    h.c.onFrame();
    expect(h.calls.ratios.at(-1)).toBeCloseTo(0.45, 10);
  });

  it('an injected requestFrame without cancelFrame never cancels through the global; a late tick is ignored', () => {
    vi.useFakeTimers();
    const saved = globalThis.cancelAnimationFrame;
    const globalCancels: number[] = [];
    globalThis.cancelAnimationFrame = ((id: number) => globalCancels.push(id)) as never;
    try {
      const h = makeController('auto', { base: 2, noCancel: true });
      h.c.onFrame();
      expect(h.pending()).toBe(1);
      h.c.settle();
      vi.advanceTimersByTime(150);
      expect(globalCancels).toEqual([]);
      const requested = h.calls.requested;
      h.tick(2000); // the uncancelled callback fires after the gesture ended
      expect(h.calls.requested).toBe(requested); // no re-arm
      expect(h.calls.ratios).toEqual([1.2, 2]);
    } finally {
      if (saved === undefined) delete (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame;
      else globalThis.cancelAnimationFrame = saved;
      vi.useRealTimers();
    }
  });

  it("without cancelFrame, a gesture restarted before the old loop's tick fires still runs exactly one loop", () => {
    vi.useFakeTimers();
    try {
      const h = makeController('auto', { base: 1, noCancel: true });
      h.c.onFrame(); // gesture A: loop 1 scheduled
      h.c.settle();
      vi.advanceTimersByTime(150); // A restored; loop 1's callback cannot be cancelled
      h.c.onFrame(); // gesture B starts before loop 1's tick fires: loop 2 scheduled
      expect(h.pending()).toBe(2);
      h.tick(1000); // both callbacks fire: the stale one exits, the live one re-arms
      expect(h.pending()).toBe(1);
      for (let i = 1; i <= 4; i++) {
        h.c.onFrame();
        h.tick(1000 + i * 16);
        expect(h.pending()).toBe(1); // never two loops
      }
      expect(h.calls.requested).toBe(7); // A:1 + B:1 + B re-arms on 5 ticks
    } finally {
      vi.useRealTimers();
    }
  });

  it('without a frame scheduler there is no adaptation — the 0.6 factor holds for the gesture', () => {
    const saved = globalThis.requestAnimationFrame;
    // @ts-expect-error — simulate a host without requestAnimationFrame
    delete globalThis.requestAnimationFrame;
    try {
      const h = makeController('auto', { base: 1, noScheduler: true });
      for (let i = 0; i < 10; i++) h.c.onFrame();
      expect(h.calls.ratios).toEqual([0.6]);
      expect(h.calls.render).toBe(10);
    } finally {
      if (saved !== undefined) globalThis.requestAnimationFrame = saved;
    }
  });

  it('falls back to the global requestAnimationFrame when no scheduler is injected', () => {
    const saved = globalThis.requestAnimationFrame;
    const cbs: Array<(t: number) => void> = [];
    globalThis.requestAnimationFrame = ((cb: (t: number) => void) => (cbs.push(cb), cbs.length)) as never;
    try {
      const h = makeController('auto', { base: 1, noScheduler: true });
      h.c.onFrame();
      expect(cbs).toHaveLength(1);
    } finally {
      globalThis.requestAnimationFrame = saved;
    }
  });

  it('settle cancels the sampler when the restore runs', () => {
    vi.useFakeTimers();
    try {
      const h = makeController('auto', { base: 1 });
      h.c.onFrame();
      expect(h.pending()).toBe(1);
      h.c.settle();
      vi.advanceTimersByTime(150);
      expect(h.pending()).toBe(0);
      expect(h.calls.cancelled).toEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispose clears a pending settle and the sampler so nothing fires afterwards', () => {
    vi.useFakeTimers();
    try {
      const h = makeController('auto', { base: 1 });
      h.c.onFrame();
      h.c.settle();
      h.c.dispose();
      expect(h.pending()).toBe(0);
      const renders = h.calls.render;
      vi.advanceTimersByTime(500);
      expect(h.calls.render).toBe(renders); // the settle callback never ran
    } finally {
      vi.useRealTimers();
    }
  });
});
