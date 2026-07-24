/*
 * M600 filament-swap color-change boundaries (DD-009 D2 amendment, #147). M600 is a
 * marker, not motion: it emits no segment but IS captured positionally in
 * ir.colorChanges (origin-relative, source order) with the active tool and the next
 * segment index (the slot boundary). Detected in the parser, so a bare M600 is honored
 * even with no dialect detected — and it no longer warns 'unsupported-command'.
 */
import { describe, expect, it } from 'vitest';
import { parseGcodeToIR } from '../parse.js';

describe('M600 color-change events (#147)', () => {
  it('records position, segIndex and active tool for an M600, adding no segment', () => {
    const gc = ['G1 X0 Y0 Z0.2 E0 F1000', 'G1 X10 E1', 'T1', 'G1 X20 E1', 'M600', 'G1 X30 E1'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, {});
    expect(ir.header.capabilities.colorChanges).toBe('known');
    expect(ir.colorChanges).toHaveLength(1);

    const cc = ir.colorChanges[0];
    expect(cc.segIndex).toBe(3); // segments 0,1,2 precede it; segment 3 is the first post-swap
    expect(cc.tool).toBe(1); // T1 was active at the swap
    expect(cc.x + ir.header.originOffset.x).toBeCloseTo(20, 3); // head position at the M600

    // A marker never adds a segment (side channel only): 4 G1 moves -> 4 segments.
    expect(ir.segments.count).toBe(4);
    // M600 is now understood — no 'unsupported-command' warning for it.
    expect(ir.header.warnings.map((w) => w.code)).not.toContain('unsupported-command');
  });

  it('reports colorChanges unavailable when no M600 occurs', () => {
    const { ir } = parseGcodeToIR('G1 X0 Y0 Z0.2 E0 F1000\nG1 X10 E1\nG1 X20 E1\n', {});
    expect(ir.colorChanges).toEqual([]);
    expect(ir.header.capabilities.colorChanges).toBe('unavailable');
  });

  it('records one event per M600 in source order (multi-swap)', () => {
    const gc = ['G1 X0 Y0 Z0.2 E0 F1000', 'G1 X10 E1', 'M600', 'G1 X20 E1', 'M600', 'G1 X30 E1'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, {});
    expect(ir.colorChanges).toHaveLength(2);
    expect(ir.colorChanges[0].segIndex).toBeLessThan(ir.colorChanges[1].segIndex);
  });
});
