/**
 * DD-028 D4 / DD-029 Phase D — the render-cost estimate that drives pool activation + the auto
 * lines-vs-hold decision. A relative classifier (not a precise timer): monotonic in work, heavier for
 * software rasterizers, and calibrated so a small build is under the engage/reveal threshold.
 */
import { describe, expect, it } from 'vitest';
import { estimateTubeBuildMs, POOL_ENGAGE_MS, SINGLE_REVEAL_MS } from '../render-cost.js';

describe('estimateTubeBuildMs (DD-028/DD-029)', () => {
  it('is monotonic in segments and cross-section, and heavier for software rasterizers', () => {
    expect(estimateTubeBuildMs(100_000, 8, 'hardware')).toBeGreaterThan(estimateTubeBuildMs(10_000, 8, 'hardware'));
    expect(estimateTubeBuildMs(100_000, 16, 'hardware')).toBeGreaterThan(estimateTubeBuildMs(100_000, 8, 'hardware'));
    // Software pays more on the render/upload side → weighted heavier than hardware/unknown.
    expect(estimateTubeBuildMs(100_000, 8, 'software')).toBeGreaterThan(estimateTubeBuildMs(100_000, 8, 'hardware'));
    expect(estimateTubeBuildMs(100_000, 8, 'unknown')).toBe(estimateTubeBuildMs(100_000, 8, 'hardware'));
    expect(estimateTubeBuildMs(0, 8, 'hardware')).toBe(0);
  });

  it('classifies a tiny build below the engage/reveal threshold and a large one above (hardware)', () => {
    expect(estimateTubeBuildMs(2_000, 8, 'hardware')).toBeLessThan(POOL_ENGAGE_MS);
    expect(estimateTubeBuildMs(2_000, 8, 'hardware')).toBeLessThan(SINGLE_REVEAL_MS);
    expect(estimateTubeBuildMs(500_000, 8, 'hardware')).toBeGreaterThan(POOL_ENGAGE_MS);
    expect(estimateTubeBuildMs(500_000, 8, 'hardware')).toBeGreaterThan(SINGLE_REVEAL_MS);
    // A software client crosses the threshold sooner than hardware for the same work.
    const segs = 30_000;
    expect(estimateTubeBuildMs(segs, 8, 'software')).toBeGreaterThan(estimateTubeBuildMs(segs, 8, 'hardware'));
  });
});
