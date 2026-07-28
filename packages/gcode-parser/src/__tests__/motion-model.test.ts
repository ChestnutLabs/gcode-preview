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

  it('positioning/extrusion modes stay inferred without a mode command', () => {
    const { ir } = parseGcodeToIR('G1 X0 Y0 Z0.2 E0\nG1 X10 E5\n', {});
    expect(ir.header.capabilities.coordinateSystem).toBe('inferred'); // no WCS/G92-XYZ
  });
});

describe('E10 phase 3 — coordinate systems (G53/G54–G59 + G92 XYZ, #158)', () => {
  const absX = (ir: ReturnType<typeof parseGcodeToIR>['ir'], seg: number) =>
    ir.header.originOffset.x + ir.segments.x1[seg];

  it('G92 X<v> shifts the datum without motion — the next move continues from the physical point', () => {
    // At logical X50, `G92 X0` makes the current point read 0; `G1 X10` then lands at physical 60
    // (the continuous path), and the coordinate-system capability is disclosed known.
    const gc = ['M83', 'G1 X50 Y0 Z0.2', 'G92 X0', 'G1 X10 E1'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, {});
    const last = ir.segments.count - 1;
    expect(absX(ir, last)).toBeCloseTo(60); // audit repro line 31 resolved
    expect(ir.header.capabilities.coordinateSystem).toBe('known');
  });

  it('G54–G59 select a work offset (via G10 L2) applied to commanded coordinates', () => {
    // G55 origin offset +100 in X; a commanded G1 X10 under G55 lands at logical 110.
    const gc = ['M83', 'G10 L2 P2 X100', 'G55', 'G1 X10 Y0 Z0.2 E1'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, {});
    const last = ir.segments.count - 1;
    expect(absX(ir, last)).toBeCloseTo(110);
    expect(ir.header.capabilities.coordinateSystem).toBe('known');
  });

  it('identity WCS (no G53/G54/G92-XYZ) leaves positions unchanged and disclosed inferred', () => {
    const gc = ['M83', 'G1 X10 Y0 Z0.2 E1', 'G1 X20 E1'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, {});
    const last = ir.segments.count - 1;
    expect(absX(ir, last)).toBeCloseTo(20); // no offset
    expect(ir.header.capabilities.coordinateSystem).toBe('inferred');
  });

  it('G53 is a one-shot machine-coordinate bypass consumed by the next move', () => {
    // Under a G55 +100 offset, a G53 move ignores it (machine coords); the move after it is offset again.
    const gc = ['M83', 'G10 L2 P2 X100', 'G55', 'G53', 'G1 X10 Y0 Z0.2', 'G1 X10 E1'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, {});
    // First move under G53 → machine X10; second move (offset restored) → 10 + 100 = 110.
    expect(absX(ir, 0)).toBeCloseTo(10);
    expect(absX(ir, ir.segments.count - 1)).toBeCloseTo(110);
  });

  const absZ = (ir: ReturnType<typeof parseGcodeToIR>['ir'], seg: number) =>
    ir.header.originOffset.z + ir.segments.z1[seg];

  it('G31 → G92 Z0 resyncs the logical frame: the next move renders at the authored Z, not shifted', () => {
    // The demo-mach3 pattern: travel to Z0.2, probe (G31), zero at the probe point (G92 Z0), then
    // G00 Z0.039 must render at logical 0.039 — NOT 0.239 (the stale-position datum shift).
    const gc = ['G0 Z0.2', 'G31 Z-11.8 F55', 'G92 Z0', 'G0 Z0.039', 'G0 Z0.15'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, {});
    const last = ir.segments.count - 1;
    expect(absZ(ir, last)).toBeCloseTo(0.15);
    // the post-resync move renders at 0.039, and every Z stays in the authored range (≈ 0.2, not 0.239)
    const maxZ = Math.max(...Array.from({ length: ir.segments.count }, (_, i) => absZ(ir, i)));
    expect(maxZ).toBeLessThan(0.21); // authored range, not the +0.2 shifted 0.239
    expect(ir.header.warnings.map((w) => w.code)).toContain('probe-position-runtime-dependent');
  });

  it('G31 without a following datum reset: probe is runtime-dependent, no fabricated endpoint drawn', () => {
    const { ir } = parseGcodeToIR(['G0 Z1', 'G31 Z-11.8 F55', 'G0 Z0.5'].join('\n') + '\n', {});
    // The probe never advances to -11.8; the diagnostic is emitted; a following absolute move re-homes.
    const zs = Array.from({ length: ir.segments.count }, (_, i) => absZ(ir, i));
    expect(Math.min(...zs)).toBeGreaterThan(-1); // never the un-reached commanded -11.8
    expect(ir.header.warnings.map((w) => w.code)).toContain('probe-position-runtime-dependent');
  });

  it('partial-axis G92 recovery: a certain axis datum-shifts while the probed axis resyncs', () => {
    // X stays known (datum shift), Z is probed then resynced — the two axes are handled independently.
    const gc = ['G0 X50 Z0.2', 'G31 Z-5 F55', 'G92 X0 Z0', 'G0 X10 Z0.039'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, {});
    const last = ir.segments.count - 1;
    expect(absX(ir, last)).toBeCloseTo(60); // X: datum shift (50 + 10), continuous
    expect(absZ(ir, last)).toBeCloseTo(0.039); // Z: resynced to the datum, authored value
  });

  it('no false connecting geometry: the resync starts a new frame at the datum', () => {
    // The segment after G92 must not span from the pre-probe Z (1.0) down to the datum — the resync
    // finalizes the path so the next move starts fresh at the datum.
    const gc = ['G0 Z1.0', 'G31 Z-5 F55', 'G92 Z0', 'G0 Z0.04'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, {});
    const last = ir.segments.count - 1;
    // the last segment's start Z is the datum (0), not the stale pre-probe 1.0
    expect(ir.header.originOffset.z + ir.segments.z0[last]).toBeCloseTo(0);
    expect(absZ(ir, last)).toBeCloseTo(0.04);
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
