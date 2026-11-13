/**
 * Sweep slice 2: arcs and canned cycles that cannot be drawn as written are disclosed instead of silently
 * reshaped, and a G91 canned-cycle Z is incremental from the R plane (LinuxCNC), not from the current Z.
 */
import { describe, expect, it } from 'vitest';
import { parseGcodeToIR } from '../index';

const HEAD = 'G90\nG1 X0 Y0 Z0\n';

function run(src: string) {
  const { ir } = parseGcodeToIR(HEAD + src);
  const codes = (code: string) => ir.header.warnings.filter((w) => w.code === code);
  const s = ir.segments;
  const z1 = Array.from(s.z1).slice(0, s.count);
  const x1 = Array.from(s.x1).slice(0, s.count);
  return { s, z1, x1, codes };
}

describe('G2/G3 with R', () => {
  it('R smaller than half the chord is raised to a half circle and disclosed once', () => {
    const r = run('G2 X10 Y0 R1\nG2 X20 Y0 R1');
    expect(r.codes('arc-radius-too-small')).toHaveLength(1);
    expect(r.codes('arc-radius-too-small')[0].count).toBe(2);
  });

  it('a radius raised to half the chord stays a half circle when r² − d²/4 rounds below 0', () => {
    // From (0,0) to (-16.51, 3.81): half the chord is 8.4721…, and 8.4721…² − d²/4 rounds to a tiny negative.
    // Its square root was NaN, so the arc was drawn as ONE straight chord. Now: a half circle of ~0.5 mm steps.
    const r = run('G3 X-16.51 Y3.81 R-1');
    expect(r.s.count).toBe(1 + 54); // HEAD's G1 + ceil(π · 8.4721 / 0.5) = 54 arc segments
    expect(r.x1[r.s.count - 1]).toBeCloseTo(-16.51, 4);
    expect(r.codes('arc-radius-too-small')).toHaveLength(1);
  });

  it('R equal to half the chord, or within tolerance of it, is not disclosed', () => {
    expect(run('G2 X10 Y0 R5').codes('arc-radius-too-small')).toHaveLength(0);
    // 5 - 0.0049 is inside 0.005 mm + 0.1% of 5
    expect(run('G2 X10 Y0 R4.9951').codes('arc-radius-too-small')).toHaveLength(0);
    // 5 - 0.011 is outside 0.005 + 0.005
    expect(run('G2 X10 Y0 R4.989').codes('arc-radius-too-small')).toHaveLength(1);
  });

  it('G20 arcs use the mm tolerance on the converted radius (#578)', () => {
    // Half chord 0.5 in = 12.7 mm; the tolerance is 0.005 + 0.0127 = 0.0177 mm.
    // R0.4992 in = 12.67968 mm is 0.02032 mm short: outside.
    expect(run('G20\nG2 X1 Y0 R0.4992').codes('arc-radius-too-small')).toHaveLength(1);
    // R0.4994 in = 12.68476 mm is 0.01524 mm short: inside.
    expect(run('G20\nG2 X1 Y0 R0.4994').codes('arc-radius-too-small')).toHaveLength(0);
  });

  it('start == target with R has no centre: a point, no NaN, one disclosure', () => {
    const r = run('G1 X5 Y5\nG2 X5 Y5 R5');
    expect(r.codes('arc-radius-degenerate')).toHaveLength(1);
    expect(r.s.count).toBe(3);
    for (const v of r.x1) expect(Number.isFinite(v)).toBe(true);
    expect(r.x1[2]).toBe(5);
  });

  it('start == target with I/J is still a full circle and is not disclosed', () => {
    const r = run('G2 X0 Y0 I5 J0');
    expect(r.codes('arc-radius-degenerate')).toHaveLength(0);
    expect(r.s.count).toBeGreaterThan(30);
  });
});

describe('G2/G3 end point off the circle', () => {
  it('discloses a target that is not on the circle through the start', () => {
    const r = run('G2 X10 Y0 I1 J0');
    expect(r.codes('arc-end-off-circle')).toHaveLength(1);
    expect(r.x1[r.s.count - 1]).toBe(10);
  });

  it('a target on the circle, or within tolerance, is not disclosed', () => {
    expect(run('G2 X10 Y0 I5 J0').codes('arc-end-off-circle')).toHaveLength(0);
    expect(run('G2 X10.004 Y0 I5 J0').codes('arc-end-off-circle')).toHaveLength(0);
    expect(run('G2 X10.02 Y0 I5 J0').codes('arc-end-off-circle')).toHaveLength(1);
  });

  it('a full circle and a missing centre are not also reported as off-circle', () => {
    expect(run('G2 X0 Y0 I5 J0').codes('arc-end-off-circle')).toHaveLength(0);
    expect(run('G2 X10 Y0').codes('arc-end-off-circle')).toHaveLength(0);
  });
});

describe('G2/G3 P (turns)', () => {
  it('P other than 1 is disclosed as not applied; P1 and absent are silent', () => {
    expect(run('G2 X10 Y0 I5 J0 P3').codes('arc-turns-ignored')).toHaveLength(1);
    expect(run('G2 X10 Y0 I5 J0 P1').codes('arc-turns-ignored')).toHaveLength(0);
    expect(run('G2 X10 Y0 I5 J0').codes('arc-turns-ignored')).toHaveLength(0);
  });
});

describe('canned cycles', () => {
  it('G81 without Z and R discloses the 0 default; with both it is silent', () => {
    const r = run('G0 Z5\nG81 X1 Y1');
    expect(r.codes('canned-cycle-missing-word')).toHaveLength(1);
    expect(r.codes('canned-cycle-missing-word')[0].message).toContain('Z or R');
    expect(run('G0 Z5\nG81 X1 Y1 Z-3 R2').codes('canned-cycle-missing-word')).toHaveLength(0);
  });

  it('names the missing word', () => {
    expect(run('G0 Z5\nG81 X1 Y1 Z-3').codes('canned-cycle-missing-word')[0].message).toContain('no R word');
    expect(run('G0 Z5\nG81 X1 Y1 R2').codes('canned-cycle-missing-word')[0].message).toContain('no Z word');
  });

  it('words set by an earlier cycle carry over to a later G81 without disclosure', () => {
    const r = run('G0 Z5\nG81 X1 Y1 Z-3 R2\nG80\nG81 X2 Y2');
    expect(r.codes('canned-cycle-missing-word')).toHaveLength(0);
  });

  it('a cycle in G18 / G19 is disclosed (it still drills along Z)', () => {
    expect(run('G18\nG0 Z5\nG81 X1 Y1 Z-3 R2').codes('canned-cycle-plane')).toHaveLength(1);
    expect(run('G19\nG0 Z5\nG82 X1 Y1 Z-3 R2').codes('canned-cycle-plane')).toHaveLength(1);
    expect(run('G17\nG0 Z5\nG81 X1 Y1 Z-3 R2').codes('canned-cycle-plane')).toHaveLength(0);
  });

  it('G91: Z is incremental from the R plane, R from the current Z', () => {
    const r = run('G0 Z5\nG91\nG81 X1 Y1 Z-3 R2');
    // rapid to R (5+2=7), plunge to R+Z (7-3=4), retract to max(initial 5, R 7) = 7 (LinuxCNC G98)
    expect(r.z1.slice(-3)).toEqual([7, 4, 7]);
  });

  it('G90 is unchanged: Z and R are absolute', () => {
    const r = run('G0 Z5\nG81 X1 Y1 Z-3 R2');
    expect(r.z1.slice(-3)).toEqual([2, -3, 5]);
  });

  it('G91 with a repeated Z but no R re-applies the sticky R increment from the current Z', () => {
    const r = run('G0 Z5\nG91\nG81 X1 Y1 Z-3 R2\nG81 X1 Y0 Z-1');
    // the first hole retracted to R (7), so the second block's R plane is 7+2=9, depth 9-1=8, retract 9
    expect(r.z1.slice(-3)).toEqual([9, 8, 9]);
  });
});
