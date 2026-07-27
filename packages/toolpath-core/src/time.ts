/**
 * Kinematic time axis over the IR (#181) — a per-segment duration model for a time readout and
 * time-based scrubbing, derived from geometry the IR already carries.
 *
 * Each segment's duration is its 3D length divided by its feedrate (`feedrate` is mm/min). This is a
 * **kinematic estimate**: constant-velocity per segment, NOT acceleration/jerk-aware, so it slightly
 * *under*estimates real print time. A segment with an unknown feedrate (NaN, before the first `F`)
 * contributes zero and flags the estimate as approximate — never a fabricated duration. When the
 * slicer's own estimate is available (`DialectMetadata.printEstimate`, #183), prefer it; this is the
 * honest fallback and the axis time-scrub always needs.
 */
import type { ToolpathIR } from './ir.js';

export interface ToolpathTime {
  /** Cumulative END time (ms) of each segment; length = `segments.count`, monotonic non-decreasing. */
  cumulativeMs: Float64Array;
  /** Total kinematic duration (ms). */
  totalMs: number;
  /**
   * True if any moving segment had an unknown feedrate (contributed 0). The estimate is then a lower
   * bound / approximate — a consumer should disclose it (and prefer the slicer estimate when present).
   */
  hasUnknownFeedrate: boolean;
}

/** Build the cumulative kinematic time axis for `ir`. O(segments), no allocation beyond the axis. */
export function computeToolpathTime(ir: ToolpathIR): ToolpathTime {
  const seg = ir.segments;
  const n = seg.count;
  const cumulativeMs = new Float64Array(n);
  let t = 0;
  let hasUnknownFeedrate = false;
  for (let i = 0; i < n; i++) {
    const dx = seg.x1[i] - seg.x0[i];
    const dy = seg.y1[i] - seg.y0[i];
    const dz = seg.z1[i] - seg.z0[i];
    const dist = Math.hypot(dx, dy, dz);
    const f = seg.feedrate[i]; // mm/min
    if (Number.isFinite(f) && f > 0) {
      t += dist / (f / 60000); // mm ÷ (mm/ms) = ms
    } else if (dist > 0) {
      hasUnknownFeedrate = true;
    }
    cumulativeMs[i] = t;
  }
  return { cumulativeMs, totalMs: t, hasUnknownFeedrate };
}

/**
 * The number of segments completed at time `ms` — i.e. the count of segments whose cumulative END
 * time is ≤ `ms` (binary search). 0 before the first segment finishes; `count` at/after the end. This
 * is exactly a scrub cut position (segments `[0, result)` are done), so it maps straight to a
 * segment-index scrub.
 */
export function segmentsCompletedAtTime(cumulativeMs: Float64Array, ms: number): number {
  let lo = 0;
  let hi = cumulativeMs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cumulativeMs[mid] <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
