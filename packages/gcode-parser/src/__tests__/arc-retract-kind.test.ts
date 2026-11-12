/**
 * #507: a G2/G3 arc with a negative E (a retract during the arc) used the truthy-E rule and was classified
 * as an extrusion, while the same linear move is a retraction. Arcs now use the linear-move rule: only a
 * positive E delta extrudes.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind } from '@chestnutlabs/toolpath-core';
import { parseGcodeToIR } from '../index';

const HEAD = 'M83\nG1 X0 Y0 Z0.2\nG1 X5 E1\n';

function kindsAfterHead(src: string): { kinds: number[]; extrusion: number } {
  const { ir, stats } = parseGcodeToIR(src);
  const s = ir.segments;
  // segment 0 is the G1 Z0.2 positioning move and segment 1 the G1 X5 E1 extrusion; the rest is under test
  const kinds: number[] = [];
  for (let i = 2; i < s.count; i++) kinds.push(s.kind[i]);
  return { kinds, extrusion: stats.extrusionDistance };
}

describe('arc E sign vs move kind (#507)', () => {
  it('a G2 arc with negative E is a travel arc, like the linear move', () => {
    const arc = kindsAfterHead(HEAD + 'G2 X10 Y0 I2.5 J0 E-0.5');
    expect(arc.kinds.length).toBeGreaterThan(1);
    expect(arc.kinds.every((k) => k === MoveKind.Travel + MoveKind.ArcSegment)).toBe(true);
    expect(arc.kinds[0]).toBe(34);
    const line = kindsAfterHead(HEAD + 'G1 X10 Y0 E-0.5');
    expect(line.kinds).toEqual([2]);
  });

  it('a G3 arc with negative E is a travel arc and adds no extrusion distance', () => {
    const arc = kindsAfterHead(HEAD + 'G3 X10 Y0 I2.5 J0 E-0.5');
    expect(arc.kinds.every((k) => k === 34)).toBe(true);
    expect(arc.extrusion).toBe(1);
  });

  it('a positive-E arc is still an extrusion arc and counts its distance', () => {
    const arc = kindsAfterHead(HEAD + 'G2 X10 Y0 I2.5 J0 E0.5');
    expect(arc.kinds.every((k) => k === 33)).toBe(true);
    expect(arc.extrusion).toBe(1.5);
  });

  it('a zero-E arc stays a travel arc', () => {
    const arc = kindsAfterHead(HEAD + 'G2 X10 Y0 I2.5 J0 E0');
    expect(arc.kinds.every((k) => k === 34)).toBe(true);
  });

  it('a negative absolute-E delta (M82) is a travel arc too', () => {
    const arc = kindsAfterHead('M82\nG1 X0 Y0 Z0.2\nG92 E0\nG1 X5 E1\nG2 X10 Y0 I2.5 J0 E0.5');
    expect(arc.kinds.every((k) => k === 34)).toBe(true);
  });

  it('with the tool engaged a negative-E arc is a cut arc, as a linear move would be', () => {
    const { ir } = parseGcodeToIR('M83\nM3 S1000\nG1 X0 Y0 Z0.2\nG2 X10 Y0 I5 J0 E-0.5');
    const s = ir.segments;
    expect(s.count).toBeGreaterThan(1);
    // segment 0 is the plain G1 positioning move; every later one belongs to the arc
    for (let i = 1; i < s.count; i++) expect(s.kind[i]).toBe(MoveKind.Cut + MoveKind.ArcSegment);
    expect(parseGcodeToIR('M83\nM3 S1000\nG1 X0 Y0 Z0.2\nG1 X10 Y0 E-0.5').ir.segments.kind[1]).toBe(MoveKind.Cut);
  });

  it('the retract E is still spread over the arc segments', () => {
    const { ir } = parseGcodeToIR(HEAD + 'G2 X10 Y0 I2.5 J0 E-0.5');
    const s = ir.segments;
    let total = 0;
    for (let i = 2; i < s.count; i++) total += s.e[i];
    expect(total).toBeCloseTo(-0.5, 5);
  });
});
