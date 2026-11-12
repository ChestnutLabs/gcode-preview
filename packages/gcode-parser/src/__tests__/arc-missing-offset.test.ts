/**
 * #522: a G2/G3 arc that omits I or J (K in G18/G19) read the missing word as undefined, which made the
 * segment count non-finite, so the whole arc collapsed to ONE straight chord (the bundled demo-3dbenchy has
 * such arcs). An omitted centre offset is now 0 (RS274NGC / Marlin) when R is absent. With no offset and no R nothing
 * defines the arc: it is drawn as a straight move to the target and `arc-missing-center` is raised.
 */
import { describe, expect, it } from 'vitest';
import { parseGcodeToIR } from '../index';

const HEAD = 'G90\nG1 X0 Y0 Z0\n';

function run(src: string) {
  const { ir } = parseGcodeToIR(HEAD + src);
  const s = ir.segments;
  const arrays = [s.x0, s.y0, s.z0, s.x1, s.y1, s.z1];
  for (const a of arrays) for (let i = 0; i < s.count; i++) expect(Number.isFinite(a[i])).toBe(true);
  const max = (a: ArrayLike<number>) => Math.max(...Array.from(a).slice(0, s.count));
  const min = (a: ArrayLike<number>) => Math.min(...Array.from(a).slice(0, s.count));
  const last = s.count - 1;
  return {
    s,
    last,
    maxX: max(s.x1),
    minY: min(s.y1),
    maxZ: max(s.z1),
    minZ: min(s.z1),
    warn: ir.header.warnings.filter((w) => w.code === 'arc-missing-center')
  };
}

describe('arc with an omitted centre offset (#522)', () => {
  it('a missing J is a real arc, not the single chord it collapsed to (G2 X21 Y11 I-0.9 from 20,10)', () => {
    const missing = run('G1 X20 Y10\nG2 X21 Y11 I-0.9 E1');
    const explicit = run('G1 X20 Y10\nG2 X21 Y11 I-0.9 J0 E1');
    // segments 0 (G1 to origin) and 1 (G1 X20 Y10) precede the arc; the arc is 11 segments, as with J0
    expect(missing.s.count).toBe(13);
    expect(explicit.s.count).toBe(13);
    expect(missing.s.x1[2]).toBeCloseTo(19.8646, 3);
    expect(missing.s.y1[2]).toBeCloseTo(9.5253, 3);
    expect(missing.s.x1[7]).toBeCloseTo(18.2165, 3);
    expect(missing.s.y1[7]).toBeCloseTo(10.1715, 3);
    expect(missing.s.x1[12]).toBe(21);
    expect(missing.s.y1[12]).toBe(11);
    for (let i = 0; i < 13; i++) {
      expect(missing.s.x1[i]).toBe(explicit.s.x1[i]);
      expect(missing.s.y1[i]).toBe(explicit.s.y1[i]);
    }
    expect(missing.warn).toHaveLength(0);
  });

  it('no offsets and start == target (wholeCircle with radius 0): one finite point segment, no hang, warns', () => {
    const r = run('G1 X0 Y0\nG2 X0 Y0');
    expect(r.s.count).toBe(3);
    expect(r.s.x0[2]).toBe(0);
    expect(r.s.y0[2]).toBe(0);
    expect(r.s.x1[2]).toBe(0);
    expect(r.s.y1[2]).toBe(0);
    expect(r.warn).toHaveLength(1);
    const g3 = run('G3 X0 Y0');
    expect(g3.s.count).toBe(2);
    expect(g3.warn).toHaveLength(1);
  });

  it('a missing I is 0: G3 X0 Y10 J5 is a half circle bulging to +X', () => {
    const r = run('G3 X0 Y10 J5');
    expect(r.s.count).toBeGreaterThan(10);
    expect(r.maxX).toBeCloseTo(5, 1);
    expect(r.s.x1[r.last]).toBe(0);
    expect(r.s.y1[r.last]).toBe(10);
    expect(r.warn).toHaveLength(0);
  });

  it('a missing J is 0: G3 X10 Y0 I5 is a half circle bulging to -Y', () => {
    const r = run('G3 X10 Y0 I5');
    expect(r.minY).toBeCloseTo(-5, 1);
    expect(r.s.x1[r.last]).toBe(10);
    expect(r.s.y1[r.last]).toBe(0);
    expect(r.warn).toHaveLength(0);
  });

  it('a missing K in G18 is 0: G2 X10 Z0 I5 bulges to +Z', () => {
    const r = run('G18\nG2 X10 Z0 I5');
    expect(r.maxZ).toBeCloseTo(5, 1);
    expect(r.s.x1[r.last]).toBe(10);
    expect(r.s.z1[r.last]).toBe(0);
    expect(r.warn).toHaveLength(0);
  });

  it('a missing J in G19 is 0: G2 Y0 Z10 K5 bulges to -Y', () => {
    const r = run('G19\nG2 Y0 Z10 K5');
    expect(r.minY).toBeCloseTo(-5, 1);
    expect(r.s.y1[r.last]).toBe(0);
    expect(r.s.z1[r.last]).toBe(10);
    expect(r.warn).toHaveLength(0);
  });

  it('a missing I in G18 is 0: G3 X0 Z10 K5 stays finite and ends on target', () => {
    const r = run('G18\nG3 X0 Z10 K5');
    expect(r.s.x1[r.last]).toBe(0);
    expect(r.s.z1[r.last]).toBe(10);
    expect(r.maxZ).toBe(10);
    expect(r.warn).toHaveLength(0);
  });

  it('no I, J, K or R: a single straight move to the target plus one arc-missing-center warning', () => {
    const base = run('G1 X1 Y1').s.count;
    const r = run('G1 X1 Y1\nG2 X10 Y0\nG3 X20 Y0');
    expect(r.s.count).toBe(base + 2);
    expect(r.s.x0[base]).toBe(1);
    expect(r.s.y0[base]).toBe(1);
    expect(r.s.x1[base]).toBe(10);
    expect(r.s.y1[base]).toBe(0);
    expect(r.s.x1[base + 1]).toBe(20);
    expect(r.warn).toHaveLength(1);
    expect(r.warn[0].count).toBe(2);
  });

  it('no offsets in G18 and G19 also warn and end on target', () => {
    const xz = run('G18\nG2 X10 Z4');
    expect(xz.s.x1[xz.last]).toBe(10);
    expect(xz.s.z1[xz.last]).toBe(4);
    expect(xz.warn).toHaveLength(1);
    const yz = run('G19\nG3 Y10 Z4');
    expect(yz.s.y1[yz.last]).toBe(10);
    expect(yz.s.z1[yz.last]).toBe(4);
    expect(yz.warn).toHaveLength(1);
  });

  it('an explicit zero offset is a stated centre, not a missing one: no warning, still finite', () => {
    const r = run('G2 X10 Y0 J0');
    expect(r.s.x1[r.last]).toBe(10);
    expect(r.warn).toHaveLength(0);
  });

  it('an R arc has no offsets by design and does not warn', () => {
    const r = run('G2 X10 Y0 R5');
    expect(r.s.x1[r.last]).toBe(10);
    expect(r.warn).toHaveLength(0);
  });
});
