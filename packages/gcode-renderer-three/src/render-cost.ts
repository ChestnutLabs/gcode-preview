/**
 * Render-cost estimate (DD-028 D4 / DD-029 Phase D). A cheap, capability-aware classifier of how
 * expensive a tube build is, used for two decisions from ONE estimate:
 *   - whether the geometry worker pool is worth engaging (vs the synchronous path), and
 *   - whether `progressivePreview:'auto'` should take the single-reveal `'hold'` path (vs streaming lines).
 *
 * It is deliberately a *relative* classifier, not a precise timer: absolute build speed varies ~10× across
 * machines, so the estimate scales with the real work (ring vertices) and the detected capability
 * (software rasterizers pay far more on the render/upload side), and the thresholds are calibrated from
 * the RR-008 Phase-0 measurements. Pure + `three`-free.
 */
import type { RenderCapability } from './capability.js';

/**
 * Rough per-ring-vertex tube-build cost in ns, calibrated from RR-008 Phase 0 (≈10.7 s for 2.67M
 * segments × 9 ring vertices on the maintainer dev box). Machine-relative — used only to CLASSIFY a
 * build as cheap/expensive, never surfaced as a real time.
 */
const NS_PER_RING_VERTEX = 445;

/**
 * Estimated serial tube-build cost (a machine-relative ms proxy) for `extrudeSegments` at
 * `radialSegments`, weighted by capability — a software rasterizer pays much more on the per-frame
 * render + upload side, so its effective cost is scaled up (engages the pool + single reveal sooner).
 */
export function estimateTubeBuildMs(
  extrudeSegments: number,
  radialSegments: number,
  capability: RenderCapability
): number {
  const ringVertices = extrudeSegments * (radialSegments + 1);
  const base = (ringVertices * NS_PER_RING_VERTEX) / 1e6;
  const capFactor = capability === 'software' ? 3 : 1;
  return base * capFactor;
}

/** Engage the pool when the estimated serial build would stall past this (worth the worker overhead). */
export const POOL_ENGAGE_MS = 250;

/** In `'auto'`, prefer a single clean reveal when a tube build (+ its repeated intermediate renders) is
 *  at least this expensive; below it, stream the progressive line overview. */
export const SINGLE_REVEAL_MS = 250;
