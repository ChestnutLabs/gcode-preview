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

  it.each(['L0', 'L-2', 'L1.5', 'L2.9', 'L0.5'])('%s draws once and warns canned-cycle-bad-repeat', (word) => {
    const src = SETUP + `G91\nG81 X4 Y5 Z-0.6 R1.8 ${word}\n`;
    expect(plunges(src)).toEqual([[5, 7, 4.2]]);
    const w = parseGcodeToIR(src).ir.header.warnings.filter((x) => x.code === 'canned-cycle-bad-repeat');
    expect(w).toHaveLength(1);
    expect(w[0].message).toBe(`L${word.slice(1)} is not a positive integer repeat count; the cycle runs once.`);
  });

  it('a valid or absent L raises no repeat warning', () => {
    for (const src of [
      SETUP + 'G91\nG81 X4 Y5 Z-0.6 R1.8 L3\n',
      SETUP + 'G91\nG81 X4 Y5 Z-0.6 R1.8 L1\n',
      SETUP + 'G91\nG81 X4 Y5 Z-0.6 R1.8\n'
    ]) {
      const codes = parseGcodeToIR(src).ir.header.warnings.map((x) => x.code);
      expect(codes).not.toContain('canned-cycle-bad-repeat');
      expect(codes).not.toContain('canned-cycle-repeat-limit');
    }
  });

  it('the bad-repeat warning is deduped by code and counts every occurrence', () => {
    const src = SETUP + 'G91\nG81 X4 Y5 Z-0.6 R1.8 L0\nX1 L-1\nX1 L1.5\n';
    const w = parseGcodeToIR(src).ir.header.warnings.filter((x) => x.code === 'canned-cycle-bad-repeat');
    expect(w).toHaveLength(1);
    expect(w[0].count).toBe(3);
    expect(plunges(src)).toHaveLength(3);
  });

  it('G90 L3 lifts to the R plane once, not once per repeat (LinuxCNC: only once, regardless of L)', () => {
    // Start at Z3, below R 4.8: one preliminary rapid up to 4.8 at the old XY, then three holes.
    const s = parseGcodeToIR(SETUP + 'G81 X5 Y7 Z4.2 R4.8 L3\n').ir.segments;
    const rows: string[] = [];
    for (let i = 0; i < s.count; i++) {
      rows.push(
        `${s.kind[i] & MoveKind.Cut ? 'C' : 'T'}:${+s.x1[i].toFixed(3)},${+s.y1[i].toFixed(3)},${+s.z1[i].toFixed(3)}`
      );
    }
    // segment 0 is the G0 setup move; the rest is the cycle.
    expect(rows.slice(1)).toEqual([
      'T:1,2,4.8', // preliminary Z-up, old XY
      'T:5,7,4.8', // hole 1: rapid to XY
      'T:5,7,4.8', // rapid to R (zero length, kept)
      'C:5,7,4.2', // plunge
      'T:5,7,4.8', // retract
      'T:5,7,4.8', // hole 2: XY (no move), R, plunge, retract: no second Z-up
      'T:5,7,4.8',
      'C:5,7,4.2',
      'T:5,7,4.8',
      'T:5,7,4.8',
      'T:5,7,4.8',
      'C:5,7,4.2',
      'T:5,7,4.8'
    ]);
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

  it('L1e9 on a zero-length hole finishes fast, bounded by maxProgramIterations, with a warning', () => {
    // Z == R == depth at the current XY: every move of the hole is zero-length.
    const src = 'G90\nG0 X1 Y1 Z2\nG81 X1 Y1 Z2 R2 L1000000000\n';
    const t0 = Date.now();
    const r = parseGcodeToIR(src, { limits: { maxProgramIterations: 50 } } as never);
    expect(Date.now() - t0).toBeLessThan(2000);
    const w = r.ir.header.warnings.filter((x) => x.code === 'canned-cycle-repeat-limit');
    expect(w).toHaveLength(1);
    expect(w[0].message).toBe('L1000000000 exceeds the program iteration limit 50; the cycle repeats 50 times.');
    expect(r.ir.segments.count).toBeLessThanOrEqual(1 + 50 * 4);
  });

  it('L equal to maxProgramIterations repeats fully with no limit warning; one more is clamped', () => {
    const base = 'G90\nG0 X0 Y0 Z5\nG81 X0 Y0 Z4 R4.5 ';
    const opts = { limits: { maxProgramIterations: 4 } } as never;
    const at = parseGcodeToIR(base + 'L4\n', opts);
    expect(at.ir.header.warnings.map((x) => x.code)).not.toContain('canned-cycle-repeat-limit');
    const over = parseGcodeToIR(base + 'L5\n', opts);
    expect(over.ir.header.warnings.map((x) => x.code)).toContain('canned-cycle-repeat-limit');
    expect(over.ir.segments.count).toBe(at.ir.segments.count);
  });

  it('a huge L stops at the segment limit instead of hanging', () => {
    const r = parseGcodeToIR(SETUP + 'G81 X5 Y7 Z4.2 R4.8 L999999999\n', { limits: { maxSegments: 100 } } as never);
    expect(r.ir.segments.count).toBeLessThanOrEqual(100);
  });
});

describe('canned cycle L repeats: stop once the segment budget is spent', () => {
  // The output is the same whether or not the loop stops early, so this pins the cost. At a 1e7 iteration cap, a
  // loop that keeps going after the budget is spent takes ~3 s; stopping takes a few ms. The cap stays at 1e7, not
  // 1e9, so a regression fails this bound instead of hanging the (synchronous) test past vitest's timeout.
  it('does not keep looping after emitSegment refuses (L1e9, iteration cap 1e7, 100 segments)', () => {
    const t0 = Date.now();
    const r = parseGcodeToIR('G90\nG0 X0 Y0 Z3\nG81 X5 Y7 Z4.2 R4.8 L1000000000\n', {
      limits: { maxSegments: 100, maxProgramIterations: 10_000_000 }
    } as never);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.ir.segments.count).toBe(100);
    expect(r.stats.stopReason?.code).toBe('E_LIMIT_SEGMENTS');
  });
});
