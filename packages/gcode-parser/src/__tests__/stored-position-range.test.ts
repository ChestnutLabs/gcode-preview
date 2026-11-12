/**
 * #510: a G-code word that is in float32 range on its own can still overflow once it is stored as an
 * origin-relative POSITION (G91 accumulation, or a far G92 origin plus a far move). float32 stored
 * Infinity with no warning, and `bounds.max.x` became Infinity. The segment is now dropped with the
 * `number-out-of-range` warning (counted, one entry).
 */
import { describe, expect, it } from 'vitest';
import { parseGcodeToIR } from '../index';

const BIG = '3' + '0'.repeat(38); // 3e38, inside float32 (max 3.4028e38)
const E30 = '1' + '0'.repeat(30); // 1e30
const NEG_BIG = '-' + BIG;

function parse(src: string) {
  const { ir } = parseGcodeToIR(src);
  const s = ir.segments;
  const nonFinite: number[] = [];
  for (const arr of [s.x0, s.y0, s.z0, s.x1, s.y1, s.z1, s.e]) {
    for (let i = 0; i < s.count; i++) if (!Number.isFinite(arr[i])) nonFinite.push(i);
  }
  const w = ir.header.warnings.find((x) => x.code === 'number-out-of-range');
  return { ir, count: s.count, nonFinite, warning: w };
}

describe('stored positions beyond float32 (#510)', () => {
  it('G91 accumulation: the overflowing segments are dropped, nothing non-finite is stored', () => {
    const r = parse(`G91\nG1 X${BIG} E1\nG1 X${BIG} E1\n`);
    expect(r.nonFinite).toEqual([]);
    expect(r.count).toBe(1);
    expect(r.warning?.count).toBe(1);
    expect(r.warning?.message).toContain('stored position');
    expect(r.ir.bounds.max.x).toBe(Math.fround(3e38));
  });

  it('G91 accumulation of three moves: counted once, one warning entry', () => {
    const r = parse(`G91\nG1 X${BIG} E1\nG1 X${BIG} E1\nG1 X${BIG} E1\n`);
    expect(r.nonFinite).toEqual([]);
    expect(r.count).toBe(1);
    expect(r.warning?.count).toBe(2);
    expect(r.ir.header.warnings.filter((x) => x.code === 'number-out-of-range')).toHaveLength(1);
  });

  it('far G92 origin plus a far move: the segment is dropped, not stored as Infinity', () => {
    const r = parse(`G92 X${NEG_BIG}\nG1 X${BIG} E1\n`);
    expect(r.nonFinite).toEqual([]);
    expect(r.warning?.count).toBe(1);
    expect(r.count).toBe(0);
  });

  it('Y overflows too (start and end)', () => {
    const r = parse(`G91\nG1 Y${BIG} E1\nG1 Y${BIG} E1\nG1 Y-${BIG} E1\n`);
    expect(r.nonFinite).toEqual([]);
    expect(r.count).toBe(1);
    expect(r.warning?.count).toBe(2);
  });

  it('Z overflows too (start and end)', () => {
    const r = parse(`G91\nG1 Z${BIG} E1\nG1 Z${BIG} E1\nG1 Z-${BIG} E1\n`);
    expect(r.nonFinite).toEqual([]);
    expect(r.count).toBe(1);
    expect(r.warning?.count).toBe(2);
  });

  it('a negative overflow is dropped as well', () => {
    const r = parse(`G91\nG1 X-${BIG} E1\nG1 X-${BIG} E1\n`);
    expect(r.nonFinite).toEqual([]);
    expect(r.count).toBe(1);
    expect(r.warning?.count).toBe(1);
  });

  it('an E delta that overflows drops the segment', () => {
    const r = parse(`M82\nG1 X1 E${BIG}\nG1 X2 E${NEG_BIG}\n`);
    expect(r.nonFinite).toEqual([]);
    expect(r.count).toBe(1);
    expect(r.warning?.count).toBe(1);
  });

  it('the machine position still advances, so a later move back in range is stored', () => {
    // 3e38 + 3e38 overflows (dropped); coming back in two steps passes through 6e38 and then 3e38
    const r = parse(`G91\nG1 X${BIG}\nG1 X${BIG}\nG1 X-${BIG}\nG1 X-${BIG}\nG1 X5 E1\n`);
    expect(r.nonFinite).toEqual([]);
    // stored: 0 -> 3e38, then 3e38 -> 0, then 0 -> 5; dropped: 3e38 -> 6e38 and 6e38 -> 3e38
    expect(r.count).toBe(3);
    expect(r.warning?.count).toBe(2);
  });

  it('in-range large values are untouched and raise no warning', () => {
    const r = parse(`M83\nG91\nG1 X${E30} E1\nG1 X${E30} E1\n`);
    expect(r.count).toBe(2);
    expect(r.nonFinite).toEqual([]);
    expect(r.warning).toBeUndefined();
    // G-code has no exponent syntax, so the 1e30 words above are digit strings
    expect(r.ir.bounds.max.x).toBe(Math.fround(2e30));
  });

  it('ordinary programs raise no range warning', () => {
    const r = parse('G90\nG92 X10 Y10\nG1 X20 Y20 E1\nG2 X30 Y20 I5 J0 E1\n');
    expect(r.warning).toBeUndefined();
    expect(r.nonFinite).toEqual([]);
  });
});
