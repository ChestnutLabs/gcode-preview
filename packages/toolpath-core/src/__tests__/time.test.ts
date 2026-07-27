/**
 * Kinematic time axis (#181): per-segment duration = length ÷ feedrate, cumulative. Constant-velocity
 * (not accel-aware) and honest about unknown feedrates (contribute 0, flagged approximate).
 */
import { describe, expect, it } from 'vitest';
import { MoveKind } from '../ir.js';
import { ToolpathIRBuilder } from '../builder.js';
import { computeToolpathTime, segmentsCompletedAtTime } from '../time.js';

/** N collinear X segments of `lengthMm` each at `feedrate` mm/min (undefined → unknown). */
function lineIR(segs: { lengthMm: number; feedrate?: number }[]) {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  let x = 0;
  for (const s of segs) {
    b.addSegment({
      x0: x,
      y0: 0,
      z0: 0.2,
      x1: x + s.lengthMm,
      y1: 0,
      z1: 0.2,
      e: 1,
      kind: MoveKind.Extrude,
      layer: 0,
      srcByte: x,
      feedrate: s.feedrate
    });
    x += s.lengthMm;
  }
  return b.finalize();
}

describe('computeToolpathTime', () => {
  it('duration = length ÷ feedrate; cumulative; total', () => {
    // 10 mm at 600 mm/min = 0.01 mm/ms → 1000 ms per segment.
    const t = computeToolpathTime(
      lineIR([
        { lengthMm: 10, feedrate: 600 },
        { lengthMm: 10, feedrate: 600 }
      ])
    );
    expect(Array.from(t.cumulativeMs)).toEqual([1000, 2000]);
    expect(t.totalMs).toBe(2000);
    expect(t.hasUnknownFeedrate).toBe(false);
  });

  it('faster feedrate → shorter duration', () => {
    // 10 mm at 1200 mm/min = 500 ms.
    const t = computeToolpathTime(lineIR([{ lengthMm: 10, feedrate: 1200 }]));
    expect(t.totalMs).toBe(500);
  });

  it('unknown feedrate contributes 0 and flags approximate', () => {
    const t = computeToolpathTime(lineIR([{ lengthMm: 10, feedrate: 600 }, { lengthMm: 10 }]));
    expect(t.totalMs).toBe(1000); // second segment contributes 0
    expect(t.hasUnknownFeedrate).toBe(true);
  });
});

describe('segmentsCompletedAtTime', () => {
  const cum = Float64Array.from([1000, 2000, 3000]);
  it('counts segments whose end time ≤ ms (a scrub cut position)', () => {
    expect(segmentsCompletedAtTime(cum, 0)).toBe(0);
    expect(segmentsCompletedAtTime(cum, 999)).toBe(0);
    expect(segmentsCompletedAtTime(cum, 1000)).toBe(1);
    expect(segmentsCompletedAtTime(cum, 2500)).toBe(2);
    expect(segmentsCompletedAtTime(cum, 3000)).toBe(3);
    expect(segmentsCompletedAtTime(cum, 9999)).toBe(3);
  });
});
