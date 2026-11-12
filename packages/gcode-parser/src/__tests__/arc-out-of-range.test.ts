/**
 * #525: a G2/G3 arc whose points cannot be stored as float32 made the parser loop synchronously for as long
 * as its arc length said (~3.8e39 iterations for a 3e38 radius). #521 drops each out-of-range segment, but
 * the dropped segments did not count toward `maxSegments`, so neither the budget nor cancel() could stop it.
 *
 * Two fixes, each pinned here: dropped segments count toward the segment budget, and an O(1) pre-check
 * drops the whole arc when its start, its target or its centre ± radius box is out of range. Every test
 * passes `maxSegments: 1000`, so reverting EITHER fix fails fast here (the other one still bounds the
 * loop). Reverting BOTH makes the 3e38 cases spin synchronously, and a vitest timeout cannot interrupt a
 * synchronous loop: arc-out-of-range-fast.test.ts holds a radius-100 twin that fails in milliseconds then.
 */
import { describe, expect, it } from 'vitest';
import { parseGcodeToIR } from '../index';

const BIG = '3' + '0'.repeat(38); // 3e38, inside float32 (max 3.4028e38)
const FAST = 5_000;
const F32_MAX = '340282346638528859811704183484516925440'; // FLOAT32_MAX, exactly
const P75 = '37778931862957161709568'; // 2^75: one double ulp at FLOAT32_MAX
const P74 = '18889465931478580854784'; // 2^74

function parse(src: string, maxSegments = 1000) {
  const t0 = Date.now();
  const { ir, stats } = parseGcodeToIR(src, { limits: { maxSegments } });
  const ms = Date.now() - t0;
  const oor = ir.header.warnings.filter((w) => w.code === 'number-out-of-range');
  return { ir, ms, count: ir.segments.count, stop: stats.stopReason?.code, oor };
}

// The #525 repro: G91 pushes the position to 6e38 (the second move is dropped, the position advances),
// then G90 and an arc of radius 3e38 around it.
const REPRO_HEAD = `G91\nG1 X1 E1\nG1 X${BIG}\nG1 X${BIG}\nG90\n`;

describe('arcs beyond the float32 range (#525)', () => {
  it(
    'the repro returns at once: the arc is dropped whole, with one deduped warning',
    () => {
      const r = parse(`${REPRO_HEAD}G2 I${BIG} J0 E1\n`);
      expect(r.ms).toBeLessThan(1000);
      expect(r.count).toBe(2);
      expect(r.stop).toBeUndefined();
      expect(r.oor).toHaveLength(1);
      expect(r.oor[0].count).toBe(2);
      expect(r.oor[0].message).toBe(
        'a stored position is beyond the float32 range the toolpath stores; segment dropped'
      );
    },
    FAST
  );

  it(
    'the repro with J omitted returns at once too',
    () => {
      const r = parse(`${REPRO_HEAD}G2 I${BIG} E1\n`);
      expect(r.ms).toBeLessThan(1000);
      expect(r.count).toBe(2);
      expect(r.stop).toBeUndefined();
      expect(r.oor[0].count).toBe(2);
    },
    FAST
  );

  it(
    'an arc whose box overflows on the low side is dropped whole',
    () => {
      const r = parse(`G1 X1 E1\nG2 I-${BIG} J0 E1\n`);
      expect(r.count).toBe(1);
      expect(r.stop).toBeUndefined();
      expect(r.oor[0].count).toBe(1);
    },
    FAST
  );

  it(
    'an arc whose box overflows on the high side is dropped whole',
    () => {
      const r = parse(`G1 X1 E1\nG2 I${BIG} J0 E1\n`);
      expect(r.count).toBe(1);
      expect(r.stop).toBeUndefined();
      expect(r.oor[0].count).toBe(1);
    },
    FAST
  );

  it(
    'an arc whose box overflows on Y is dropped whole',
    () => {
      const r = parse(`G1 X1 E1\nG2 I0 J${BIG} E1\n`);
      expect(r.count).toBe(1);
      expect(r.stop).toBeUndefined();
      expect(r.oor[0].count).toBe(1);
    },
    FAST
  );

  it(
    'a small arc to an out-of-range target is dropped whole, not drawn up to the last chord',
    () => {
      // G91: the arc starts at 1e38 with radius 1, so its box is in range, but its target is 4e38.
      const r = parse(`G91\nG1 X1${'0'.repeat(38)} E1\nG2 X${BIG} Y0 I1 J0 E1\n`);
      expect(r.count).toBe(1);
      expect(r.stop).toBeUndefined();
      expect(r.oor[0].count).toBe(1);
    },
    FAST
  );

  it(
    'the first arc of a file is checked against the origin it would set (its own start)',
    () => {
      // After a probe, G92 resyncs X to -3e38 with no segment emitted yet. The origin will be the arc's
      // start, so the box's high side (+3e38) is 6e38 from it: out of range.
      const r = parse(`G31 X10\nG92 X-${BIG}\nG2 I${BIG} J0 E1\n`);
      expect(r.count).toBe(0);
      expect(r.stop).toBeUndefined();
      expect(r.oor[0].count).toBe(1);
    },
    FAST
  );

  it(
    'G18: the box is checked on X/Z against the origin, which carries a Z offset',
    () => {
      // The probe + G92 resync puts the machine Z (and so the origin) at 3e38; the XZ arc's box reaches -3e38.
      const r = parse(`G31 Z10
G92 Z${BIG}
G1 X1 E1
G18
G2 I0 K-${BIG} E1
`);
      expect(r.count).toBe(1);
      expect(r.stop).toBeUndefined();
      expect(r.oor).toHaveLength(1);
      expect(r.oor[0].count).toBe(1);
      expect(r.oor[0].message).toBe('a stored position is beyond the float32 range the toolpath stores; arc dropped');
    },
    FAST
  );

  it(
    'G19: the box is checked on Y/Z against the origin, which carries a Z offset',
    () => {
      const r = parse(`G31 Z10
G92 Z${BIG}
G1 Y1 E1
G19
G2 J0 K-${BIG} E1
`);
      expect(r.count).toBe(1);
      expect(r.stop).toBeUndefined();
      expect(r.oor).toHaveLength(1);
      expect(r.oor[0].count).toBe(1);
      expect(r.oor[0].message).toBe('a stored position is beyond the float32 range the toolpath stores; arc dropped');
    },
    FAST
  );

  it(
    'an out-of-range start is caught even when the rounded centre collapses the box onto an in-range value',
    () => {
      // The position ends one double ulp past FLOAT32_MAX (that move is dropped). With I = -2^74 the centre
      // rounds to exactly FLOAT32_MAX, so the box is [F, F] on X and passes; only the start check drops it.
      const src = `G91
G1 X${F32_MAX} E1
G1 X${P75} E1
G90
G2 X${F32_MAX} Y${P74} I-${P74} J0 E1
G1 Y5 E1
`;
      const r = parse(src);
      expect(r.count).toBe(2);
      expect(r.stop).toBeUndefined();
      expect(r.oor[0].count).toBe(2);
      expect(r.ir.segments.y1[1]).toBe(5);
    },
    FAST
  );

  it(
    'dropped segments count toward maxSegments, so the budget stops a run of them',
    () => {
      const r = parse(`G91\nG1 X${BIG} E1\n${`G1 X${BIG} E1\n`.repeat(10)}`, 4);
      expect(r.count).toBe(1);
      expect(r.stop).toBe('E_LIMIT_SEGMENTS');
      expect(r.oor[0].count).toBe(3);
    },
    FAST
  );

  it(
    'a dropped arc counts toward maxSegments too',
    () => {
      const r = parse(`G1 X1 E1\nG2 I${BIG} J0 E1\nG2 I${BIG} J0 E1\nG2 I${BIG} J0 E1\n`, 3);
      expect(r.count).toBe(1);
      expect(r.stop).toBe('E_LIMIT_SEGMENTS');
      expect(r.oor[0].count).toBe(2);
    },
    FAST
  );

  it(
    'the position after a dropped arc is its target, so the next move is stored from there',
    () => {
      const r = parse(`G1 X1 E1\nG2 X5 Y0 I${BIG} J0 E1\nG1 Y1 E1\n`);
      expect(r.count).toBe(2);
      expect(r.ir.segments.x0[1]).toBe(5);
      expect(r.ir.segments.x1[1]).toBe(5);
      expect(r.ir.segments.y1[1]).toBe(1);
    },
    FAST
  );

  it(
    'an in-range arc still interpolates (control)',
    () => {
      // Clockwise from (10,0) to (0,10) around the origin is the 270° way: 1 line + 95 arc chords.
      const r = parse(`G1 X10 Y0 E1\nG2 X0 Y10 I-10 J0 E1\n`);
      expect(r.count).toBe(96);
      expect(r.stop).toBeUndefined();
      expect(r.oor).toHaveLength(0);
    },
    FAST
  );
});
