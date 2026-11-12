/**
 * #525 fail-fast twin. Kept in its own file on purpose: if BOTH halves of the #525 fix regress, the 3e38
 * cases in arc-out-of-range.test.ts spin synchronously (no vitest timeout can interrupt that) and hold
 * their worker. This file runs in another worker and still reports the regression in milliseconds: the
 * same repro shape with a radius of 100 interpolates only ~1257 chords even with no fix at all.
 */
import { expect, it } from 'vitest';
import { parseGcodeToIR } from '../index';

const BIG = '3' + '0'.repeat(38); // 3e38, inside float32 (max 3.4028e38)

it('#525 repro shape with radius 100: the arc beyond float32 is dropped whole, not interpolated', () => {
  // G91 pushes the position to 6e38 (the second far move is dropped, the position advances), then G90 and
  // an arc of radius 100 around it: every point is beyond float32 from the origin.
  const src = `G91\nG1 X1 E1\nG1 X${BIG}\nG1 X${BIG}\nG90\nG2 I100 J0 E1\n`;
  const { ir, stats } = parseGcodeToIR(src, { limits: { maxSegments: 1000 } });
  const oor = ir.header.warnings.filter((w) => w.code === 'number-out-of-range');
  expect(ir.segments.count).toBe(2);
  expect(stats.stopReason).toBeUndefined();
  expect(oor).toHaveLength(1);
  expect(oor[0].count).toBe(2);
});
