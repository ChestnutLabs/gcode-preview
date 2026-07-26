/*
 * Motion-model correctness — E10 phase 1 (DD-010 D1/D2 + G92 E-datum). Extruder mode
 * (M82/M83), positioning mode (G90/G91), the firmware-conditioned interaction, and the
 * absolute-default resolution. Classification and extrusion are computed from the true
 * per-move E DELTA, not the raw E word.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind } from '@chestnutlabs/toolpath-core';
import { parseGcodeToIR } from '../parse.js';

const extrude = (kind: number): boolean => (kind & MoveKind.Extrude) !== 0;
const travel = (kind: number): boolean => (kind & MoveKind.Travel) !== 0;

describe('E10 phase 1 — extruder mode (M82/M83)', () => {
  it('M82 absolute E: an E-unchanged move is Travel, and extrusion is delta-summed', () => {
    // Absolute E stream: 0, 5, 5 (unchanged), 10. The middle move extrudes nothing.
    const gc = ['M82', 'G1 X0 Y0 Z0.2 E0', 'G1 X10 E5', 'G1 X20 E5', 'G1 X30 E10'].join('\n') + '\n';
    const { ir, stats } = parseGcodeToIR(gc, {});
    expect(ir.header.capabilities.extrusionMode).toBe('known');
    expect(extrude(ir.segments.kind[1])).toBe(true); // Δ5
    expect(travel(ir.segments.kind[2])).toBe(true); // Δ0 — E unchanged → Travel (the #156 fix)
    expect(extrude(ir.segments.kind[2])).toBe(false);
    expect(ir.segments.e[2]).toBe(0);
    expect(extrude(ir.segments.kind[3])).toBe(true); // Δ5
    expect(stats.extrusionDistance).toBeCloseTo(10); // Δ5+Δ5, not the raw 5+5+10=20
  });

  it('M83 relative E: each E word is a per-move delta (extrudes every move)', () => {
    const gc = ['M83', 'G1 X0 Y0 Z0.2 E0', 'G1 X10 E5', 'G1 X20 E5'].join('\n') + '\n';
    const { ir, stats } = parseGcodeToIR(gc, {});
    expect(ir.header.capabilities.extrusionMode).toBe('known');
    expect(ir.segments.e[1]).toBe(5);
    expect(ir.segments.e[2]).toBe(5);
    expect(extrude(ir.segments.kind[2])).toBe(true);
    expect(stats.extrusionDistance).toBeCloseTo(10);
  });

  it('unspecified mode defaults to absolute, disclosed inferred', () => {
    const gc = ['G1 X0 Y0 Z0.2 E0', 'G1 X10 E5', 'G1 X20 E5'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, {});
    expect(ir.header.capabilities.extrusionMode).toBe('inferred');
    // Absolute interpretation: the second E5 is E-unchanged → Travel.
    expect(travel(ir.segments.kind[2])).toBe(true);
  });

  it('G92 E<v> resets the extruder datum so the next delta is sane', () => {
    const gc = ['M82', 'G1 X0 Y0 Z0.2 E0', 'G1 X10 E5', 'G92 E0', 'G1 X20 E5'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, {});
    const last = ir.segments.count - 1;
    // Without the G92 E0 datum reset this would be Δ0 (Travel); with it, Δ5 (Extrude).
    expect(ir.segments.e[last]).toBeCloseTo(5);
    expect(extrude(ir.segments.kind[last])).toBe(true);
  });
});

describe('E10 phase 1 — positioning mode (G90/G91) + firmware interaction', () => {
  it('G91 relative positioning accumulates XYZ', () => {
    const gc = ['M83', 'G1 X0 Y0 Z0.2', 'G91', 'G1 X10 E1', 'G1 X10 E1'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, {});
    expect(ir.header.capabilities.positioningMode).toBe('known');
    const last = ir.segments.count - 1;
    expect(ir.header.originOffset.x + ir.segments.x1[last]).toBeCloseTo(20); // 0 → +10 → +10
  });

  it('firmware hint: extruderFollowsPositioning makes G91 set the E mode (Marlin/Klipper)', () => {
    // No M82/M83. Absolute E stream would make the 2nd E5 a Travel; but under G91 + a
    // Marlin-family hint, E follows G91 (relative) → both moves extrude.
    const gc = ['G91', 'G1 X0 Y0 Z0.2', 'G1 X10 E5', 'G1 X10 E5'].join('\n') + '\n';
    const withHint = parseGcodeToIR(gc, { extruderFollowsPositioning: true }).ir;
    expect(withHint.header.capabilities.extrusionMode).toBe('known'); // firmware-known + G91 seen
    const lastH = withHint.segments.count - 1;
    expect(extrude(withHint.segments.kind[lastH])).toBe(true);

    // Without the hint (RepRapFirmware / unknown): G91 is XYZ-only, E defaults absolute →
    // the 2nd E5 is E-unchanged → Travel, and the mode is only 'inferred'.
    const noHint = parseGcodeToIR(gc, {}).ir;
    expect(noHint.header.capabilities.extrusionMode).toBe('inferred');
    const lastN = noHint.segments.count - 1;
    expect(travel(noHint.segments.kind[lastN])).toBe(true);
  });

  it('positioning/extrusion modes are inferred when no mode command is seen', () => {
    const { ir } = parseGcodeToIR('G1 X0 Y0 Z0.2 E0\nG1 X10 E5\n', {});
    expect(ir.header.capabilities.positioningMode).toBe('inferred');
    expect(ir.header.capabilities.extrusionMode).toBe('inferred');
  });

  it('discloses G92 X/Y/Z work-offset as unhandled (phase 3), never a silent datum shift', () => {
    const { ir } = parseGcodeToIR(['G1 X0 Y0 Z0.2 E0', 'G92 X0', 'G1 X10 E1'].join('\n') + '\n', {});
    expect(ir.header.warnings.map((w) => w.code)).toContain('g92-xyz-unhandled');
  });
});

describe('E10 phase 2 — arc planes (G17/G18/G19, #157)', () => {
  const abs = (ir: ReturnType<typeof parseGcodeToIR>['ir'], axis: 'x' | 'y' | 'z', seg: number) =>
    ir.header.originOffset[axis] + ir.segments[`${axis}1`][seg];
  const uniqueAxis = (ir: ReturnType<typeof parseGcodeToIR>['ir'], axis: 'x' | 'y' | 'z') => [
    ...new Set(Array.from({ length: ir.segments.count }, (_, i) => abs(ir, axis, i).toFixed(3)))
  ];
  const arcSegs = (ir: ReturnType<typeof parseGcodeToIR>['ir']) =>
    Array.from(ir.segments.kind).filter((k) => (k & MoveKind.ArcSegment) !== 0).length;

  it('G17 (default): arcs flatten in XY, capability inferred when no plane word', () => {
    const { ir } = parseGcodeToIR(['G0 X0 Y0 Z0.2', 'G2 X10 Y10 I0 J10 E4'].join('\n') + '\n', {});
    const last = ir.segments.count - 1;
    expect(ir.header.capabilities.arcPlanes).toBe('inferred');
    expect(abs(ir, 'x', last)).toBeCloseTo(10);
    expect(abs(ir, 'y', last)).toBeCloseTo(10);
    expect(arcSegs(ir)).toBeGreaterThan(10);
  });

  it('G18: arcs flatten in the XZ plane — Z arcs, Y stays constant (was mis-flattened before)', () => {
    // Quarter arc (x0,z0)→(x10,z10) centered (x0,z10) in XZ (I/K offsets); Y unchanged at 5.
    const { ir } = parseGcodeToIR(['G0 X0 Y5 Z0', 'G18', 'G2 X10 Z10 I0 K10 E4'].join('\n') + '\n', {});
    const last = ir.segments.count - 1;
    expect(ir.header.capabilities.arcPlanes).toBe('known');
    expect(uniqueAxis(ir, 'y')).toEqual(['5.000']); // Y never moves in an XZ arc
    expect(uniqueAxis(ir, 'z').length).toBeGreaterThan(3); // Z genuinely arcs (not a flat line)
    expect(abs(ir, 'x', last)).toBeCloseTo(10);
    expect(abs(ir, 'z', last)).toBeCloseTo(10);
    expect(arcSegs(ir)).toBeGreaterThan(10);
  });

  it('G19: arcs flatten in the YZ plane — X stays constant', () => {
    const { ir } = parseGcodeToIR(['G0 X5 Y0 Z0', 'G19', 'G2 Y10 Z10 J0 K10'].join('\n') + '\n', {});
    const last = ir.segments.count - 1;
    expect(ir.header.capabilities.arcPlanes).toBe('known');
    expect(uniqueAxis(ir, 'x')).toEqual(['5.000']);
    expect(abs(ir, 'y', last)).toBeCloseTo(10);
    expect(abs(ir, 'z', last)).toBeCloseTo(10);
  });

  it('G18 R-mode: chord-radius arc solved in the active (XZ) plane', () => {
    const { ir } = parseGcodeToIR(['G0 X0 Y5 Z0', 'G18', 'G2 X10 Z10 R10'].join('\n') + '\n', {});
    const last = ir.segments.count - 1;
    expect(uniqueAxis(ir, 'y')).toEqual(['5.000']);
    expect(abs(ir, 'x', last)).toBeCloseTo(10);
    expect(abs(ir, 'z', last)).toBeCloseTo(10);
    expect(arcSegs(ir)).toBeGreaterThan(5);
  });

  it('G91 arc: endpoint and center are relative to the current position', () => {
    // From (5,5): under G91 the endpoint words are deltas → target (5+5, 5+5) = (10,10),
    // center = current + (I,J) = (5, 10). Quarter arc ending at (10,10).
    const { ir } = parseGcodeToIR(['G0 X5 Y5 Z0.2', 'G91', 'G2 X5 Y5 I0 J5'].join('\n') + '\n', {});
    const last = ir.segments.count - 1;
    expect(abs(ir, 'x', last)).toBeCloseTo(10);
    expect(abs(ir, 'y', last)).toBeCloseTo(10);
  });
});
