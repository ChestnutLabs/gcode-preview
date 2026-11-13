/*
 * Canned-cycle L repeat count. LinuxCNC g-code.html §43.6: the cycle runs L times; under G91 each repeat
 * steps by the X/Y increment (G81 Example 2: `G91 G98 G81 X4 Y5 Z-0.6 R1.8 L3` from (1,2,3) drills
 * (5,7), (9,12), (13,17), every hole at clear Z 4.8 / depth 4.2). L absent = once. L is not a length, so G20
 * must not scale it.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind } from '@chestnutlabs/toolpath-core';
import { parseGcodeToIR } from '../parse.js';

/** XY of every cutting (plunge) segment after the setup move, rounded to 4 decimals. */
function plunges(src: string): [number, number, number][] {
  const s = parseGcodeToIR(src).ir.segments;
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  const out: [number, number, number][] = [];
  for (let i = 0; i < s.count; i++) {
    if ((s.kind[i] & MoveKind.Cut) !== 0) out.push([r(s.x1[i]), r(s.y1[i]), r(s.z1[i])]);
  }
  return out;
}

const SETUP = 'G90\nG0 X1 Y2 Z3\nG98\n';

describe('canned cycle L repeats', () => {
  it('G91 G81 L3 drills three holes stepping by the increment (LinuxCNC Example 2)', () => {
    expect(plunges(SETUP + 'G91\nG81 X4 Y5 Z-0.6 R1.8 L3\n')).toEqual([
      [5, 7, 4.2],
      [9, 12, 4.2],
      [13, 17, 4.2]
    ]);
  });

  it('no L drills once', () => {
    expect(plunges(SETUP + 'G91\nG81 X4 Y5 Z-0.6 R1.8\n')).toEqual([[5, 7, 4.2]]);
  });

  it('L0 and a negative L drill once', () => {
    expect(plunges(SETUP + 'G91\nG81 X4 Y5 Z-0.6 R1.8 L0\n')).toEqual([[5, 7, 4.2]]);
    expect(plunges(SETUP + 'G91\nG81 X4 Y5 Z-0.6 R1.8 L-2\n')).toEqual([[5, 7, 4.2]]);
  });

  it('a fractional L truncates (L2.9 = 2)', () => {
    expect(plunges(SETUP + 'G91\nG81 X4 Y5 Z-0.6 R1.8 L2.9\n')).toHaveLength(2);
  });

  it('G90 L3 repeats the same hole in place', () => {
    expect(plunges(SETUP + 'G81 X5 Y7 Z4.2 R4.8 L3\n')).toEqual([
      [5, 7, 4.2],
      [5, 7, 4.2],
      [5, 7, 4.2]
    ]);
  });

  it('a bare G91 X/Y repeat honours its own L (planes re-derive per block from the current Z 4.8: R 6.6, depth 6)', () => {
    const src = SETUP + 'G91\nG81 X4 Y5 Z-0.6 R1.8\nX2 Y0 L2\n';
    expect(plunges(src)).toEqual([
      [5, 7, 4.2],
      [7, 7, 6],
      [9, 7, 6]
    ]);
  });

  it('G83 peck cycle repeats per L', () => {
    const src = SETUP + 'G91\nG83 X4 Y0 Z-3 R1 Q1 L2\n';
    const xs = plunges(src).map((p) => p[0]);
    expect(xs).toEqual([5, 5, 5, 9, 9, 9]);
  });

  it('L3 under G20 still repeats 3 times (L is not scaled)', () => {
    const rows = plunges('G20\nG90\nG0 X0 Y0 Z1\nG91\nG81 X1 Y0 Z-0.5 R0.1 L3\n');
    expect(rows.map((p) => p[0])).toEqual([25.4, 50.8, 76.2]);
  });

  it('a huge L stops at the segment limit instead of hanging', () => {
    const r = parseGcodeToIR(SETUP + 'G81 X5 Y7 Z4.2 R4.8 L999999999\n', { limits: { maxSegments: 100 } } as never);
    expect(r.ir.segments.count).toBeLessThanOrEqual(100);
  });
});
