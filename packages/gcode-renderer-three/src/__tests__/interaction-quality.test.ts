import { describe, expect, it, vi } from 'vitest';
import {
  InteractionQualityController,
  DEFAULT_INTERACTION_FACTOR,
  MIN_INTERACTION_FACTOR
} from '../interaction-quality.js';

// Node env (no `window`) → basePixelRatio resolves to 1, so ratios are deterministic.
function makeController(mode: 'off' | 'auto' = 'off') {
  const calls = { render: 0, ratios: [] as number[] };
  const c = new InteractionQualityController(
    { setPixelRatio: (r) => calls.ratios.push(r), render: () => calls.render++ },
    mode
  );
  return { c, calls };
}

describe('InteractionQualityController', () => {
  it("default 'off': onFrame renders but never touches the pixel ratio", () => {
    const { c, calls } = makeController('off');
    c.onFrame();
    c.onFrame();
    expect(calls.render).toBe(2);
    expect(calls.ratios).toHaveLength(0);
  });

  it("'auto': a gesture frame proactively reduces the pixel ratio below the base", () => {
    const { c, calls } = makeController('auto');
    c.onFrame();
    expect(calls.render).toBe(1);
    // base (1) × DEFAULT_INTERACTION_FACTOR
    expect(calls.ratios.at(-1)).toBeCloseTo(DEFAULT_INTERACTION_FACTOR);
    expect(calls.ratios.at(-1)!).toBeGreaterThanOrEqual(MIN_INTERACTION_FACTOR);
    expect(calls.ratios.at(-1)!).toBeLessThan(1);
  });

  it('settle restores the full base ratio after the debounce', () => {
    vi.useFakeTimers();
    try {
      const { c, calls } = makeController('auto');
      c.onFrame();
      const reduced = calls.ratios.at(-1)!;
      c.settle();
      vi.advanceTimersByTime(200);
      const restored = calls.ratios.at(-1)!;
      expect(reduced).toBeLessThan(restored);
      expect(restored).toBeCloseTo(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("setMode('off') restores full detail immediately and stops adapting", () => {
    const { c, calls } = makeController('auto');
    c.onFrame();
    const reduced = calls.ratios.at(-1)!;
    c.setMode('off');
    expect(calls.ratios.at(-1)).toBeCloseTo(1);
    calls.ratios.length = 0;
    c.onFrame(); // off → renders, no ratio change
    expect(calls.ratios).toHaveLength(0);
    expect(reduced).toBeLessThan(1);
  });

  it('adapts finer on fast frames — ratio climbs back toward the base, clamped at 1', () => {
    const { c, calls } = makeController('auto');
    for (let i = 0; i < 6; i++) c.onFrame(); // stub render is instant → dt < LO → factor increases
    // Monotonic non-decreasing, ending at the clamp.
    for (let i = 1; i < calls.ratios.length; i++) {
      expect(calls.ratios[i]).toBeGreaterThanOrEqual(calls.ratios[i - 1]);
    }
    expect(calls.ratios.at(-1)).toBeCloseTo(1);
  });

  it('dispose clears a pending settle so no restore fires afterwards', () => {
    vi.useFakeTimers();
    try {
      const { c, calls } = makeController('auto');
      c.onFrame();
      c.settle();
      c.dispose();
      const renders = calls.render;
      vi.advanceTimersByTime(500);
      expect(calls.render).toBe(renders); // the settle callback never ran
    } finally {
      vi.useRealTimers();
    }
  });
});
