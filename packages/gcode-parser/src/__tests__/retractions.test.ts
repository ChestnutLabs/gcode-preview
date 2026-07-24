/*
 * Retraction/unretraction event recording (DD-009 D1, #148). E-only moves emit
 * no segment but ARE captured positionally in ir.retractions, origin-relative,
 * in source order, with the physical convention E<0 = retract / E>0 = unretract.
 */
import { describe, expect, it } from 'vitest';
import { parseGcodeToIR } from '../parse.js';

describe('retraction events (#148)', () => {
  it('records position, kind, srcByte and segIndex for E-only moves', () => {
    const gc = 'G1 X0 Y0 Z0.2 E0 F1000\nG1 X10 E1\nG1 E-2 F2400\nG1 X20 F3000\nG1 E2 F2400\nG1 X30 E1\n';
    const { ir } = parseGcodeToIR(gc, {});
    expect(ir.header.capabilities.retractions).toBe('known');
    expect(ir.retractions).toHaveLength(2);

    const [retract, unretract] = ir.retractions;
    expect(retract.kind).toBe('retract'); // E-2 pulls filament back
    expect(retract.x).toBeCloseTo(10, 3); // at the toolhead position after X10
    expect(retract.segIndex).toBe(2); // before the 3rd segment (0: travel, 1: extrude)

    expect(unretract.kind).toBe('unretract'); // E2 pushes it out
    expect(unretract.x).toBeCloseTo(20, 3);
    expect(unretract.segIndex).toBe(3);

    // Events do NOT add segments (side channel only).
    expect(ir.segments.count).toBe(4);
  });

  it('reports retractions unavailable when none occur', () => {
    const { ir } = parseGcodeToIR('G1 X0 Y0 Z0.2 E0 F1000\nG1 X10 E1\nG1 X20 E1\n', {});
    expect(ir.retractions).toEqual([]);
    expect(ir.header.capabilities.retractions).toBe('unavailable');
  });

  it('keeps positions origin-relative (same frame as segments)', () => {
    // The retraction is stored in the same origin-relative frame as segments:
    // its stored x plus the origin equals the absolute toolhead position (X110).
    const gc = 'G1 X100 Y0 Z0.2 E0 F1000\nG1 X110 E1\nG1 E-1 F2400\n';
    const { ir } = parseGcodeToIR(gc, {});
    expect(ir.retractions[0].x + ir.header.originOffset.x).toBeCloseTo(110, 3);
  });
});
